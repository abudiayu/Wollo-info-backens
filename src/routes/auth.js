/**
 * src/routes/auth.js
 * No external validator needed — manual checks only.
 *
 * POST /api/auth/register
 * POST /api/auth/login
 * GET  /api/auth/me
 * POST /api/auth/logout
 * POST /api/auth/refresh
 */
'use strict';

const express        = require('express');
const { anonClient, adminClient, createUserClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

// ── Simple in-process rate limiter (no extra dep) ─────────────
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
function safeUser(profile, role) {
  return {
    id:         profile.id,
    full_name:  profile.full_name  || '',
    username:   profile.username   || null,
    email:      profile.email,
    avatar_url: profile.avatar_url || null,
    role:       role || 'student',
    created_at: profile.created_at,
  };
}

function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

// ── POST /api/auth/register ───────────────────────────────────
router.post('/register', authLimiter, async (req, res) => {
  const { full_name, email, password, username } = req.body || {};

  if (!full_name?.trim())    return res.status(400).json({ error: 'Full name is required.', code: 'VALIDATION_ERROR' });
  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email address.', code: 'VALIDATION_ERROR' });
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.', code: 'VALIDATION_ERROR' });

  const normalEmail = email.trim().toLowerCase();

  const { data: signUpData, error: signUpError } = await anonClient.auth.signUp({
    email:    normalEmail,
    password,
    options:  { data: { full_name: full_name.trim(), username: username || normalEmail.split('@')[0] } },
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
    return res.status(201).json({ message: 'Check your email to confirm your account.', code: 'CONFIRM_EMAIL' });
  }

  // Wait briefly for the handle_new_user trigger
  let profile = null;
  for (let i = 0; i < 3; i++) {
    const { data } = await adminClient.from('users').select('*').eq('id', authUser.id).maybeSingle();
    if (data) { profile = data; break; }
    await new Promise(r => setTimeout(r, 250));
  }

  const session = signUpData?.session;
  return res.status(201).json({
    access_token:  session?.access_token  || null,
    refresh_token: session?.refresh_token || null,
    token:         session?.access_token  || null,
    user: safeUser(profile || { id: authUser.id, email: normalEmail, full_name: full_name.trim() }, 'student'),
  });
});

// ── POST /api/auth/login ──────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!validateEmail(email)) return res.status(400).json({ error: 'Invalid email address.', code: 'VALIDATION_ERROR' });
  if (!password)             return res.status(400).json({ error: 'Password is required.', code: 'VALIDATION_ERROR' });

  const normalEmail = email.trim().toLowerCase();

  const { data: sessionData, error: loginError } =
    await anonClient.auth.signInWithPassword({ email: normalEmail, password });

  if (loginError) {
    return res.status(401).json({ error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS' });
  }

  const authUser = sessionData?.user;
  const session  = sessionData?.session;

  const { data: profile } = await adminClient
    .from('users').select('*').eq('id', authUser.id).maybeSingle();

  const { data: staffProfile } = await adminClient
    .from('staff_profiles').select('role, department_id').eq('user_id', authUser.id).maybeSingle();

  const role = staffProfile?.role ?? 'student';

  // Audit
  await adminClient.from('audit_logs').insert({
    actor_id: authUser.id, action: 'login', table_name: 'auth.users',
    record_id: authUser.id, new_data: { email: normalEmail, role },
  });

  return res.json({
    access_token:  session?.access_token,
    refresh_token: session?.refresh_token,
    expires_in:    session?.expires_in,
    token:         session?.access_token,   // backward compat
    user: safeUser(profile || { id: authUser.id, email: normalEmail, full_name: '' }, role),
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  const { data: profile } = await adminClient
    .from('users').select('*').eq('id', req.user.id).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Account not found.', code: 'USER_NOT_FOUND' });
  return res.json(safeUser(profile, req.role));
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
