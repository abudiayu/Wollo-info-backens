'use strict';
const express        = require('express');
const { adminClient, createUserClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');
const router = express.Router();

router.use(authMiddleware);

router.get('/profile', async (req, res) => {
  const { data: profile } = await adminClient.from('users').select('*').eq('id', req.user.id).maybeSingle();
  const { data: student } = await adminClient.from('students').select('*, departments(name_en, slug)').eq('user_id', req.user.id).maybeSingle();
  if (!profile) return res.status(404).json({ error: 'Profile not found.', code: 'NOT_FOUND' });
  return res.json({ ...profile, role: req.role, student: student || null });
});

router.patch('/department', async (req, res) => {
  const { department_id } = req.body || {};
  if (!department_id) return res.status(400).json({ error: 'department_id is required.', code: 'VALIDATION_ERROR' });
  const { data: dept } = await adminClient.from('departments').select('id, name_en').eq('id', department_id).eq('is_active', true).maybeSingle();
  if (!dept) return res.status(404).json({ error: 'Department not found.', code: 'NOT_FOUND' });
  const userClient = createUserClient(req.accessToken);
  const { data, error } = await userClient.rpc('set_student_department', { p_department_id: department_id });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, department: dept, student: data });
});

router.get('/library', async (req, res) => {
  const userClient = createUserClient(req.accessToken);
  const { data, error } = await userClient.from('student_library')
    .select('*, documents(id, title, description, language, category, file_path, status)')
    .eq('student_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

router.post('/library', async (req, res) => {
  const { document_id, note } = req.body || {};
  if (!document_id) return res.status(400).json({ error: 'document_id is required.', code: 'VALIDATION_ERROR' });
  const userClient = createUserClient(req.accessToken);
  const { data, error } = await userClient.rpc('add_to_library', { p_document_id: document_id });
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already in library.', code: 'DUPLICATE' });
    return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  }
  if (note && data?.id) await adminClient.from('student_library').update({ note }).eq('id', data.id);
  return res.status(201).json(data);
});

router.delete('/library/:docId', async (req, res) => {
  const userClient = createUserClient(req.accessToken);
  const { data, error } = await userClient.rpc('remove_from_library', { p_document_id: req.params.docId });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: !!data });
});

module.exports = router;
