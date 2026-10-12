/**
 * src/routes/auth.js
 *
 * POST /api/auth/register  — student self-registration (accepts department_id + id_number)
 * POST /api/auth/login     — generic login (returns role; dept-head must use /api/department-head/login)
 * GET  /api/auth/me
 * POST /api/auth/logout
 * POST /api/auth/refresh
 * POST /api/auth/oauth-sync  — called after Google sign-in to create a profile row if missing
 * POST /api/auth/complete-profile — student fills in department + id_number after Google sign-in
 */
'use strict';

const express        = require('express');
const { anonClient, adminClient, createUserClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// ── Simple in-process rate limiter ────────────────────────────
function makeRateLimiter({ windowMs = 60_000, max = 10 } = {}) {
  const map = new Map();
  return (req, res, next) => {
    const ip  = req.ip || req.socket?.remoteAddress || 'x';
    const now = Date.now();
    let e = map.get(ip);
    if (!e || now > e.reset) { e = { count: 0, reset: now + windowMs }; map.set(ip, e); }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', Math.ceil((e.reset - now) / 1000));
      return res.status(429).json({ error: 'Too many requests. Wait a minute.', code: 'RATE_LIMIT' });
    }
    next();
  };
}
const authLimiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

// ── Helpers ───────────────────────────────────────────────────
function safeUser(profile, role, extra = {}) {
  return {
    id:              profile.id,
    full_name:       profile.full_name  || '',
    username:        profile.username   || null,
    email:           profile.email,
    avatar_url:      profile.avatar_url || null,
    role:            role || 'student',
    created_at:      profile.created_at,
    ...extra,
  };
}

function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

// Validate id_number: non-empty, trimmed, no leading/trailing whitespace
function validateIdNumber(v) {
  if (typeof v !== 'string') return false;
  return v.trim().length > 0;
}

// ── POST /api/auth/register ───────────────────────────────────
// Accepts optional department_id + id_number for student accounts.
// Staff/admin/head accounts are created exclusively through the admin panel.
router.post('/register', authLimiter, async (req, res) => {
  const { full_name, email, password, username, department_id, id_number } = req.body || {};

  // ── Basic validation ──────────────────────────────────────
  if (!full_name?.trim())    return res.status(400).json({ error: 'Full name is required.',          code: 'VALIDATION_ERROR' });
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email address.',          code: 'VALIDATION_ERROR' });
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.',  code: 'VALIDATION_ERROR' });

  // ── Student-specific validation ───────────────────────────
  if (!department_id)
    return res.status(400).json({ error: 'Please select your department.',            code: 'VALIDATION_ERROR' });
  if (!id_number || !validateIdNumber(id_number))
    return res.status(400).json({ error: 'Student ID number is required.',            code: 'VALIDATION_ERROR' });

  const normalEmail   = email.trim().toLowerCase();
  const normalIdNum   = id_number.trim();

  // ── Check department exists ───────────────────────────────
  const { data: dept, error: deptErr } = await adminClient
    .from('departments')
    .select('id, name_en')
    .eq('id', department_id)
    .maybeSingle();
  if (deptErr || !dept)
    return res.status(400).json({ error: 'Selected department does not exist.',       code: 'INVALID_DEPARTMENT' });

  // ── Check for duplicate ID number (case-insensitive) ─────
  const { data: existingStu } = await adminClient
    .from('students')
    .select('id')
    .ilike('id_number', normalIdNum)
    .maybeSingle();
  if (existingStu)
    return res.status(409).json({ error: 'This ID number is already registered.',     code: 'ID_NUMBER_TAKEN' });

  // ── Create Supabase auth user ─────────────────────────────
  const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
    email:    normalEmail,
    password,
    options:  {
      data: {
        full_name:     full_name.trim(),
        username:      username || normalEmail.split('@')[0],
        department_id: department_id,
      },
    },
  });

  if (signUpError) {
    if (signUpError.message?.toLowerCase().includes('already')) {
      return res.status(409).json({ error: 'An account with this email already exists.', code: 'EMAIL_TAKEN' });
    }
    console.error('[register]', signUpError.message);
    return res.status(500).json({ error: 'Registration failed.', code: 'SIGNUP_FAILED' });
  }

  const authUser = signUpData?.user;
  if (!authUser) {
    // Supabase requires email confirmation — no session is returned
    return res.status(201).json({ message: 'Check your email to confirm your account.', code: 'CONFIRM_EMAIL' });
  }

  // ── Wait for handle_new_user trigger ─────────────────────
  let profile = null;
  for (let i = 0; i < 4; i++) {
    const { data } = await adminClient.from('users').select('*').eq('id', authUser.id).maybeSingle();
    if (data) { profile = data; break; }
    await new Promise(r => setTimeout(r, 300));
  }

  // ── Upsert students row with department_id + id_number ────
  const { error: stuErr } = await adminClient
    .from('students')
    .upsert(
      { user_id: authUser.id, department_id, id_number: normalIdNum },
      { onConflict: 'user_id' }
    );

  if (stuErr) {
    // Roll back the auth user so the student can try again
    await adminClient.auth.admin.deleteUser(authUser.id).catch(() => {});
    if (stuErr.code === '23505' || stuErr.message?.toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'This ID number is already registered.', code: 'ID_NUMBER_TAKEN' });
    }
    console.error('[register] student upsert failed:', stuErr.message);
    return res.status(500).json({ error: 'Registration failed. Please try again.', code: 'STUDENT_SETUP_FAILED' });
  }

  const session = signUpData?.session;
  return res.status(201).json({
    access_token:  session?.access_token  || null,
    refresh_token: session?.refresh_token || null,
    token:         session?.access_token  || null,
    user: safeUser(
      profile || { id: authUser.id, email: normalEmail, full_name: full_name.trim() },
      'student',
      { department_id, id_number: normalIdNum }
    ),
  });
});

// ── POST /api/auth/login ──────────────────────────────────────
// Generic login — returns role in the response.
// Department heads CAN log in here but should prefer /api/department-head/login
// which additionally validates the role server-side before returning the token.
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email address.', code: 'VALIDATION_ERROR' });
  if (!password)             return res.status(400).json({ error: 'Password is required.',  code: 'VALIDATION_ERROR' });

  const normalEmail = email.trim().toLowerCase();

  const { data: sessionData, error: loginError } =
    await anonClient.auth.signInWithPassword({ email: normalEmail, password });

  if (loginError) {
    return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  }

  const authUser = sessionData?.user;
  const session  = sessionData?.session;

  const [{ data: profile }, { data: staffProfile }] = await Promise.all([
    adminClient.from('users').select('*').eq('id', authUser.id).maybeSingle(),
    adminClient.from('staff_profiles').select('role, department_id').eq('user_id', authUser.id).maybeSingle(),
  ]);

  const role = staffProfile?.role ?? 'student';

  // Audit
  await adminClient.from('audit_logs').insert({
    actor_id: authUser.id, action: 'login', table_name: 'auth.users',
    record_id: authUser.id, new_data: { email: normalEmail, role },
  }).catch(() => {});

  // Build extra fields for students
  let extra = {};
  if (role === 'student') {
    const { data: stu } = await adminClient
      .from('students')
      .select('department_id, id_number')
      .eq('user_id', authUser.id)
      .maybeSingle();
    extra = {
      department_id: stu?.department_id || null,
      id_number:     stu?.id_number     || null,
      profileIncomplete: !stu?.department_id || !stu?.id_number,
    };
  }

  return res.json({
    access_token:  session?.access_token,
    refresh_token: session?.refresh_token,
    expires_in:    session?.expires_in,
    token:         session?.access_token,   // backward compat
    user: safeUser(profile || { id: authUser.id, email: normalEmail, full_name: '' }, role, extra),
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  const { data: profile } = await adminClient
    .from('users').select('*').eq('id', req.user.id).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Account not found.', code: 'USER_NOT_FOUND' });

  let extra = {};
  if (req.role === 'student') {
    const { data: stu } = await adminClient
      .from('students')
      .select('department_id, id_number')
      .eq('user_id', req.user.id)
      .maybeSingle();
    extra = {
      department_id:     stu?.department_id || null,
      id_number:         stu?.id_number     || null,
      profileIncomplete: !stu?.department_id || !stu?.id_number,
    };
  }

  return res.json(safeUser(profile, req.role, extra));
});

// ── POST /api/auth/oauth-sync ─────────────────────────────────
// Called after Google OAuth to ensure a `students` row exists.
router.post('/oauth-sync', authMiddleware, async (req, res) => {
  if (req.role !== 'student') return res.json({ synced: false, reason: 'not-student' });

  // Upsert students row (department_id and id_number will be null until the user fills them in)
  await adminClient.from('students')
    .upsert({ user_id: req.user.id }, { onConflict: 'user_id' });

  // Check whether profile is complete
  const { data: stu } = await adminClient
    .from('students')
    .select('department_id, id_number')
    .eq('user_id', req.user.id)
    .maybeSingle();

  return res.json({
    synced:            true,
    profileIncomplete: !stu?.department_id || !stu?.id_number,
  });
});

// ── POST /api/auth/complete-profile ───────────────────────────
// Student fills in department_id + id_number after Google sign-in.
router.post('/complete-profile', authMiddleware, async (req, res) => {
  if (req.role !== 'student')
    return res.status(403).json({ error: 'Only students can complete a student profile.', code: 'FORBIDDEN' });

  const { department_id, id_number } = req.body || {};

  if (!department_id)
    return res.status(400).json({ error: 'Please select your department.', code: 'VALIDATION_ERROR' });
  if (!id_number || !validateIdNumber(id_number))
    return res.status(400).json({ error: 'Student ID number is required.', code: 'VALIDATION_ERROR' });

  const normalIdNum = id_number.trim();

  // Verify department
  const { data: dept } = await adminClient
    .from('departments').select('id').eq('id', department_id).maybeSingle();
  if (!dept)
    return res.status(400).json({ error: 'Selected department does not exist.', code: 'INVALID_DEPARTMENT' });

  // Check duplicate ID number (excluding this user)
  const { data: conflict } = await adminClient
    .from('students')
    .select('user_id')
    .ilike('id_number', normalIdNum)
    .maybeSingle();
  if (conflict && conflict.user_id !== req.user.id)
    return res.status(409).json({ error: 'This ID number is already registered.', code: 'ID_NUMBER_TAKEN' });

  const { error } = await adminClient
    .from('students')
    .upsert({ user_id: req.user.id, department_id, id_number: normalIdNum }, { onConflict: 'user_id' });

  if (error) {
    if (error.code === '23505' || error.message?.toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'This ID number is already registered.', code: 'ID_NUMBER_TAKEN' });
    }
    return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  }

  return res.json({ success: true });
});

// ── POST /api/auth/logout ─────────────────────────────────────
router.post('/logout', authMiddleware, async (req, res) => {
  try {
    const userClient = createUserClient(req.accessToken);
    await userClient.auth.signOut();
  } catch { /* ignore */ }
  return res.json({ success: true });
});

// ── POST /api/auth/refresh ────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refresh_token } = req.body || {};
  if (!refresh_token)
    return res.status(400).json({ error: 'refresh_token is required.', code: 'MISSING_REFRESH_TOKEN' });

  const { data, error } = await anonClient.auth.refreshSession({ refresh_token });
  if (error || !data?.session) {
    return res.status(401).json({ error: 'Refresh token invalid or expired.', code: 'REFRESH_FAILED' });
  }
  return res.json({
    access_token:  data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in:    data.session.expires_in,
    token:         data.session.access_token,
  });
});

module.exports = router;
