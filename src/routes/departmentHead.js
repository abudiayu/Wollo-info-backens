'use strict';
/**
 * src/routes/departmentHead.js — Supabase edition
 *
 * Public routes (no auth):
 *   POST /api/department-head/login
 *
 * Protected routes (Supabase JWT + role = 'head'):
 *   GET  /api/department-head/me
 *   PUT  /api/department-head/department
 *   GET  /api/department-head/stats
 *   GET  /api/department-head/courses
 *   POST /api/department-head/courses
 *   PUT  /api/department-head/courses/:id
 *   DELETE /api/department-head/courses/:id
 *   GET  /api/department-head/students
 *   GET  /api/department-head/content
 *   POST /api/department-head/content
 *   PUT  /api/department-head/content/:id
 *   DELETE /api/department-head/content/:id
 *
 * The login endpoint MUST:
 *  1. Authenticate with Supabase (email + password).
 *  2. Look up staff_profiles: role MUST be 'head' and department_id MUST exist.
 *  3. If either check fails, sign the user back out and return 403.
 *  4. On success, return the Supabase access_token + head profile.
 */

const express        = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');
const { anonClient, adminClient } = require('../config/supabase');

const router    = express.Router();
const headOnly  = [authMiddleware, requireRole('head')];

// ── Simple rate limiter ───────────────────────────────────────
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
const loginLimiter = makeRateLimiter({ windowMs: 60_000, max: 10 });

function validateEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

// ═══════════════════════════════════════════════════════════════
// POST /api/department-head/login
// Server-side role verification — no client can bypass this.
// ═══════════════════════════════════════════════════════════════
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};

  if (!validateEmail(email))
    return res.status(400).json({ error: 'Valid email is required.', code: 'VALIDATION_ERROR' });
  if (!password)
    return res.status(400).json({ error: 'Password is required.', code: 'VALIDATION_ERROR' });

  const normalEmail = email.trim().toLowerCase();

  // 1. Authenticate with Supabase
  const { data: sessionData, error: loginError } =
    await anonClient.auth.signInWithPassword({ email: normalEmail, password });

  if (loginError || !sessionData?.user) {
    return res.status(401).json({
      error: 'Invalid credentials or you are not a Department Head.',
      code:  'INVALID_CREDENTIALS',
    });
  }

  const authUser = sessionData.user;
  const session  = sessionData.session;

  // 2. Server-side role check — MUST be 'head' with a department_id
  const { data: staffProfile, error: spErr } = await adminClient
    .from('staff_profiles')
    .select('role, department_id')
    .eq('user_id', authUser.id)
    .maybeSingle();

  const isHead =
    !spErr &&
    staffProfile?.role === 'head' &&
    !!staffProfile?.department_id;

  if (!isHead) {
    // Sign the Supabase session out immediately so the token cannot be reused
    try {
      const { createUserClient } = require('../config/supabase');
      await createUserClient(session?.access_token).auth.signOut();
    } catch { /* ignore */ }

    return res.status(403).json({
      error: 'Invalid credentials or you are not a Department Head.',
      code:  'NOT_DEPARTMENT_HEAD',
    });
  }

  // 3. Load public profile
  const { data: profile } = await adminClient
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle();

  // 4. Load department info
  const { data: dept } = await adminClient
    .from('departments')
    .select('id, name_en, description, graduates_count, duration_years')
    .eq('id', staffProfile.department_id)
    .maybeSingle();

  // 5. Audit log — wrapped in try/catch because the query builder does not return a Promise
  try {
    const { error: auditErr } = await adminClient.from('audit_logs').insert({
      actor_id:   authUser.id,
      action:     'login',
      table_name: 'auth.users',
      record_id:  authUser.id,
      new_data:   { email: normalEmail, role: 'head' },
    });
    if (auditErr) console.error('[dept-head login] audit insert failed:', auditErr.message);
  } catch (e) {
    console.error('[dept-head login] audit insert threw:', e.message);
  }

  return res.json({
    token:         session?.access_token,
    access_token:  session?.access_token,
    refresh_token: session?.refresh_token,
    expires_in:    session?.expires_in,
    user: {
      id:              authUser.id,
      email:           normalEmail,
      full_name:       profile?.full_name  || '',
      avatar_url:      profile?.avatar_url || null,
      role:            'head',
      department_id:   staffProfile.department_id,
      department_name: dept?.name_en || '',
    },
    department: dept || null,
  });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/department-head/me
// Returns the head's profile + department details.
// ═══════════════════════════════════════════════════════════════
router.get('/me', ...headOnly, async (req, res) => {
  const uid    = req.user.id;
  const deptId = req.departmentId;

  const [{ data: profile }, { data: dept }] = await Promise.all([
    adminClient.from('users').select('id,full_name,email,avatar_url').eq('id', uid).maybeSingle(),
    adminClient.from('departments').select('id,name_en,description,graduates_count,duration_years').eq('id', deptId).maybeSingle(),
  ]);

  if (!profile) return res.status(404).json({ error: 'Profile not found.', code: 'NOT_FOUND' });
  if (!dept)    return res.status(404).json({ error: 'Department not found.', code: 'NOT_FOUND' });

  return res.json({
    id:              uid,
    name:            profile.full_name,
    email:           profile.email,
    avatar_url:      profile.avatar_url,
    department_id:   dept.id,
    department_name: dept.name_en,
    description:     dept.description,
    graduates_count: dept.graduates_count ?? 0,
    duration_years:  dept.duration_years  ?? 4,
  });
});

// ═══════════════════════════════════════════════════════════════
// PUT /api/department-head/department
// ═══════════════════════════════════════════════════════════════
router.put('/department', ...headOnly, async (req, res) => {
  const { description, graduates_count, duration_years } = req.body || {};
  const deptId = req.departmentId;

  const patch = {};
  if (description     !== undefined) patch.description     = description || '';
  if (graduates_count !== undefined) patch.graduates_count = Number(graduates_count) || 0;
  if (duration_years  !== undefined) patch.duration_years  = Number(duration_years)  || 4;

  if (!Object.keys(patch).length)
    return res.status(400).json({ error: 'Nothing to update.', code: 'VALIDATION_ERROR' });

  const { error } = await adminClient.from('departments').update(patch).eq('id', deptId);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  return res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// GET /api/department-head/stats
// ═══════════════════════════════════════════════════════════════
router.get('/stats', ...headOnly, async (req, res) => {
  const deptId = req.departmentId;

  const [
    { count: studentCount },
    { count: courseCount  },
    { count: contentCount },
  ] = await Promise.all([
    adminClient.from('students').select('id', { count: 'exact' }).eq('department_id', deptId),
    adminClient.from('department_courses').select('id', { count: 'exact' }).eq('department_id', deptId),
    adminClient.from('department_content').select('id', { count: 'exact' }).eq('department_id', deptId),
  ]);

  return res.json({
    students: studentCount ?? 0,
    courses:  courseCount  ?? 0,
    content:  contentCount ?? 0,
  });
});

// ═══════════════════════════════════════════════════════════════
// COURSES
// ═══════════════════════════════════════════════════════════════
router.get('/courses', ...headOnly, async (req, res) => {
  const { data, error } = await adminClient
    .from('department_courses')
    .select('id, course_name, prerequisites, created_at')
    .eq('department_id', req.departmentId)
    .order('created_at', { ascending: true });

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

router.post('/courses', ...headOnly, async (req, res) => {
  const { course_name, prerequisites } = req.body || {};
  if (!course_name?.trim())
    return res.status(400).json({ error: 'Course name is required.', code: 'VALIDATION_ERROR' });

  const { data, error } = await adminClient
    .from('department_courses')
    .insert({ department_id: req.departmentId, course_name: course_name.trim(), prerequisites: prerequisites?.trim() || null })
    .select().single();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.status(201).json(data);
});

router.put('/courses/:id', ...headOnly, async (req, res) => {
  const { course_name, prerequisites } = req.body || {};
  if (!course_name?.trim())
    return res.status(400).json({ error: 'Course name is required.', code: 'VALIDATION_ERROR' });

  const { data, error } = await adminClient
    .from('department_courses')
    .update({ course_name: course_name.trim(), prerequisites: prerequisites?.trim() || null })
    .eq('id', req.params.id)
    .eq('department_id', req.departmentId)
    .select().maybeSingle();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Course not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

router.delete('/courses/:id', ...headOnly, async (req, res) => {
  const { error } = await adminClient
    .from('department_courses')
    .delete()
    .eq('id', req.params.id)
    .eq('department_id', req.departmentId);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════
// STUDENTS — scoped to this department, includes id_number
// ═══════════════════════════════════════════════════════════════
router.get('/students', ...headOnly, async (req, res) => {
  const deptId = req.departmentId;

  // Join students → users to get name + email + id_number
  const { data: students, error } = await adminClient
    .from('students')
    .select('user_id, id_number, created_at, users(full_name, email, avatar_url)')
    .eq('department_id', deptId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  const result = (students || []).map(s => ({
    id:        s.user_id,
    user_id:   s.user_id,
    id_number: s.id_number || null,
    name:      s.users?.full_name  || '',
    email:     s.users?.email      || '',
    avatar_url:s.users?.avatar_url || null,
    created_at:s.created_at,
  }));

  return res.json(result);
});

// ═══════════════════════════════════════════════════════════════
// CONTENT (opportunities, motivation, documents)
// ═══════════════════════════════════════════════════════════════
const CONTENT_TYPES = ['opportunity', 'motivation', 'document'];

router.get('/content', ...headOnly, async (req, res) => {
  const { data, error } = await adminClient
    .from('department_content')
    .select('id, type, title, body, link_url, created_at')
    .eq('department_id', req.departmentId)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

router.post('/content', ...headOnly, async (req, res) => {
  const { type, title, body, link_url } = req.body || {};
  if (!CONTENT_TYPES.includes(type))
    return res.status(400).json({ error: 'Invalid content type.', code: 'VALIDATION_ERROR' });
  if (!title?.trim())
    return res.status(400).json({ error: 'Title is required.', code: 'VALIDATION_ERROR' });

  const { data, error } = await adminClient
    .from('department_content')
    .insert({
      department_id: req.departmentId,
      head_id:       req.user.id,
      type,
      title:         title.trim(),
      body:          body || '',
      link_url:      link_url || null,
    })
    .select().single();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.status(201).json(data);
});

router.put('/content/:id', ...headOnly, async (req, res) => {
  const { type, title, body, link_url } = req.body || {};
  const patch = {};
  if (type     !== undefined) { if (!CONTENT_TYPES.includes(type)) return res.status(400).json({ error: 'Invalid type.', code: 'VALIDATION_ERROR' }); patch.type = type; }
  if (title    !== undefined) patch.title    = title?.trim() || '';
  if (body     !== undefined) patch.body     = body || '';
  if (link_url !== undefined) patch.link_url = link_url || null;

  const { data, error } = await adminClient
    .from('department_content')
    .update(patch)
    .eq('id', req.params.id)
    .eq('department_id', req.departmentId)
    .select().maybeSingle();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Content not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

router.delete('/content/:id', ...headOnly, async (req, res) => {
  const { error } = await adminClient
    .from('department_content')
    .delete()
    .eq('id', req.params.id)
    .eq('department_id', req.departmentId);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

module.exports = router;
