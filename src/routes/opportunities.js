'use strict';
const express        = require('express');
const { adminClient, createUserClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');
const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const { department_id, status } = req.query;
  let q = adminClient.from('opportunities').select('*, departments(name_en, slug)');
  if (req.role === 'admin') {
    if (status) q = q.eq('status', status);
  } else if (req.role === 'head') {
    q = q.eq('department_id', req.departmentId);
  } else {
    q = q.eq('status', 'published');
  }
  if (department_id) q = q.eq('department_id', department_id);
  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

router.get('/:id', authMiddleware, async (req, res) => {
  const { data, error } = await adminClient.from('opportunities').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

router.post('/', authMiddleware, requireRole('admin','head'), async (req, res) => {
  const { title, details, link, deadline, department_id, status = 'draft' } = req.body || {};
  if (!title?.trim()) return res.status(400).json({ error: 'title is required.', code: 'VALIDATION_ERROR' });
  const deptId = req.role === 'head' ? req.departmentId : (department_id || null);
  const userClient = createUserClient(req.accessToken);
  const { data, error } = await userClient.rpc('create_opportunity', {
    p_title: title.trim(), p_details: details||null, p_link: link||null,
    p_deadline: deadline||null, p_department_id: deptId, p_status: status,
  });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.status(201).json(data);
});

router.put('/:id', authMiddleware, requireRole('admin','head'), async (req, res) => {
  const { data: existing } = await adminClient.from('opportunities').select('department_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  if (req.role === 'head' && existing.department_id !== req.departmentId)
    return res.status(403).json({ error: 'Access denied.', code: 'AUTHZ_WRONG_DEPT' });
  const { title, details, link, deadline, status } = req.body || {};
  const patch = {};
  if (title    !== undefined) patch.title    = title;
  if (details  !== undefined) patch.details  = details;
  if (link     !== undefined) patch.link     = link || null;
  if (deadline !== undefined) patch.deadline = deadline || null;
  if (status   !== undefined) patch.status   = status;
  const { data, error } = await adminClient.from('opportunities').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data);
});

router.patch('/:id/publish', authMiddleware, requireRole('admin','head'), async (req, res) => {
  const { error } = await adminClient.from('opportunities').update({ status: 'published' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'published' });
});

router.patch('/:id/unpublish', authMiddleware, requireRole('admin','head'), async (req, res) => {
  const { error } = await adminClient.from('opportunities').update({ status: 'draft' }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'draft' });
});

router.delete('/:id', authMiddleware, requireRole('admin','head'), async (req, res) => {
  const { data: existing } = await adminClient.from('opportunities').select('department_id').eq('id', req.params.id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  if (req.role === 'head' && existing.department_id !== req.departmentId)
    return res.status(403).json({ error: 'Access denied.', code: 'AUTHZ_WRONG_DEPT' });
  const { error } = await adminClient.from('opportunities').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

module.exports = router;
