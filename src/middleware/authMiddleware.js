/**
 * src/middleware/authMiddleware.js
 *
 * Verifies the Supabase JWT from the Authorization: Bearer header.
 * On success attaches to req:
 *   req.user        — { id, email, ...auth metadata }
 *   req.role        — 'admin' | 'head' | 'staff' | 'student' | null
 *   req.departmentId — uuid for head/staff, null otherwise
 *   req.accessToken — raw token (forwarded to per-request Supabase client)
 *
 * Returns 401 for missing/expired/invalid tokens.
 * Does NOT return 403 — authorization is the job of roleGuard.
 */

'use strict';

const { anonClient, adminClient } = require('../config/supabase');

module.exports = async function authMiddleware(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({
      error: 'Not logged in. Please sign in first.',
      code:  'AUTH_MISSING_TOKEN',
    });
  }

  // Verify token with Supabase Auth
  const { data: { user }, error } = await anonClient.auth.getUser(token);

  if (error || !user) {
    const isExpired = error?.message?.includes('expired');
    return res.status(401).json({
      error: isExpired
        ? 'Session expired. Please sign in again.'
        : 'Invalid token. Please sign in again.',
      code: isExpired ? 'AUTH_TOKEN_EXPIRED' : 'AUTH_TOKEN_INVALID',
    });
  }

  // Load role + department from staff_profiles (use service client to bypass RLS)
  const { data: staffProfile } = await adminClient
    .from('staff_profiles')
    .select('role, department_id')
    .eq('user_id', user.id)
    .maybeSingle();

  // Load public profile
  const { data: profile } = await adminClient
    .from('users')
    .select('id, full_name, username, email, avatar_url, is_active')
    .eq('id', user.id)
    .maybeSingle();

  // Block deactivated accounts
  if (profile && profile.is_active === false) {
    return res.status(403).json({
      error: 'Your account has been deactivated.',
      code:  'AUTH_ACCOUNT_INACTIVE',
    });
  }

  req.accessToken  = token;
  req.user         = { id: user.id, email: user.email, ...user.user_metadata };
  req.profile      = profile || null;
  req.role         = staffProfile?.role    ?? 'student';
  req.departmentId = staffProfile?.department_id ?? null;

  next();
};
