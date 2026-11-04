'use strict';
/**
 * src/routes/motivations.js
 *
 * Admin + department-head CRUD for the `motivations` table.
 * The POST handler uses a direct adminClient insert — no RPC dependency.
 *
 * Mounted at /api/motivations in src/server.js.
 *
 * GET    /api/motivations           — admin: all rows (filterable); head: own dept; else: published only
 * GET    /api/motivations/:id       — single row (auth required)
 * POST   /api/motivations           — create (admin or head)
 * PUT    /api/motivations/:id       — update (admin or head — head scoped to own dept)
 * PATCH  /api/motivations/:id/publish   — set status = 'published'
 * PATCH  /api/motivations/:id/unpublish — set status = 'draft'
 * PATCH  /api/motivations/:id/archive   — set status = 'archived'
 * DELETE /api/motivations/:id       — delete (admin or head — head scoped to own dept)
 */

const express        = require('express');
const { adminClient } = require('../config/supabase');
const authMiddleware  = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

// ── GET /api/motivations ──────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  const { department_id, status, search } = req.query;

  let q = adminClient
    .from('motivations')
    .select('id, title, details, media_url, status, department_id, created_by, created_at, updated_at');

  // Row visibility rules
  if (req.role === 'admin') {
    // Admin sees all rows; optionally filter by status
    if (status) q = q.eq('status', status);
  } else if (req.role === 'head') {
    // Head sees only their department's rows
    q = q.eq('department_id', req.departmentId);
    if (status) q = q.eq('status', status);
  } else {
    // Any other authenticated user sees only published rows
    q = q.eq('status', 'published');
  }

  if (department_id) q = q.eq('department_id', department_id);
  if (search?.trim()) q = q.ilike('title', `%${search.trim()}%`);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) {
    console.error('[GET /api/motivations] Supabase error:', { code: error.code, message: error.message, hint: error.hint });
    return res.status(500).json({ error: error.message, code: error.code || 'DB_ERROR', hint: error.hint || null });
  }
  return res.json(data || []);
});

// ── GET /api/motivations/:id ──────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  const { data, error } = await adminClient
    .from('motivations')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

// ── POST /api/motivations ─────────────────────────────────────
// Direct insert — no RPC needed.
router.post('/', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  const { title, details, media_url, department_id, status = 'draft' } = req.body || {};

  if (!title?.trim())
    return res.status(400).json({ error: 'title is required.', code: 'VALIDATION_ERROR' });

  const validStatuses = ['draft', 'published', 'archived'];
  if (!validStatuses.includes(status))
    return res.status(400).json({ error: `status must be one of: ${validStatuses.join(', ')}.`, code: 'VALIDATION_ERROR' });

  // Heads can only create for their own department
  const deptId = req.role === 'head' ? req.departmentId : (department_id || null);

  const { data, error } = await adminClient
    .from('motivations')
    .insert({
      title:         title.trim(),
      details:       details       || null,
      media_url:     media_url     || null,
      department_id: deptId,
      status,
      created_by:    req.user.id,
    })
    .select()
    .single();

  if (error) {
    console.error('[POST /api/motivations]', error);
    return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  }
  return res.status(201).json(data);
});

// ── PUT /api/motivations/:id ──────────────────────────────────
router.put('/:id', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  // Verify the row exists and check ownership for heads
  const { data: existing, error: fetchErr } = await adminClient
    .from('motivations')
    .select('id, department_id')
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message, code: 'DB_ERROR' });
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });

  if (req.role === 'head' && existing.department_id !== req.departmentId)
    return res.status(403).json({ error: 'You can only edit your own department\'s motivations.', code: 'AUTHZ_WRONG_DEPT' });

  const { title, details, media_url, status } = req.body || {};
  const patch = {};
  if (title     !== undefined) patch.title     = title?.trim() || title;
  if (details   !== undefined) patch.details   = details   || null;
  if (media_url !== undefined) patch.media_url = media_url || null;
  if (status    !== undefined) {
    const valid = ['draft', 'published', 'archived'];
    if (!valid.includes(status))
      return res.status(400).json({ error: `status must be one of: ${valid.join(', ')}.`, code: 'VALIDATION_ERROR' });
    patch.status = status;
  }

  if (!Object.keys(patch).length)
    return res.status(400).json({ error: 'Nothing to update.', code: 'VALIDATION_ERROR' });

  const { data, error } = await adminClient
    .from('motivations')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data);
});

// ── PATCH /api/motivations/:id/publish ───────────────────────
router.patch('/:id/publish', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  const { data, error } = await adminClient
    .from('motivations')
    .update({ status: 'published' })
    .eq('id', req.params.id)
    .select('id, status')
    .single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'published', id: data?.id });
});

// ── PATCH /api/motivations/:id/unpublish ─────────────────────
router.patch('/:id/unpublish', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  const { data, error } = await adminClient
    .from('motivations')
    .update({ status: 'draft' })
    .eq('id', req.params.id)
    .select('id, status')
    .single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'draft', id: data?.id });
});

// ── PATCH /api/motivations/:id/archive ───────────────────────
router.patch('/:id/archive', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  const { data, error } = await adminClient
    .from('motivations')
    .update({ status: 'archived' })
    .eq('id', req.params.id)
    .select('id, status')
    .single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'archived', id: data?.id });
});

// ── DELETE /api/motivations/:id ───────────────────────────────
router.delete('/:id', authMiddleware, requireRole('admin', 'head'), async (req, res) => {
  // Check existence and ownership
  const { data: existing, error: fetchErr } = await adminClient
    .from('motivations')
    .select('id, department_id')
    .eq('id', req.params.id)
    .maybeSingle();

  if (fetchErr) return res.status(500).json({ error: fetchErr.message, code: 'DB_ERROR' });
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });

  if (req.role === 'head' && existing.department_id !== req.departmentId)
    return res.status(403).json({ error: 'You can only delete your own department\'s motivations.', code: 'AUTHZ_WRONG_DEPT' });

  const { error } = await adminClient
    .from('motivations')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

module.exports = router;
