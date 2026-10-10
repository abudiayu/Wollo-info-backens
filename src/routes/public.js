/**
 * src/routes/public.js
 *
 * Unauthenticated read-only routes — only published/active data.
 *
 * GET /api/public/sections/:slug   — published content items by section
 * GET /api/public/faculties        — all faculties + departments (for nav bar)
 * GET /api/public/motivations      — published motivations (overview page)
 * GET /api/public/opportunities    — published opportunities
 * GET /api/public/departments/:id/reviews  — reviews (no auth)
 */

'use strict';

const express        = require('express');
const { adminClient } = require('../config/supabase');

const router = express.Router();

// ── GET /api/public/sections/:slug ───────────────────────────
router.get('/sections/:slug', async (req, res) => {
  const { data: section } = await adminClient
    .from('sections')
    .select('*')
    .eq('slug', req.params.slug)
    .maybeSingle();

  if (!section) {
    return res.status(404).json({ error: `Section "${req.params.slug}" not found.`, code: 'NOT_FOUND' });
  }

  const { data: items, error } = await adminClient
    .from('content_items')
    .select('id, title, body, published_at, sort_order, cover:media_items(url, original_name)')
    .eq('section_id', section.id)
    .eq('status', 'published')
    .order('sort_order', { ascending: true })
    .order('published_at', { ascending: false });

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  // Attach gallery to each item
  for (const item of items || []) {
    const { data: gallery } = await adminClient
      .from('content_media')
      .select('media_items(id, url, original_name, mime_type, type)')
      .eq('content_id', item.id)
      .order('sort_order', { ascending: true });

    item.gallery = (gallery || []).map(g => g.media_items).filter(Boolean);
  }

  return res.json({ section, items: items || [] });
});

// ── GET /api/public/faculties ─────────────────────────────────
// Used by the nav bar dropdown — returns all faculties + their departments.
router.get('/faculties', async (_req, res) => {
  const { data: faculties, error: fErr } = await adminClient
    .from('faculties')
    .select('id, name_en, name_am, slug, color, image_url, description, sort_order')
    .order('sort_order', { ascending: true });

  if (fErr) return res.status(500).json({ error: fErr.message, code: 'DB_ERROR' });

  const { data: departments } = await adminClient
    .from('departments')
    .select('id, faculty_id, name_en, name_am, slug, description, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  const deptMap = {};
  for (const d of departments || []) {
    if (!deptMap[d.faculty_id]) deptMap[d.faculty_id] = [];
    deptMap[d.faculty_id].push(d);
  }

  const result = (faculties || []).map(f => ({
    ...f,
    departments: deptMap[f.id] || [],
  }));

  return res.json({ success: true, data: result });
});

// ── GET /api/public/motivations ───────────────────────────────
router.get('/motivations', async (req, res) => {
  const { department_id } = req.query;

  let query = adminClient
    .from('motivations')
    .select('id, title, details, media_url, department_id, created_at, departments(name_en, slug)')
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (department_id) query = query.eq('department_id', department_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

// ── GET /api/public/opportunities ────────────────────────────
router.get('/opportunities', async (req, res) => {
  const { department_id } = req.query;

  let query = adminClient
    .from('opportunities')
    .select('id, title, details, link, deadline, department_id, created_at, departments(name_en, slug)')
    .eq('status', 'published')
    .order('created_at', { ascending: false });

  if (department_id) query = query.eq('department_id', department_id);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

// ── GET /api/public/departments/:id/reviews ──────────────────
router.get('/departments/:id/reviews', async (req, res) => {
  const { data, error } = await adminClient
    .from('department_reviews')
    .select('id, reviewer_name, role, rating, comment, created_at')
    .or(`department_id.eq.${req.params.id},department_slug.eq.${req.params.id}`)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

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

module.exports = router;
