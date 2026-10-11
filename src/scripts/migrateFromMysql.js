#!/usr/bin/env node
/**
 * src/scripts/migrateFromMysql.js
 *
 * One-time migration: copies data from the old MAMP MySQL database
 * into Supabase Postgres.
 *
 * Tables migrated (in order):
 *   1. faculties        → public.faculties
 *   2. departments      → public.departments
 *   3. sections         → public.sections (INSERT IGNORE on existing slugs)
 *   4. users            → auth.users (via admin.createUser) + public.users
 *   5. content_items    → public.content_items
 *   6. media            → public.media_items  (URLs only, no file re-upload)
 *   7. department_reviews → public.department_reviews
 *
 * Run ONCE after migrations + seed.sql.
 * Set MYSQL_* env vars in .env first.
 *
 * Usage:
 *   node src/scripts/migrateFromMysql.js
 *   node src/scripts/migrateFromMysql.js --dry-run
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const DRY_RUN = process.argv.includes('--dry-run');

// ── Supabase ──────────────────────────────────────────────────
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  MYSQL_HOST     = 'localhost',
  MYSQL_PORT     = '3306',
  MYSQL_USER     = 'root',
  MYSQL_PASSWORD = 'root',
  MYSQL_DATABASE = 'wollo-info-hub',
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── MySQL ─────────────────────────────────────────────────────
let mysql;
try {
  mysql = require('mysql2/promise');
} catch {
  console.error('mysql2 not installed. Run: npm install mysql2 --save-dev');
  process.exit(1);
}

let pool;

// ── Helpers ───────────────────────────────────────────────────
function slugify(str) {
  return String(str).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function log(msg) { console.log(`  ${msg}`); }
function warn(msg) { console.warn(`  ⚠ ${msg}`); }

async function run(label, fn) {
  console.log(`\n── ${label} ──`);
  try {
    await fn();
    console.log(`  ✓ Done`);
  } catch (err) {
    console.error(`  ✗ Failed: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  Wollo Info Hub — MySQL → Supabase   ║');
  console.log(DRY_RUN ? '║            DRY RUN MODE              ║' : '║            LIVE MIGRATION            ║');
  console.log('╚══════════════════════════════════════╝\n');

  pool = await mysql.createPool({
    host:     MYSQL_HOST,
    port:     Number(MYSQL_PORT),
    user:     MYSQL_USER,
    password: MYSQL_PASSWORD,
    database: MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    dateStrings: true,
  });

  console.log(`Connected to MySQL: ${MYSQL_DATABASE}@${MYSQL_HOST}:${MYSQL_PORT}`);

  // ── 1. Faculties ─────────────────────────────────────────────
  await run('Faculties', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT * FROM faculties ORDER BY sort_order ASC, id ASC'); }
    catch { warn('faculties table not found in MySQL — skipping'); return; }

    log(`Found ${rows.length} faculties`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const { error } = await supabase.from('faculties').upsert({
        name_en:     r.name,
        slug:        r.slug || slugify(r.name),
        color:       r.color  || '#2563eb',
        description: r.description || null,
        sort_order:  r.sort_order  || 0,
      }, { onConflict: 'slug' });
      if (error) warn(`Faculty "${r.name}": ${error.message}`);
      else log(`  → ${r.name}`);
    }
  });

  // ── 2. Departments ────────────────────────────────────────────
  await run('Departments', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT d.*, f.slug AS faculty_slug FROM departments d LEFT JOIN faculties f ON f.id = d.faculty_id ORDER BY d.id ASC'); }
    catch { [rows] = await pool.query('SELECT * FROM departments ORDER BY id ASC').catch(() => [[]]); }

    log(`Found ${rows.length} departments`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const slug = r.slug || (r.faculty_slug ? `${r.faculty_slug}/${slugify(r.name)}` : slugify(r.name));

      // Resolve faculty_id in Supabase
      let faculty_id = null;
      if (r.faculty_slug) {
        const { data: fac } = await supabase.from('faculties').select('id').eq('slug', r.faculty_slug).maybeSingle();
        faculty_id = fac?.id || null;
      }

      const { error } = await supabase.from('departments').upsert({
        name_en:        r.name,
        slug,
        faculty_id,
        description:    r.description    || null,
        duration_years: r.duration_years || 4,
        graduates_count: r.graduates_count || 0,
        is_active:      true,
      }, { onConflict: 'slug' });
      if (error) warn(`Dept "${r.name}": ${error.message}`);
      else log(`  → ${r.name}`);
    }
  });

  // ── 3. Sections ───────────────────────────────────────────────
  await run('Sections', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT * FROM sections'); }
    catch { warn('sections table not found — skipping'); return; }

    log(`Found ${rows.length} sections`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const { error } = await supabase.from('sections').upsert({
        slug:        r.slug,
        title:       r.title,
        description: r.description || null,
        sort_order:  r.sort_order  || 0,
      }, { onConflict: 'slug' });
      if (error) warn(`Section "${r.slug}": ${error.message}`);
    }
  });

  // ── 4. Users ──────────────────────────────────────────────────
  // Map old MySQL user IDs to new Supabase UUIDs for FK resolution
  const userIdMap = new Map(); // mysqlId → supabaseUuid

  await run('Users', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT * FROM users ORDER BY id ASC'); }
    catch { warn('users table not found — skipping'); return; }

    log(`Found ${rows.length} users`);
    if (DRY_RUN) return;

    for (const r of rows) {
      // Check if this email already exists in Supabase auth
      const { data: { users: existing } } = await supabase.auth.admin.listUsers({ perPage: 1 });
      const found = existing?.find(u => u.email === r.email);

      let supabaseId;

      if (found) {
        supabaseId = found.id;
        log(`  → ${r.email} (already exists, id=${supabaseId})`);
      } else {
        // Create auth user with a temporary password — user must reset
        const tempPassword = `Migrate_${Math.random().toString(36).slice(2, 10)}!`;
        const { data: created, error: createErr } = await supabase.auth.admin.createUser({
          email:         r.email,
          password:      tempPassword,
          email_confirm: true,
          user_metadata: {
            full_name: r.full_name,
            migrated:  true,
          },
        });
        if (createErr) { warn(`User "${r.email}": ${createErr.message}`); continue; }
        supabaseId = created.user.id;
        log(`  → ${r.email} (created, id=${supabaseId}, temp_pw=${tempPassword})`);
      }

      userIdMap.set(r.id, supabaseId);

      // Ensure public.users row
      await supabase.from('users').upsert({
        id:         supabaseId,
        full_name:  r.full_name,
        email:      r.email,
        avatar_url: r.avatar_url || null,
        is_active:  true,
      }, { onConflict: 'id' });

      // If admin/staff in old DB → create staff_profiles row
      if (r.role === 'admin') {
        await supabase.from('staff_profiles').upsert(
          { user_id: supabaseId, role: 'admin', department_id: null },
          { onConflict: 'user_id' }
        );
      } else if (r.role === 'staff') {
        await supabase.from('staff_profiles').upsert(
          { user_id: supabaseId, role: 'staff' },
          { onConflict: 'user_id' }
        );
      } else {
        // Regular user → student
        await supabase.from('students').upsert(
          { user_id: supabaseId },
          { onConflict: 'user_id' }
        );
      }
    }

    log(`Mapped ${userIdMap.size} users`);
  });

  // ── 5. Content items ─────────────────────────────────────────
  await run('Content Items', async () => {
    let rows = [];
    try { [rows] = await pool.query(`
      SELECT ci.*, s.slug AS section_slug
      FROM content_items ci
      JOIN sections s ON s.id = ci.section_id
      ORDER BY ci.id ASC
    `); }
    catch { warn('content_items not found — skipping'); return; }

    log(`Found ${rows.length} content items`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const { data: sec } = await supabase.from('sections').select('id').eq('slug', r.section_slug).maybeSingle();
      if (!sec) { warn(`Section "${r.section_slug}" not found — skipping content item ${r.id}`); continue; }

      const createdBy = userIdMap.get(r.created_by) || null;

      const { error } = await supabase.from('content_items').insert({
        section_id:    sec.id,
        title:         r.title,
        body:          r.body || null,
        status:        r.status || 'draft',
        sort_order:    r.sort_order || 0,
        created_by:    createdBy,
        published_at:  r.published_at || null,
        created_at:    r.created_at,
        updated_at:    r.updated_at,
      });
      if (error) warn(`Content "${r.title}": ${error.message}`);
    }
  });

  // ── 6. Media ──────────────────────────────────────────────────
  await run('Media Records', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT * FROM media ORDER BY id ASC'); }
    catch { warn('media table not found — skipping'); return; }

    log(`Found ${rows.length} media records (URLs only, no file re-upload)`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const uploadedBy = userIdMap.get(r.uploaded_by) || null;
      const { error } = await supabase.from('media_items').insert({
        original_name: r.original_name,
        stored_name:   r.stored_name,
        mime_type:     r.mime_type || 'application/octet-stream',
        size:          r.size || 0,
        type:          r.type || 'file',
        url:           r.url,
        uploaded_by:   uploadedBy,
        created_at:    r.created_at,
      });
      if (error) warn(`Media "${r.original_name}": ${error.message}`);
    }
  });

  // ── 7. Department reviews ─────────────────────────────────────
  await run('Department Reviews', async () => {
    let rows = [];
    try { [rows] = await pool.query('SELECT * FROM department_reviews ORDER BY id ASC'); }
    catch { warn('department_reviews not found — skipping'); return; }

    log(`Found ${rows.length} reviews`);
    if (DRY_RUN) return;

    for (const r of rows) {
      const isUuid = /^[0-9a-f-]{36}$/i.test(r.department_id);
      const { error } = await supabase.from('department_reviews').insert({
        department_id:   isUuid ? r.department_id : null,
        department_slug: isUuid ? null : r.department_id,
        reviewer_name:   r.name    || 'Anonymous',
        role:            r.role    || 'Student',
        rating:          r.rating,
        comment:         r.comment,
        status:          'published',
        created_at:      r.created_at,
      });
      if (error) warn(`Review ${r.id}: ${error.message}`);
    }
  });

  await pool.end();
  console.log('\n✓ Migration complete.\n');

  if (DRY_RUN) {
    console.log('This was a DRY RUN — no data was written to Supabase.\n');
  } else {
    console.log('Next steps:');
    console.log('  1. Verify data in Supabase Table Editor.');
    console.log('  2. Run: node src/scripts/makeAdmin.js <your-admin-email>');
    console.log('  3. Check that migrated users can reset their passwords.\n');
  }
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
