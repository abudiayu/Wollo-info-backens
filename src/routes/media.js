/**
 * src/routes/media.js
 *
 * Uploads go to Supabase Storage (media bucket).
 * multer is used only for in-memory buffering (no disk write).
 *
 * POST   /api/media/upload    — upload files (admin | head | staff)
 * GET    /api/media           — list media_items (admin)
 * DELETE /api/media/:id       — delete from storage + DB (admin)
 */

'use strict';

const express        = require('express');
const crypto         = require('crypto');
const path           = require('path');
const multer         = require('multer');
const { adminClient } = require('../config/supabase');
const authMiddleware = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');

const router = express.Router();

// ── multer: memory storage (buffer, no disk) ─────────────────
const BLOCKED_EXT = new Set([
  '.exe','.bat','.cmd','.sh','.msi','.ps1','.vbs','.jar',
  '.com','.dll','.php','.py','.rb','.pl','.cgi','.htaccess',
]);

const MAX_FILE  = 20 * 1024 * 1024;  // 20 MB
const MAX_IMAGE =  5 * 1024 * 1024;  //  5 MB
const IMAGE_MIMES = new Set(['image/jpeg','image/png','image/gif','image/webp','image/svg+xml']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (BLOCKED_EXT.has(ext)) return cb(new Error(`File type "${ext}" is not allowed.`));
    cb(null, true);
  },
});

function guessType(mime) {
  return IMAGE_MIMES.has(mime) ? 'image' : 'file';
}

// ── POST /api/media/upload ────────────────────────────────────
router.post('/upload', authMiddleware, requireRole('admin', 'head', 'staff'), (req, res) => {
  upload.array('files', 50)(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File exceeds the 20 MB limit.', code: 'FILE_TOO_LARGE' });
      return res.status(400).json({ error: err.message || 'Upload failed.', code: 'UPLOAD_ERROR' });
    }

    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded.', code: 'NO_FILES' });

    const uploaded = [];

    for (const f of files) {
      if (IMAGE_MIMES.has(f.mimetype) && f.size > MAX_IMAGE) {
        return res.status(400).json({ error: `Image "${f.originalname}" exceeds the 5 MB limit.`, code: 'IMAGE_TOO_LARGE' });
      }

      const ext        = path.extname(f.originalname).toLowerCase();
      const storedName = `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${ext}`;

      // Scope path for heads: department/<dept-id>/filename
      const storagePath = req.role === 'head' && req.departmentId
        ? `department/${req.departmentId}/${storedName}`
        : storedName;

      const { error: storageError } = await adminClient.storage
        .from('media')
        .upload(storagePath, f.buffer, {
          contentType: f.mimetype,
          upsert:      false,
        });

      if (storageError) {
        console.error('[media upload] storage error:', storageError.message);
        return res.status(500).json({ error: storageError.message, code: 'STORAGE_ERROR' });
      }

      // Get public URL
      const { data: { publicUrl } } = adminClient.storage.from('media').getPublicUrl(storagePath);

      // Save to media_items table
      const { data: record, error: dbError } = await adminClient
        .from('media_items')
        .insert({
          original_name: f.originalname,
          stored_name:   storedName,
          mime_type:     f.mimetype,
          size:          f.size,
          type:          guessType(f.mimetype),
          storage_path:  storagePath,
          url:           publicUrl,
          uploaded_by:   req.user.id,
        })
        .select()
        .single();

      if (dbError) {
        console.error('[media upload] DB error:', dbError.message);
        return res.status(500).json({ error: dbError.message, code: 'DB_ERROR' });
      }

      uploaded.push({
        id:            record.id,
        original_name: f.originalname,
        stored_name:   storedName,
        mime_type:     f.mimetype,
        size:          f.size,
        type:          guessType(f.mimetype),
        url:           publicUrl,
      });
    }

    return res.status(201).json(uploaded);
  });
});

// ── GET /api/media ────────────────────────────────────────────
router.get('/', authMiddleware, requireRole('admin'), async (req, res) => {
  const { type, search } = req.query;

  let query = adminClient.from('media_items').select('*, users(full_name)').order('created_at', { ascending: false });
  if (type)   query = query.eq('type', type);
  if (search) query = query.ilike('original_name', `%${search}%`);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ files: data || [], folders: [] });
});

// ── DELETE /api/media/:id ─────────────────────────────────────
router.delete('/:id', authMiddleware, requireRole('admin'), async (req, res) => {
  const { data: row } = await adminClient.from('media_items').select('*').eq('id', req.params.id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Media not found.', code: 'NOT_FOUND' });

  // Delete from Supabase Storage
  if (row.storage_path) {
    const { error: storageErr } = await adminClient.storage.from('media').remove([row.storage_path]);
    if (storageErr) console.warn('[media delete] storage warning:', storageErr.message);
  }

  // Delete DB record
  const { error } = await adminClient.from('media_items').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true });
});

module.exports = router;
