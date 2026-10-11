/**
 * src/routes/auth.js — Supabase edition
 *
 *   POST /api/auth/register  { full_name, email, password, username? }
 *   POST /api/auth/login     { email, password }
 *   GET  /api/auth/me
 *   POST /api/auth/refresh   { refresh_token }
 *   POST /api/auth/logout
 *
 * Assumes tables: users(id, full_name, email, username?, avatar_url?, created_at)
 * and staff_profiles(user_id, role, department_id). Anyone without a
 * staff_profiles row is treated as a 'student'.
 */
require('dotenv').config();
const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  NODE_ENV,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY. ' +
    'Check that .env is in the wollo-info-backend folder.'
  );
}

const clientOpts = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
};

// Service-role client: bypasses RLS. Server-side only, never used to sign users in.
const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, clientOpts);

// Fresh anon client per call so one user's session never leaks into another request.
const anon = () => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, clientOpts);

const isDev = NODE_ENV !== 'production';

/* ── Simple in-memory rate limiter (no extra dependency) ──
   Tracks request counts per IP in a sliding window.
   Resets the window on every clean interval.              */
function makeRateLimiter({ windowMs = 60_000, max = 10, message = 'Too many requests, please try again later.' } = {}) {
  const counts = new Map(); // ip → { count, resetAt }
  return function rateLimiter(req, res, next) {
    const ip  = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    let   entry = counts.get(ip);
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      counts.set(ip, entry);
    }
    entry.count++;
    if (entry.count > max) {
      res.set('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// 10 attempts per minute per IP on auth endpoints
const authLimiter = makeRateLimiter({ windowMs: 60_000, max: 10, message: 'Too many login attempts. Please wait a minute.' });

const router = express.Router();

/* ── helpers ── */
const getBearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
};

/** Build the public user object the frontend expects. */
async function buildUser(authUser) {
  const meta = authUser.user_metadata || {};

  const { data: profile, error: pErr } = await admin
    .from('users').select('*').eq('id', authUser.id).maybeSingle();
  if (pErr) console.error('[auth] users lookup failed:', pErr.message);

  let role = 'student';
  let department_id = null;
  const { data: staff, error: sErr } = await admin
    .from('staff_profiles').select('role, department_id')
    .eq('user_id', authUser.id).maybeSingle();
  if (sErr) console.error('[auth] staff_profiles lookup failed:', sErr.message);
  else if (staff) { role = staff.role; department_id = staff.department_id ?? null; }

  return {
    id:            authUser.id,
    full_name:     profile?.full_name || meta.full_name || '',
    email:         authUser.email,
    username:      profile?.username || meta.username || null,
    avatar_url:    profile?.avatar_url || null,
    role,
    department_id,
    created_at:    profile?.created_at || authUser.created_at,
  };
}

const sessionPayload = (session, user) => ({
  access_token:  session.access_token,
  refresh_token: session.refresh_token,
  expires_in:    session.expires_in,
  token:         session.access_token, // backward compat
  user,
});

/* ── POST /api/auth/register ── */
router.post('/register', authLimiter, async (req, res) => {
  try {
    const { full_name, email, password, username } = req.body || {};

    if (!full_name?.trim())  return res.status(400).json({ error: 'Full name is required.' });
    if (!email?.trim())      return res.status(400).json({ error: 'Email is required.' });
    if (!password)           return res.status(400).json({ error: 'Password is required.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const normalEmail   = email.trim().toLowerCase();
    const cleanUsername = username?.trim() || null;

    const { data, error } = await anon().auth.signUp({
      email: normalEmail,
      password,
      options: {
        data: {
          full_name: full_name.trim(),
          ...(cleanUsername ? { username: cleanUsername } : {}),
        },
      },
    });

    if (error) {
      if (error.code === 'user_already_exists' || /already registered/i.test(error.message)) {
        return res.status(409).json({ error: 'An account with this email already exists.' });
      }
      console.error('Register error:', error);
      const clientError = error.status && error.status < 500;
      return res.status(clientError ? 400 : 500).json({
        error: clientError ? error.message : 'Registration failed. Please try again.',
      });
    }

    // With email confirmation on, an existing email comes back with no identities.
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }

    // Create the public profile row
    const { error: upErr } = await admin.from('users').upsert(
      {
        id:        data.user.id,
        full_name: full_name.trim(),
        email:     normalEmail,
        ...(cleanUsername ? { username: cleanUsername } : {}),
      },
      { onConflict: 'id' }
    );
    if (upErr) console.error('[register] profile upsert failed:', upErr.message);

    // Email confirmation required → no session yet
    if (!data.session) {
      return res.status(200).json({
        code: 'CONFIRM_EMAIL',
        message: 'Account created. Check your email to confirm it, then sign in.',
      });
    }

    const user = await buildUser(data.user);
    return res.status(201).json(sessionPayload(data.session, user));
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({
      error: isDev ? `Registration failed. (${err.message})` : 'Registration failed. Please try again.',
    });
  }
});

/* ── POST /api/auth/login ── */
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email?.trim()) return res.status(400).json({ error: 'Email is required.' });
    if (!password)      return res.status(400).json({ error: 'Password is required.' });

    const { data, error } = await anon().auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (error || !data?.session) {
      if (error?.code === 'email_not_confirmed') {
        return res.status(403).json({ error: 'Please confirm your email before signing in.' });
      }
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = await buildUser(data.user);

    if (isDev) {
      console.log(`[login] ${user.email} → role="${user.role}" id=${user.id}`);
    }

    return res.json(sessionPayload(data.session, user));
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({
      error: isDev ? `Login failed. (${err.message})` : 'Login failed. Please try again.',
    });
  }
});

/* ── GET /api/auth/me ── */
router.get('/me', async (req, res) => {
  try {
    const token = getBearer(req);
    if (!token) return res.status(401).json({ error: 'Not logged in. Please sign in first.' });

    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Invalid or expired token. Please sign in again.' });
    }

    return res.json(await buildUser(data.user));
  } catch (err) {
    console.error('Me error:', err);
    return res.status(500).json({ error: 'Could not fetch user.' });
  }
});

/* ── POST /api/auth/refresh ── */
router.post('/refresh', async (req, res) => {
  try {
    const { refresh_token } = req.body || {};
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required.' });

    const { data, error } = await anon().auth.refreshSession({ refresh_token });
    if (error || !data?.session) {
      return res.status(401).json({ error: 'Session expired. Please sign in again.' });
    }

    return res.json({
      access_token:  data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in:    data.session.expires_in,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Could not refresh session.' });
  }
});

/* ── POST /api/auth/logout ── */
router.post('/logout', async (req, res) => {
  const token = getBearer(req);
  if (token) {
    try { await admin.auth.admin.signOut(token, 'local'); } catch { /* ignore */ }
  }
  return res.json({ success: true });
});

/**
 * Works with both mounting styles, so you don't have to guess how
 * src/server.js uses it:
 *   app.use('/api/auth', require('./routes/auth'));
 *   app.use('/api/auth', require('./routes/auth')(pool));
 */
module.exports = function authRouter(req, res, next) {
  if (res && next) return router(req, res, next); // used directly as middleware
  return router;                                   // called as a factory
};