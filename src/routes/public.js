'use strict';
/**
 * src/routes/public.js — unauthenticated read-only routes
 *
 * GET /api/public/health                  — quick liveness check
 * GET /api/public/departments             — flat department list (signup form)
 * GET /api/public/departments/:id/reviews — published reviews for one dept
 * GET /api/public/faculties               — faculties + nested departments (nav)
 * GET /api/public/motivations             — published motivations
 * GET /api/public/opportunities           — published opportunities
 * GET /api/public/sections/:slug          — published content items by section
 *
 * All routes use the service-role adminClient so RLS never blocks them.
 * No auth middleware is applied anywhere in this file.
 */

const express       = require('express');
const { adminClient } = require('../config/supabase');

const router = express.Router();

// ── Quick health ping (useful for Vercel → Render cold-start checks) ──
router.get('/health', (_req, res) => res.json({ ok: true }));

// ── GET /api/public/departments/:id/reviews ──────────────────────
// IMPORTANT: this specific route MUST be registered BEFORE the
// generic /departments route, otherwise Express matches /departments
// as the flat-list handler and the :id param never fires.
router.get('/departments/:id/reviews', async (req, res) => {
  const { data, error } = await adminClient
    .from('department_reviews')
    .select('id, reviewer_name, role, rating, comment, created_at')
    .or(`department_id.eq.${req.params.id},department_slug.eq.${req.params.id}`)
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) return res.status(500).json({ error: error.message });

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

// ── GET /api/public/departments ───────────────────────────────────
// Returns { departments: [ { id, name, name_en, name_am, slug,
//                             faculty_id, faculty_name } ] }
// Uses two separate queries (no PostgREST join syntax) so the
// lightweight fetch shim works identically to the full Supabase SDK.
router.get('/departments', async (_req, res) => {
  try {
    // 1. Fetch departments
    const { data: depts, error: dErr } = await adminClient
      .from('departments')
      .select('id, name_en, name_am, slug, faculty_id, is_active')
      .eq('is_active', true)
      .order('name_en', { ascending: true });

    if (dErr) {
      console.error('[public/departments] dept query error:', dErr.message);
      return res.status(500).json({ error: dErr.message });
    }

    if (!depts || depts.length === 0) {
      return res.json({ departments: [] });
    }

    // 2. Fetch faculty names for the departments we got
    const facultyIds = [...new Set(depts.map(d => d.faculty_id).filter(Boolean))];
    let facMap = {};
    if (facultyIds.length > 0) {
      const { data: facs } = await adminClient
        .from('faculties')
        .select('id, name_en')
        .in('id', facultyIds);
      facMap = Object.fromEntries((facs || []).map(f => [f.id, f.name_en]));
    }

    const departments = depts.map(d => ({
      id:           d.id,
      name:         d.name_en,      // convenient short alias
      name_en:      d.name_en,
      name_am:      d.name_am  || null,
      slug:         d.slug,
      faculty_id:   d.faculty_id   || null,
      faculty_name: d.faculty_id   ? (facMap[d.faculty_id] || null) : null,
    }));

    return res.json({ departments });
  } catch (err) {
    console.error('[public/departments] unexpected error:', err.message);
    return res.status(500).json({ error: 'Failed to load departments.' });
  }
});

// ── GET /api/public/faculties ─────────────────────────────────────
// Returns { success: true, data: [ { ...faculty, departments: [...] } ] }
router.get('/faculties', async (_req, res) => {
  try {
    const { data: faculties, error: fErr } = await adminClient
      .from('faculties')
      .select('id, name_en, name_am, slug, color, image_url, description, sort_order')
      .order('sort_order', { ascending: true });

    if (fErr) return res.status(500).json({ error: fErr.message });

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
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/motivations ───────────────────────────────────
router.get('/motivations', async (req, res) => {
  try {
    const { department_id } = req.query;
    let query = adminClient
      .from('motivations')
      .select('id, title, details, media_url, department_id, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (department_id) query = query.eq('department_id', department_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/opportunities ────────────────────────────────
router.get('/opportunities', async (req, res) => {
  try {
    const { department_id } = req.query;
    let query = adminClient
      .from('opportunities')
      .select('id, title, details, link, deadline, department_id, created_at')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (department_id) query = query.eq('department_id', department_id);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /api/public/sections/:slug ───────────────────────────────
router.get('/sections/:slug', async (req, res) => {
  try {
    const { data: section } = await adminClient
      .from('sections')
      .select('*')
      .eq('slug', req.params.slug)
      .maybeSingle();

    if (!section) {
      return res.status(404).json({ error: `Section "${req.params.slug}" not found.` });
    }

    const { data: items, error } = await adminClient
      .from('content_items')
      .select('id, title, body, published_at, sort_order')
      .eq('section_id', section.id)
      .eq('status', 'published')
      .order('sort_order', { ascending: true })
      .order('published_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.json({ section, items: items || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
