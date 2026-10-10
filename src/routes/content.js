/**
 * src/routes/content.js
 *
 * Admin-only CRUD for content_items (legacy section-based content).
 * Mirrors the old MySQL behavior exactly:
 *   GET    /api/content           — list (filterable by section_id, status, search)
 *   GET    /api/content/:id       — single item with gallery
 *   POST   /api/content           — create
 *   PUT    /api/content/:id       — update
 *   PATCH  /api/content/:id/publish
 *   PATCH  /api/content/:id/unpublish
 *   DELETE /api/content/:id
 *   GET    /api/content/:id/versions
 *   POST   /api/content/:id/restore/:versionId
 */

'use strict';

const express        = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');
const { adminClient, createUserClient } = require('../config/supabase');

const router    = express.Router();
const adminAuth = [authMiddleware, requireRole('admin')];

// ── Sanitize HTML body ────────────────────────────────────────
function sanitizeBody(raw) {
  if (!raw) return '';
  return raw
    .replace(/<(script|style|iframe|object|embed|base|form|input|button)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|iframe|object|embed|base|input)[^>]*\/>/gi, '')
    .replace(/\s+on\w+="[^"]*"/gi, '')
    .replace(/\s+on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// ── GET /api/content ──────────────────────────────────────────
router.get('/', ...adminAuth, async (req, res) => {
  const { section_id, status, search } = req.query;

  let query = adminClient
    .from('content_items')
    .select(`
      *,
      sections(slug, title),
      users!content_items_created_by_fkey(full_name),
      cover:media_items(url, original_name)
    `)
    .order('sort_order', { ascending: true })
    .order('updated_at', { ascending: false });

  if (section_id) query = query.eq('section_id', section_id);
  if (status)     query = query.eq('status', status);
  if (search)     query = query.ilike('title', `%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

// ── GET /api/content/:id ──────────────────────────────────────
router.get('/:id', ...adminAuth, async (req, res) => {
  const { data, error } = await adminClient
    .from('content_items')
    .select(`*, sections(slug, title), cover:media_items(url, original_name)`)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'Content not found.', code: 'NOT_FOUND' });

  // gallery
  const { data: gallery } = await adminClient
    .from('content_media')
    .select('*, media_items(*)')
    .eq('content_id', data.id)
    .order('sort_order', { ascending: true });

  data.gallery = (gallery || []).map(g => g.media_items);
  return res.json(data);
});

// ── POST /api/content ─────────────────────────────────────────
router.post('/', ...adminAuth, async (req, res) => {
  const { section_id, title, body, status = 'draft', cover_media_id, sort_order = 0, gallery } = req.body;
  if (!section_id) return res.status(400).json({ error: 'section_id is required.', code: 'VALIDATION_ERROR' });
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required.', code: 'VALIDATION_ERROR' });

  const safeBody = sanitizeBody(body);

  const { data: item, error } = await adminClient
    .from('content_items')
    .insert({
      section_id,
      title: title.trim(),
      body: safeBody,
      status,
      cover_media_id: cover_media_id || null,
      sort_order,
      created_by: req.user.id,
    })
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  // version snapshot
  await adminClient.from('content_versions').insert({
    content_id: item.id,
    title: item.title,
    body: safeBody,
    edited_by: req.user.id,
  });

  // gallery
  if (Array.isArray(gallery)) {
    const galleryRows = gallery.map((mediaId, i) => ({ content_id: item.id, media_id: mediaId, sort_order: i }));
    if (galleryRows.length) await adminClient.from('content_media').upsert(galleryRows);
  }

  return res.status(201).json(item);
});

// ── PUT /api/content/:id ──────────────────────────────────────
router.put('/:id', ...adminAuth, async (req, res) => {
  const id = req.params.id;
  const { data: existing } = await adminClient.from('content_items').select('id, title').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Content not found.', code: 'NOT_FOUND' });

  const { title, body, status, cover_media_id, sort_order, gallery } = req.body;
  const safeBody = sanitizeBody(body);
  const patch = {};
  if (title          !== undefined) patch.title          = title.trim();
  if (body           !== undefined) patch.body           = safeBody;
  if (status         !== undefined) patch.status         = status;
  if (cover_media_id !== undefined) patch.cover_media_id = cover_media_id || null;
  if (sort_order     !== undefined) patch.sort_order     = sort_order;

  const { data: updated, error } = await adminClient
    .from('content_items')
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  // version snapshot
  await adminClient.from('content_versions').insert({
    content_id: id,
    title: patch.title ?? existing.title,
    body:  safeBody ?? '',
    edited_by: req.user.id,
  });

  // replace gallery
  if (Array.isArray(gallery)) {
    await adminClient.from('content_media').delete().eq('content_id', id);
    const rows = gallery.map((mId, i) => ({ content_id: id, media_id: mId, sort_order: i }));
    if (rows.length) await adminClient.from('content_media').insert(rows);
  }

  return res.json(updated);
});

// ── PATCH /api/content/:id/publish ───────────────────────────
router.patch('/:id/publish', ...adminAuth, async (req, res) => {
  const { error } = await adminClient
    .from('content_items')
    .update({ status: 'published', published_at: new Date().toISOString() })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'published' });
});

// ── PATCH /api/content/:id/unpublish ─────────────────────────
router.patch('/:id/unpublish', ...adminAuth, async (req, res) => {
  const { error } = await adminClient
    .from('content_items')
    .update({ status: 'draft', published_at: null })
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, status: 'draft' });
});

// ── DELETE /api/content/:id ───────────────────────────────────
router.delete('/:id', ...adminAuth, async (req, res) => {
  const { error } = await adminClient.from('content_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

// ── GET /api/content/:id/versions ────────────────────────────
router.get('/:id/versions', ...adminAuth, async (req, res) => {
  const { data, error } = await adminClient
    .from('content_versions')
    .select('*, users!content_versions_edited_by_fkey(full_name)')
    .eq('content_id', req.params.id)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json(data || []);
});

// ── POST /api/content/:id/restore/:versionId ─────────────────
router.post('/:id/restore/:versionId', ...adminAuth, async (req, res) => {
  const { data: ver } = await adminClient
    .from('content_versions')
    .select('*')
    .eq('id', req.params.versionId)
    .eq('content_id', req.params.id)
    .maybeSingle();

  if (!ver) return res.status(404).json({ error: 'Version not found.', code: 'NOT_FOUND' });

  const { error } = await adminClient
    .from('content_items')
    .update({ title: ver.title, body: ver.body, status: 'draft' })
    .eq('id', req.params.id);

  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, restored: ver });
});

module.exports = router;
