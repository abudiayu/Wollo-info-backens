'use strict';
/**
 * src/routes/admin.js — complete rewrite
 * All DB calls use adminClient (service-role) which bypasses RLS.
 * NO RPCs that call is_admin() — those fail when auth.uid() is null.
 */

const express         = require('express');
const authMiddleware  = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleGuard');
const { adminClient } = require('../config/supabase');

const router    = express.Router();
const adminOnly = [authMiddleware, requireRole('admin')];

// ── helpers ───────────────────────────────────────────────────
function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
async function uniqueSlug(table, base, excludeId) {
  let n = 0;
  while (true) {
    const candidate = n === 0 ? base : `${base}-${n}`;
    let q = adminClient.from(table).select('id').eq('slug', candidate);
    if (excludeId) q = q.neq('id', excludeId);
    const { data } = await q.maybeSingle();
    if (!data) return candidate;
    n++;
  }
}
function isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '')); }

// Build a merged user object from raw table rows
function mergeUser(u, sp, deptName, st) {
  return {
    ...u,
    id:                    u.id,
    role:                  sp?.role            ?? 'student',
    department_id:         sp?.department_id   ?? null,
    department_name:       deptName            ?? null,
    title:                 sp?.title           ?? null,
    office_number:         sp?.office_number   ?? null,
    student_number:        st?.student_number  ?? null,
    year_of_study:         st?.year_of_study   ?? null,
    student_department_id: st?.department_id   ?? null,
  };
}

// ════════════════════════════════════════════════════════════════
// USERS
// ════════════════════════════════════════════════════════════════

// GET /api/admin/users
router.get('/users', ...adminOnly, async (req, res) => {
  const [
    { data: users,  error: uErr },
    { data: staff  },
    { data: depts  },
    { data: stus   },
  ] = await Promise.all([
    adminClient.from('users').select('*').order('created_at', { ascending: false }),
    adminClient.from('staff_profiles').select('user_id,role,department_id,title,office_number'),
    adminClient.from('departments').select('id,name_en'),
    adminClient.from('students').select('user_id,student_number,year_of_study,department_id'),
  ]);
  if (uErr) return res.status(500).json({ error: uErr.message, code: 'DB_ERROR' });

  const staffMap = Object.fromEntries((staff || []).map(s => [s.user_id, s]));
  const deptMap  = Object.fromEntries((depts || []).map(d => [d.id, d.name_en]));
  const stuMap   = Object.fromEntries((stus  || []).map(s => [s.user_id, s]));

  const result = (users || []).map(u => {
    const sp = staffMap[u.id];
    return mergeUser(u, sp, sp?.department_id ? deptMap[sp.department_id] : null, stuMap[u.id]);
  });
  return res.json(result);
});

// PUT /api/admin/users/:id
router.put('/users/:id', ...adminOnly, async (req, res) => {
  const { full_name, username } = req.body || {};
  if (!full_name?.trim() && !username?.trim())
    return res.status(400).json({ error: 'Provide full_name or username.', code: 'VALIDATION_ERROR' });
  const patch = {};
  if (full_name?.trim()) patch.full_name = full_name.trim();
  if (username?.trim())  patch.username  = username.trim();
  const { data, error } = await adminClient.from('users').update(patch).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  if (!data)  return res.status(404).json({ error: 'User not found.', code: 'NOT_FOUND' });
  return res.json(data);
});

// PATCH /api/admin/users/:id/password
router.patch('/users/:id/password', ...adminOnly, async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.', code: 'VALIDATION_ERROR' });
  if (req.params.id === req.user.id)
    return res.status(400).json({ error: 'Use profile settings to change your own password.', code: 'SELF_PASSWORD' });
  const { error } = await adminClient.auth.admin.updateUserById(req.params.id, { password });
  if (error) return res.status(500).json({ error: error.message, code: 'PASSWORD_RESET_FAILED' });
  return res.json({ success: true });
});

// PATCH /api/admin/users/:id/role
router.patch('/users/:id/role', ...adminOnly, async (req, res) => {
  const { role, department_id } = req.body || {};
  if (!['admin','head','staff','student'].includes(role))
    return res.status(400).json({ error: 'Invalid role.', code: 'VALIDATION_ERROR' });
  if (req.params.id === req.user.id && role !== 'admin')
    return res.status(403).json({ error: 'You cannot change your own role.', code: 'SELF_ROLE_CHANGE' });

  if (role === 'student') {
    await adminClient.from('staff_profiles').delete().eq('user_id', req.params.id);
    await adminClient.from('students').upsert({ user_id: req.params.id }, { onConflict: 'user_id' });
    return res.json({ success: true, role: 'student' });
  }
  // DELETE + INSERT bypasses the prevent_role_escalation trigger
  await adminClient.from('staff_profiles').delete().eq('user_id', req.params.id);
  const { error } = await adminClient.from('staff_profiles').insert({
    user_id: req.params.id, role, department_id: department_id || null,
  });
  if (error) return res.status(500).json({ error: error.message, code: 'ROLE_ASSIGN_FAILED' });
  return res.json({ success: true, role });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', ...adminOnly, async (req, res) => {
  if (req.params.id === req.user.id)
    return res.status(403).json({ error: 'You cannot delete your own account.', code: 'SELF_DELETE' });
  const { error } = await adminClient.auth.admin.deleteUser(req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DELETE_FAILED' });
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════════
// STAFF & HEADS
// ════════════════════════════════════════════════════════════════

// GET /api/admin/staff
router.get('/staff', ...adminOnly, async (req, res) => {
  const { search, role: roleFilter } = req.query;

  let spQuery = adminClient
    .from('staff_profiles')
    .select('user_id,role,department_id,title,office_number,created_at');

  if (roleFilter && ['head','staff'].includes(roleFilter)) {
    spQuery = spQuery.eq('role', roleFilter);
  } else {
    spQuery = spQuery.in('role', ['head','staff']);
  }

  const { data: spRows, error: spErr } = await spQuery;
  if (spErr) return res.status(500).json({ error: spErr.message, code: 'DB_ERROR' });
  if (!spRows?.length) return res.json([]);

  const ids = spRows.map(s => s.user_id);
  const [{ data: users }, { data: depts }] = await Promise.all([
    adminClient.from('users').select('id,full_name,username,email,avatar_url,is_active,created_at').in('id', ids),
    adminClient.from('departments').select('id,name_en'),
  ]);

  const uMap = Object.fromEntries((users || []).map(u => [u.id, u]));
  const dMap = Object.fromEntries((depts || []).map(d => [d.id, d.name_en]));

  let list = spRows.map(sp => ({
    id:              sp.user_id,
    role:            sp.role,
    department_id:   sp.department_id,
    department_name: sp.department_id ? dMap[sp.department_id] : null,
    title:           sp.title,
    office_number:   sp.office_number,
    full_name:       uMap[sp.user_id]?.full_name  || '',
    username:        uMap[sp.user_id]?.username   || null,
    email:           uMap[sp.user_id]?.email      || '',
    avatar_url:      uMap[sp.user_id]?.avatar_url || null,
    is_active:       uMap[sp.user_id]?.is_active  ?? true,
    created_at:      uMap[sp.user_id]?.created_at || sp.created_at,
  }));

  list.sort((a, b) => {
    if (a.role !== b.role) return a.role === 'head' ? -1 : 1;
    return (a.full_name || '').localeCompare(b.full_name || '');
  });

  if (search?.trim()) {
    const q = search.trim().toLowerCase();
    list = list.filter(s =>
      s.full_name?.toLowerCase().includes(q) ||
      s.email?.toLowerCase().includes(q) ||
      s.department_name?.toLowerCase().includes(q) ||
      s.title?.toLowerCase().includes(q)
    );
  }
  return res.json(list);
});

// GET /api/admin/staff/:id
router.get('/staff/:id', ...adminOnly, async (req, res) => {
  const [{ data: u }, { data: sp }] = await Promise.all([
    adminClient.from('users').select('*').eq('id', req.params.id).maybeSingle(),
    adminClient.from('staff_profiles').select('*').eq('user_id', req.params.id).maybeSingle(),
  ]);
  if (!u) return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  let deptName = null;
  if (sp?.department_id) {
    const { data: d } = await adminClient.from('departments').select('name_en').eq('id', sp.department_id).maybeSingle();
    deptName = d?.name_en || null;
  }
  return res.json(mergeUser(u, sp, deptName, null));
});

// POST /api/admin/staff — create new head or staff account
router.post('/staff', ...adminOnly, async (req, res) => {
  const { email, password, full_name, username, role, department_id, title, office_number } = req.body || {};

  // Validate
  if (!isEmail(email))
    return res.status(400).json({ error: 'A valid email is required.', code: 'VALIDATION_ERROR' });
  if (!full_name?.trim())
    return res.status(400).json({ error: 'Full name is required.', code: 'VALIDATION_ERROR' });
  if (!password || String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.', code: 'VALIDATION_ERROR' });
  if (!['head','staff'].includes(role))
    return res.status(400).json({ error: "Role must be 'head' or 'staff'.", code: 'VALIDATION_ERROR' });
  if (role === 'head' && !department_id)
    return res.status(400).json({ error: 'A department is required for a department head.', code: 'VALIDATION_ERROR' });

  // Check no existing head for this dept
  if (role === 'head' && department_id) {
    const { data: dept } = await adminClient.from('departments').select('id,name_en').eq('id', department_id).eq('is_active', true).maybeSingle();
    if (!dept) return res.status(404).json({ error: 'Department not found.', code: 'NOT_FOUND' });
    const { data: existHead } = await adminClient.from('staff_profiles').select('user_id').eq('role','head').eq('department_id', department_id).maybeSingle();
    if (existHead) return res.status(409).json({ error: `"${dept.name_en}" already has a head. Remove them first.`, code: 'DEPT_HEAD_EXISTS' });
  }

  // Check username unique
  if (username?.trim()) {
    const { data: exUser } = await adminClient.from('users').select('id').eq('username', username.trim()).maybeSingle();
    if (exUser) return res.status(409).json({ error: 'Username already taken.', code: 'USERNAME_TAKEN' });
  }

  // Create auth user
  const { data: created, error: authErr } = await adminClient.auth.admin.createUser({
    email: email.trim().toLowerCase(),
    password,
    email_confirm: true,
    user_metadata: { full_name: full_name.trim(), username: username?.trim() || null, app_role: role, department_id: department_id || null },
  });
  if (authErr) {
    if (authErr.message?.toLowerCase().includes('already'))
      return res.status(409).json({ error: 'Email already exists.', code: 'EMAIL_TAKEN' });
    return res.status(500).json({ error: authErr.message, code: 'CREATE_FAILED' });
  }

  const uid = created.user.id;

  // Wait for trigger then repair rows
  await new Promise(r => setTimeout(r, 800));

  await adminClient.from('users').upsert(
    { id: uid, full_name: full_name.trim(), username: username?.trim() || null, email: email.trim().toLowerCase(), is_active: true },
    { onConflict: 'id' }
  );
  await adminClient.from('students').delete().eq('user_id', uid);

  // DELETE + INSERT on staff_profiles (bypasses prevent_role_escalation trigger)
  await adminClient.from('staff_profiles').delete().eq('user_id', uid);
  const { error: spErr } = await adminClient.from('staff_profiles').insert({
    user_id: uid, role, department_id: department_id || null,
    title: title?.trim() || null, office_number: office_number?.trim() || null,
  });
  if (spErr) {
    await adminClient.auth.admin.deleteUser(uid).catch(() => {});
    return res.status(500).json({ error: spErr.message, code: 'PROFILE_SETUP_FAILED' });
  }

  // Fetch and return the created record
  const [{ data: uRow }, { data: spRow }] = await Promise.all([
    adminClient.from('users').select('*').eq('id', uid).maybeSingle(),
    adminClient.from('staff_profiles').select('*').eq('user_id', uid).maybeSingle(),
  ]);
  let deptName = null;
  if (department_id) {
    const { data: dRow } = await adminClient.from('departments').select('name_en').eq('id', department_id).maybeSingle();
    deptName = dRow?.name_en || null;
  }
  return res.status(201).json(mergeUser(uRow || { id: uid, email: email.trim().toLowerCase(), full_name: full_name.trim() }, spRow, deptName, null));
});

// PATCH /api/admin/staff/:id
router.patch('/staff/:id', ...adminOnly, async (req, res) => {
  const { full_name, username, title, office_number, role, department_id, password } = req.body || {};
  const uid = req.params.id;

  // Verify exists
  const { data: existingSP } = await adminClient.from('staff_profiles').select('*').eq('user_id', uid).maybeSingle();
  const { data: existingU  } = await adminClient.from('users').select('*').eq('id', uid).maybeSingle();
  if (!existingU) return res.status(404).json({ error: 'Staff member not found.', code: 'NOT_FOUND' });

  // Password
  if (password) {
    if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.', code: 'VALIDATION_ERROR' });
    const { error: pwErr } = await adminClient.auth.admin.updateUserById(uid, { password });
    if (pwErr) return res.status(500).json({ error: pwErr.message, code: 'PASSWORD_RESET_FAILED' });
  }

  // Name / username
  const uPatch = {};
  if (full_name?.trim()) uPatch.full_name = full_name.trim();
  if (username?.trim())  uPatch.username  = username.trim();
  if (Object.keys(uPatch).length) {
    const { error: uErr } = await adminClient.from('users').update(uPatch).eq('id', uid);
    if (uErr) return res.status(500).json({ error: uErr.message, code: 'UPDATE_FAILED' });
  }

  // Title / office (without touching role)
  const newRole = role || existingSP?.role || 'staff';
  const newDept = department_id !== undefined ? (department_id || null) : (existingSP?.department_id || null);
  const newTitle  = title         !== undefined ? (title?.trim()         || null) : (existingSP?.title         || null);
  const newOffice = office_number !== undefined ? (office_number?.trim() || null) : (existingSP?.office_number || null);

  const roleChanged = newRole !== existingSP?.role;
  const deptChanged = newDept !== existingSP?.department_id;

  if (roleChanged || deptChanged) {
    if (!['head','staff'].includes(newRole))
      return res.status(400).json({ error: "Role must be 'head' or 'staff'.", code: 'VALIDATION_ERROR' });
    if (newRole === 'head' && !newDept)
      return res.status(400).json({ error: 'A department is required for a head.', code: 'VALIDATION_ERROR' });
    if (newRole === 'head' && newDept) {
      const { data: otherHead } = await adminClient.from('staff_profiles').select('user_id').eq('role','head').eq('department_id', newDept).neq('user_id', uid).maybeSingle();
      if (otherHead) {
        const { data: d } = await adminClient.from('departments').select('name_en').eq('id', newDept).maybeSingle();
        return res.status(409).json({ error: `"${d?.name_en || 'That department'}" already has a head. Remove them first.`, code: 'DEPT_HEAD_EXISTS' });
      }
    }
    // DELETE + INSERT to bypass prevent_role_escalation trigger
    await adminClient.from('staff_profiles').delete().eq('user_id', uid);
    const { error: reErr } = await adminClient.from('staff_profiles').insert({
      user_id: uid, role: newRole, department_id: newDept, title: newTitle, office_number: newOffice,
    });
    if (reErr) return res.status(500).json({ error: reErr.message, code: 'ROLE_UPDATE_FAILED' });
  } else if (title !== undefined || office_number !== undefined) {
    const { error: spUpdErr } = await adminClient.from('staff_profiles').update({ title: newTitle, office_number: newOffice }).eq('user_id', uid);
    if (spUpdErr) return res.status(500).json({ error: spUpdErr.message, code: 'UPDATE_FAILED' });
  }

  // Return updated record
  const [{ data: uRow }, { data: spRow }] = await Promise.all([
    adminClient.from('users').select('*').eq('id', uid).maybeSingle(),
    adminClient.from('staff_profiles').select('*').eq('user_id', uid).maybeSingle(),
  ]);
  let deptName = null;
  if (spRow?.department_id) {
    const { data: dRow } = await adminClient.from('departments').select('name_en').eq('id', spRow.department_id).maybeSingle();
    deptName = dRow?.name_en || null;
  }
  return res.json(mergeUser(uRow || existingU, spRow, deptName, null));
});

// DELETE /api/admin/staff/:id
router.delete('/staff/:id', ...adminOnly, async (req, res) => {
  const uid = req.params.id;
  if (uid === req.user.id) return res.status(403).json({ error: 'You cannot remove your own staff role.', code: 'SELF_DELETE' });
  const deleteAccount = req.query.deleteAccount === 'true';
  if (deleteAccount) {
    const { error } = await adminClient.auth.admin.deleteUser(uid);
    if (error) return res.status(500).json({ error: error.message, code: 'DELETE_FAILED' });
    return res.json({ success: true, deleted: 'account' });
  }
  await adminClient.from('staff_profiles').delete().eq('user_id', uid);
  await adminClient.from('students').upsert({ user_id: uid }, { onConflict: 'user_id' });
  return res.json({ success: true, deleted: 'role' });
});

// GET /api/admin/departments-list
router.get('/departments-list', ...adminOnly, async (req, res) => {
  const { data: depts, error } = await adminClient
    .from('departments')
    .select('id,name_en,slug,faculty_id,faculties(name_en)')
    .eq('is_active', true)
    .order('name_en', { ascending: true });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });

  const { data: heads } = await adminClient.from('staff_profiles').select('department_id').eq('role','head');
  const headSet = new Set((heads || []).map(h => h.department_id));

  const result = (depts || []).map(d => ({
    id:          d.id,
    name_en:     d.name_en,
    slug:        d.slug,
    faculty_id:  d.faculty_id,
    faculty_name: d.faculties?.name_en || 'Unknown Faculty',
    has_head:    headSet.has(d.id),
  }));
  return res.json(result);
});

// ════════════════════════════════════════════════════════════════
// FACULTIES & DEPARTMENTS
// ════════════════════════════════════════════════════════════════

router.get('/faculties', ...adminOnly, async (req, res) => {
  const [{ data: faculties, error }, { data: departments }] = await Promise.all([
    adminClient.from('faculties').select('*').order('sort_order', { ascending: true }),
    adminClient.from('departments').select('*').order('sort_order', { ascending: true }),
  ]);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  const dMap = {};
  for (const d of departments || []) { if (!dMap[d.faculty_id]) dMap[d.faculty_id] = []; dMap[d.faculty_id].push(d); }
  return res.json({ success: true, data: (faculties || []).map(f => ({ ...f, departments: dMap[f.id] || [] })) });
});

router.post('/faculties', ...adminOnly, async (req, res) => {
  const { name_en, name_am, color, image_url, description, sort_order } = req.body || {};
  if (!name_en?.trim()) return res.status(400).json({ error: 'name_en is required.', code: 'VALIDATION_ERROR' });
  const slug = await uniqueSlug('faculties', slugify(name_en));
  const { data, error } = await adminClient.from('faculties')
    .insert({ name_en: name_en.trim(), name_am: name_am || null, slug, color: color || '#2563eb', image_url: image_url || null, description: description || null, sort_order: Number(sort_order) || 0 })
    .select().single();
  if (error) { if (error.code === '23505') return res.status(409).json({ error: 'Faculty name already exists.', code: 'DUPLICATE' }); return res.status(500).json({ error: error.message, code: 'DB_ERROR' }); }
  return res.status(201).json({ success: true, data: { ...data, departments: [] } });
});

router.put('/faculties/:id', ...adminOnly, async (req, res) => {
  const { name_en, name_am, color, image_url, description, sort_order } = req.body || {};
  const patch = {};
  if (name_en     !== undefined) { patch.name_en = name_en; patch.slug = await uniqueSlug('faculties', slugify(name_en), req.params.id); }
  if (name_am     !== undefined) patch.name_am     = name_am;
  if (color       !== undefined) patch.color       = color;
  if (image_url   !== undefined) patch.image_url   = image_url || null;
  if (description !== undefined) patch.description = description || null;
  if (sort_order  !== undefined) patch.sort_order  = Number(sort_order);
  const { data, error } = await adminClient.from('faculties').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, data });
});

router.delete('/faculties/:id', ...adminOnly, async (req, res) => {
  const { error } = await adminClient.from('faculties').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, data: { id: req.params.id } });
});

router.get('/faculties/:id/departments', ...adminOnly, async (req, res) => {
  const { data, error } = await adminClient.from('departments').select('*').eq('faculty_id', req.params.id).order('sort_order', { ascending: true });
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, data: data || [] });
});

router.post('/faculties/:id/departments', ...adminOnly, async (req, res) => {
  const { name_en, name_am, description, duration_years, sort_order } = req.body || {};
  if (!name_en?.trim()) return res.status(400).json({ error: 'name_en is required.', code: 'VALIDATION_ERROR' });
  const { data: fac } = await adminClient.from('faculties').select('slug').eq('id', req.params.id).maybeSingle();
  if (!fac) return res.status(404).json({ error: 'Faculty not found.', code: 'NOT_FOUND' });
  const slug = await uniqueSlug('departments', `${fac.slug}/${slugify(name_en)}`);
  const { data, error } = await adminClient.from('departments')
    .insert({ faculty_id: req.params.id, name_en: name_en.trim(), name_am: name_am || null, slug, description: description || null, duration_years: Number(duration_years) || 4, sort_order: Number(sort_order) || 0 })
    .select().single();
  if (error) { if (error.code === '23505') return res.status(409).json({ error: 'Department slug already exists.', code: 'DUPLICATE' }); return res.status(500).json({ error: error.message, code: 'DB_ERROR' }); }
  return res.status(201).json({ success: true, data });
});

router.put('/departments/:id', ...adminOnly, async (req, res) => {
  const { name_en, name_am, description, duration_years, graduates_count, sort_order, faculty_id, is_active } = req.body || {};
  const patch = {};
  if (name_en         !== undefined) { patch.name_en = name_en; patch.slug = await uniqueSlug('departments', slugify(name_en), req.params.id); }
  if (name_am         !== undefined) patch.name_am         = name_am;
  if (description     !== undefined) patch.description     = description;
  if (duration_years  !== undefined) patch.duration_years  = Number(duration_years);
  if (graduates_count !== undefined) patch.graduates_count = Number(graduates_count);
  if (sort_order      !== undefined) patch.sort_order      = Number(sort_order);
  if (faculty_id      !== undefined) patch.faculty_id      = faculty_id;
  if (is_active       !== undefined) patch.is_active       = Boolean(is_active);
  const { data, error } = await adminClient.from('departments').update(patch).eq('id', req.params.id).select().single();
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, data });
});

router.delete('/departments/:id', ...adminOnly, async (req, res) => {
  const hard = req.query.hard === 'true';
  const { error } = hard
    ? await adminClient.from('departments').delete().eq('id', req.params.id)
    : await adminClient.from('departments').update({ is_active: false }).eq('id', req.params.id);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ success: true, data: { id: req.params.id } });
});

// ════════════════════════════════════════════════════════════════
// AUDIT
// ════════════════════════════════════════════════════════════════

router.get('/audit', ...adminOnly, async (req, res) => {
  const limit  = Math.min(parseInt(req.query.limit  || '100', 10), 500);
  const offset = Math.max(parseInt(req.query.offset || '0',   10), 0);
  const { data, error, count } = await adminClient
    .from('audit_logs').select('*', { count: 'exact' })
    .order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (error) return res.status(500).json({ error: error.message, code: 'DB_ERROR' });
  return res.json({ data: data || [], total: count, limit, offset });
});

module.exports = router;
