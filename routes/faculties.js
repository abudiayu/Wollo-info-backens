/**
 * routes/faculties.js
 *
 * Public:  GET  /api/public/faculties
 * Admin:   GET  /api/admin/faculties
 *          POST /api/admin/faculties
 *          PUT  /api/admin/faculties/:id
 *          DELETE /api/admin/faculties/:id
 *          GET  /api/admin/faculties/:id/departments
 *          POST /api/admin/faculties/:id/departments
 *          PUT  /api/admin/departments/:id
 *          DELETE /api/admin/departments/:id
 *
 * Mount in server.js:
 *   const { publicFacultiesRouter, adminFacultiesRouter } = require('./routes/faculties');
 *   app.use('/api/public',  publicFacultiesRouter(pool));
 *   app.use('/api/admin',   adminFacultiesRouter(pool));
 */

const express        = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const makeAdminOnly  = require('../middleware/adminOnly');

/* ── helpers ── */
function slugify(str) {
  return String(str)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function uniqueSlug(conn, table, base, excludeId = null) {
  let slug = base;
  let n    = 0;
  while (true) {
    const candidate = n === 0 ? slug : `${slug}-${n}`;
    const where     = excludeId
      ? 'slug = ? AND id != ?'
      : 'slug = ?';
    const params    = excludeId ? [candidate, excludeId] : [candidate];
    const [[row]]   = await conn.query(
      `SELECT id FROM \`${table}\` WHERE ${where} LIMIT 1`, params
    );
    if (!row) return candidate;
    n++;
  }
}

function ok(res, data, status = 200) {
  return res.status(status).json({ success: true, data });
}
function fail(res, status, message) {
  return res.status(status).json({ success: false, message });
}

/* ══════════════════════════════════════════════════
   PUBLIC router  — no auth required
══════════════════════════════════════════════════ */
function publicFacultiesRouter(pool) {
  const router = express.Router();

  /**
   * GET /api/public/faculties
   * Returns all faculties with their departments, ordered by sort_order.
   * Response shape: { success, data: [{ id, name, slug, color, image_url, description, departments: [...] }] }
   */
  router.get('/faculties', async (req, res) => {
    try {
      const [faculties] = await pool.query(
        `SELECT id, name, slug, color, image_url, description, sort_order
           FROM faculties
          ORDER BY sort_order ASC, name ASC`
      );

      if (!faculties.length) return ok(res, []);

      const [departments] = await pool.query(
        `SELECT id, faculty_id, name, slug, description, sort_order
           FROM departments
          WHERE faculty_id IS NOT NULL
          ORDER BY sort_order ASC, name ASC`
      );

      /* Group departments under their faculty */
      const deptMap = {};
      departments.forEach(d => {
        if (!deptMap[d.faculty_id]) deptMap[d.faculty_id] = [];
        deptMap[d.faculty_id].push(d);
      });

      const result = faculties.map(f => ({
        ...f,
        departments: deptMap[f.id] || [],
      }));

      return ok(res, result);
    } catch (err) {
      console.error('[GET /api/public/faculties]', err.message);
      return fail(res, 500, 'Failed to load faculties.');
    }
  });

  return router;
}

/* ══════════════════════════════════════════════════
   ADMIN router  — authMiddleware + adminOnly required
══════════════════════════════════════════════════ */
function adminFacultiesRouter(pool) {
  const router    = express.Router();
  const adminOnly = makeAdminOnly(pool);
  const auth      = [authMiddleware, adminOnly];

  /* ── GET /api/admin/faculties ── */
  router.get('/faculties', auth, async (req, res) => {
    try {
      const [faculties] = await pool.query(
        `SELECT id, name, slug, color, image_url, description, sort_order, created_at
           FROM faculties ORDER BY sort_order ASC, name ASC`
      );
      const [departments] = await pool.query(
        `SELECT id, faculty_id, name, slug, description, sort_order, created_at
           FROM departments WHERE faculty_id IS NOT NULL
           ORDER BY sort_order ASC, name ASC`
      );
      const deptMap = {};
      departments.forEach(d => {
        if (!deptMap[d.faculty_id]) deptMap[d.faculty_id] = [];
        deptMap[d.faculty_id].push(d);
      });
      return ok(res, faculties.map(f => ({ ...f, departments: deptMap[f.id] || [] })));
    } catch (err) {
      console.error('[GET /api/admin/faculties]', err.message);
      return fail(res, 500, 'Failed to load faculties.');
    }
  });

  /* ── POST /api/admin/faculties ── */
  router.post('/faculties', auth, async (req, res) => {
    try {
      const { name, color, image_url, description, sort_order } = req.body;
      if (!name?.trim()) return fail(res, 400, 'Name is required.');

      const base = slugify(name.trim());
      const slug = await uniqueSlug(pool, 'faculties', base);

      const [r] = await pool.query(
        `INSERT INTO faculties (name, slug, color, image_url, description, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [name.trim(), slug, color || '#2563eb', image_url || null,
         description || null, Number(sort_order) || 0]
      );
      const [[created]] = await pool.query('SELECT * FROM faculties WHERE id = ? LIMIT 1', [r.insertId]);
      return ok(res, { ...created, departments: [] }, 201);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A faculty with that name or slug already exists.');
      console.error('[POST /api/admin/faculties]', err.message);
      return fail(res, 500, 'Failed to create faculty.');
    }
  });

  /* ── PUT /api/admin/faculties/:id ── */
  router.put('/faculties/:id', auth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [[existing]] = await pool.query('SELECT * FROM faculties WHERE id = ? LIMIT 1', [id]);
      if (!existing) return fail(res, 404, 'Faculty not found.');

      const { name, color, image_url, description, sort_order } = req.body;
      const fields = []; const values = [];

      if (name !== undefined) {
        if (!String(name).trim()) return fail(res, 400, 'Name cannot be empty.');
        fields.push('name = ?');       values.push(String(name).trim());
        /* Re-slug only if name actually changed */
        if (String(name).trim() !== existing.name) {
          const slug = await uniqueSlug(pool, 'faculties', slugify(String(name).trim()), id);
          fields.push('slug = ?');     values.push(slug);
        }
      }
      if (color       !== undefined) { fields.push('color = ?');       values.push(color); }
      if (image_url   !== undefined) { fields.push('image_url = ?');   values.push(image_url || null); }
      if (description !== undefined) { fields.push('description = ?'); values.push(description || null); }
      if (sort_order  !== undefined) { fields.push('sort_order = ?');  values.push(Number(sort_order)); }

      if (fields.length) {
        values.push(id);
        await pool.query(`UPDATE faculties SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      const [[updated]] = await pool.query('SELECT * FROM faculties WHERE id = ? LIMIT 1', [id]);
      return ok(res, updated);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Slug or name already taken.');
      console.error('[PUT /api/admin/faculties/:id]', err.message);
      return fail(res, 500, 'Failed to update faculty.');
    }
  });

  /* ── DELETE /api/admin/faculties/:id ── */
  router.delete('/faculties/:id', auth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [[existing]] = await pool.query('SELECT id FROM faculties WHERE id = ? LIMIT 1', [id]);
      if (!existing) return fail(res, 404, 'Faculty not found.');

      /* CASCADE in DB will delete child departments */
      await pool.query('DELETE FROM faculties WHERE id = ?', [id]);
      return ok(res, { id });
    } catch (err) {
      console.error('[DELETE /api/admin/faculties/:id]', err.message);
      return fail(res, 500, 'Failed to delete faculty.');
    }
  });

  /* ── GET /api/admin/faculties/:id/departments ── */
  router.get('/faculties/:id/departments', auth, async (req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT * FROM departments WHERE faculty_id = ? ORDER BY sort_order ASC, name ASC`,
        [req.params.id]
      );
      return ok(res, rows);
    } catch (err) {
      return fail(res, 500, 'Failed to load departments.');
    }
  });

  /* ── POST /api/admin/faculties/:id/departments ── */
  router.post('/faculties/:id/departments', auth, async (req, res) => {
    try {
      const faculty_id = parseInt(req.params.id, 10);
      const [[faculty]] = await pool.query('SELECT id FROM faculties WHERE id = ? LIMIT 1', [faculty_id]);
      if (!faculty) return fail(res, 404, 'Faculty not found.');

      const { name, description, sort_order } = req.body;
      if (!name?.trim()) return fail(res, 400, 'Department name is required.');

      /* Build slug: faculty-slug/dept-slug */
      const [[fac]] = await pool.query('SELECT slug FROM faculties WHERE id = ? LIMIT 1', [faculty_id]);
      const deptBase = `${fac.slug}/${slugify(name.trim())}`;
      const slug     = await uniqueSlug(pool, 'departments', deptBase);

      const [r] = await pool.query(
        `INSERT INTO departments (faculty_id, name, slug, description, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [faculty_id, name.trim(), slug, description || null, Number(sort_order) || 0]
      );
      const [[created]] = await pool.query('SELECT * FROM departments WHERE id = ? LIMIT 1', [r.insertId]);
      return ok(res, created, 201);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, 'A department with that name or slug already exists.');
      console.error('[POST /api/admin/faculties/:id/departments]', err.message);
      return fail(res, 500, 'Failed to create department.');
    }
  });

  /* ── PUT /api/admin/departments/:id ── */
  router.put('/departments/:id', auth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [[existing]] = await pool.query('SELECT * FROM departments WHERE id = ? LIMIT 1', [id]);
      if (!existing) return fail(res, 404, 'Department not found.');

      const { name, description, sort_order, faculty_id } = req.body;
      const fields = []; const values = [];

      if (name !== undefined) {
        if (!String(name).trim()) return fail(res, 400, 'Name cannot be empty.');
        fields.push('name = ?'); values.push(String(name).trim());
        if (String(name).trim() !== existing.name) {
          /* Rebuild slug from faculty slug + new dept name */
          const facId = faculty_id || existing.faculty_id;
          const [[fac]] = await pool.query('SELECT slug FROM faculties WHERE id = ? LIMIT 1', [facId]);
          const base   = fac ? `${fac.slug}/${slugify(String(name).trim())}` : slugify(String(name).trim());
          const slug   = await uniqueSlug(pool, 'departments', base, id);
          fields.push('slug = ?'); values.push(slug);
        }
      }
      if (description !== undefined) { fields.push('description = ?'); values.push(description || null); }
      if (sort_order  !== undefined) { fields.push('sort_order = ?');  values.push(Number(sort_order)); }
      if (faculty_id  !== undefined) { fields.push('faculty_id = ?');  values.push(Number(faculty_id)); }

      if (fields.length) {
        values.push(id);
        await pool.query(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`, values);
      }

      const [[updated]] = await pool.query('SELECT * FROM departments WHERE id = ? LIMIT 1', [id]);
      return ok(res, updated);
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return fail(res, 409, 'Slug or name already taken.');
      console.error('[PUT /api/admin/departments/:id]', err.message);
      return fail(res, 500, 'Failed to update department.');
    }
  });

  /* ── DELETE /api/admin/departments/:id ── */
  router.delete('/departments/:id', auth, async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const [[existing]] = await pool.query('SELECT id FROM departments WHERE id = ? LIMIT 1', [id]);
      if (!existing) return fail(res, 404, 'Department not found.');
      await pool.query('DELETE FROM departments WHERE id = ?', [id]);
      return ok(res, { id });
    } catch (err) {
      console.error('[DELETE /api/admin/departments/:id]', err.message);
      return fail(res, 500, 'Failed to delete department.');
    }
  });

  return router;
}

module.exports = { publicFacultiesRouter, adminFacultiesRouter };
