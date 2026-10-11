/**
 * src/routes/departments.js
 *
 * Public + authenticated department endpoints.
 * Reviews sub-resource lives here to keep backward compat with
 * the old /api/departments/:id/reviews path.
 *
 * GET  /api/departments               — list active departments
 * GET  /api/departments/:id           — single department detail
 * GET  /api/departments/:id/reviews   — reviews for a department (public)
 * POST /api/departments/:id/reviews   — post a review (authenticated)
 */

'use strict';

const express        = require('express');
const { adminClient, createUserClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

const VALID_ROLES = ['Student', 'Graduate', 'Visitor'];

// ── GET /api/departments ──────────────────────────────────────
router.get('/', async (req, res) => {
  const { faculty_id, search } = req.query;

  let query = adminClient
    .from('departments')
    .select('*, faculties(id, name_en, slug, color)')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (faculty_id) query = query.eq('faculty_id', faculty_id);
  if (search)     query = query.ilike('name_en', `%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

// ── GET /api/departments/:id ──────────────────────────────────
router.get('/:id', async (req, res) => {
  const { data, error } = await adminClient
    .from('departments')
    .select('*, faculties(id, name_en, slug, color), programs(*)')
    .eq('id', req.params.id)
    .eq('is_active', true)
    .maybeSingle();

  if (error)  return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Department not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

// ── GET /api/departments/:id/reviews ─────────────────────────
router.get('/:id/reviews', async (req, res) => {
  const { data, error } = await adminClient
    .from('department_reviews')
    .select('id, reviewer_name, role, rating, comment, created_at')
    .or(`department_id.eq.${req.params.id},department_slug.eq.${req.params.id}`)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[GET reviews]', error.message);
    return res.status(500).json({ error: 'Failed to load reviews.', code: 'DB_ERROR' });
  }

  // Format date for frontend backward compat (e.g. "Jan 2025")
  const reviews = (data || []).map(r => ({
    id:      r.id,
    name:    r.reviewer_name,
    role:    r.role,
    rating:  r.rating,
    comment: r.comment,
    date:    new Date(r.created_at).toLocaleString('en-US', { month: 'short', year: 'numeric' }),
  }));

  return res.json({ reviews });
});

// ── POST /api/departments/:id/reviews ────────────────────────
router.post('/:id/reviews', authMiddleware, async (req, res) => {
  const { name, role = 'Student', rating, comment } = req.body || {};

  // Manual validation
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required.', code: 'VALIDATION_ERROR' });
  if (!['Student','Graduate','Visitor'].includes(role)) return res.status(400).json({ error: 'Role must be Student, Graduate or Visitor.', code: 'VALIDATION_ERROR' });
  const ratingNum = Number(rating);
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) return res.status(400).json({ error: 'Rating must be 1–5.', code: 'VALIDATION_ERROR' });
  const trimmedComment = String(comment ?? '').trim();
  if (trimmedComment.length < 10) return res.status(400).json({ error: 'Comment must be at least 10 characters.', code: 'VALIDATION_ERROR' });
  if (trimmedComment.length > 1000) return res.status(400).json({ error: 'Comment must be 1000 characters or fewer.', code: 'VALIDATION_ERROR' });

  // Use user client so RLS applies (reviews_insert_authenticated policy)
  const userClient = createUserClient(req.accessToken);

  // Check if department_id is a valid UUID or a slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id);

  const insertData = {
    reviewer_name: name.trim().slice(0, 120),
    role,
    rating,
    comment:    comment.trim(),
    status:     'published',
    student_id: req.user.id,
  };

  if (isUuid) {
    insertData.department_id = req.params.id;
  } else {
    insertData.department_slug = req.params.id;
  }

  const { data, error } = await userClient
    .from('department_reviews')
    .insert(insertData)
    .select()
    .single();

  if (error) {
    console.error('[POST review]', error.message);
    return res.status(500).json({ error: 'Failed to save review.', code: 'DB_ERROR' });
  }

  return res.status(201).json({
    review: {
      id:      data.id,
      name:    data.reviewer_name,
      role:    data.role,
      rating:  data.rating,
      comment: data.comment,
      date:    new Date(data.created_at).toLocaleString('en-US', { month: 'short', year: 'numeric' }),
    },
  });
});

module.exports = router;
