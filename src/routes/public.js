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

// ── GET /api/public/departments/:id/reviews ──────────────────
// MUST be before the flat /departments route so Express doesn't
// match /:id as a department list request.
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

// ── GET /api/public/departments ──────────────────────────────
// Flat list of all active departments — used by the registration form.
// Two separate queries (no join) so the fetch shim works reliably.
router.get('/departments', async (_req, res) => {
  const { data: depts, error } = await adminClient
    .from('departments')
    .select('id, name_en, name_am, slug, faculty_id, is_active')
    .eq('is_active', true)
    .order('name_en', { ascending: true });

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!depts || depts.length === 0) return res.json([]);

  // Fetch faculty names separately so the shim's simple fetch works
  const facultyIds = [...new Set(depts.map(d => d.faculty_id).filter(Boolean))];
  let facMap = {};
  if (facultyIds.length > 0) {
    const { data: facs } = await adminClient
      .from('faculties')
      .select('id, name_en')
      .in('id', facultyIds);
    facMap = Object.fromEntries((facs || []).map(f => [f.id, f.name_en]));
  }

  const result = depts.map(d => ({
    id:           d.id,
    name_en:      d.name_en,
    name_am:      d.name_am || null,
    name:         d.name_en,
    slug:         d.slug,
    faculty_id:   d.faculty_id,
    faculty_name: d.faculty_id ? (facMap[d.faculty_id] || null) : null,
  }));

  return res.json(result);
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


module.exports = router;
