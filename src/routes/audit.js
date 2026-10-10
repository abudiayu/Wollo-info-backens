/**
 * src/routes/audit.js
 *
 * GET /api/audit                   — full audit log (admin only)
 * GET /api/audit/department/:id    — department-scoped log (head of that dept)
 */

'use strict';

const express        = require('express');
const { adminClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

// ── GET /api/audit ────────────────────────────────────────────
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);
  const { table_name, actor_id } = req.query;

  let query = adminClient
    .from('audit_logs')
    .select('*, users(full_name, email)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (table_name) query = query.eq('table_name', table_name);
  if (actor_id)   query = query.eq('actor_id', actor_id);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ data: data || [], total: count, limit, offset });
});

// ── GET /api/audit/department/:id ─────────────────────────────
router.get('/department/:id', authMiddleware, async (req, res) => {
  const isAdmin = req.role === 'admin';
  const isHead  = req.role === 'head' && req.departmentId === req.params.id;

  if (!isAdmin && !isHead) {
    return res.status(403).json({ error: 'Access denied.', code: 'AUTHZ_DENIED' });
  }

  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);

  const { data, error, count } = await adminClient
    .from('audit_logs')
    .select('*, users(full_name, email)', { count: 'exact' })
    .eq('department_id', req.params.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ data: data || [], total: count, limit, offset });
});

module.exports = router;
