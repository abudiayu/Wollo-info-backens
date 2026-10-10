#!/usr/bin/env node
/**
 * src/scripts/makeAdmin.js
 *
 * Promotes an existing Supabase auth user to admin role.
 *
 * Usage:
 *   node src/scripts/makeAdmin.js <email>
 *
 * The user must already be registered via the app.
 * If they already have a staff_profiles row it will be updated.
 */

'use strict';

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();
  if (!email) {
    console.error('Usage: node src/scripts/makeAdmin.js <email>');
    process.exit(1);
  }

  console.log(`\nLooking up user: ${email} …`);

  // Find user in auth.users via admin API
  const { data: { users }, error: listError } = await adminClient.auth.admin.listUsers({
    perPage: 1000,
  });

  if (listError) {
    console.error('Failed to list users:', listError.message);
    process.exit(1);
  }

  const authUser = users.find(u => u.email === email);
  if (!authUser) {
    console.error(`No auth user found with email: ${email}`);
    console.error('The user must register via the app first.');
    process.exit(1);
  }

  console.log(`Found auth user: ${authUser.id}`);

  // Ensure users (profile) row exists
  const { data: profile, error: profileError } = await adminClient
    .from('users')
    .select('id, full_name')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError) {
    console.error('Error checking users table:', profileError.message);
    process.exit(1);
  }

  if (!profile) {
    console.log('users row missing — creating …');
    const { error: insertErr } = await adminClient.from('users').insert({
      id:        authUser.id,
      email:     authUser.email,
      full_name: authUser.user_metadata?.full_name || email.split('@')[0],
    });
    if (insertErr) {
      console.error('Failed to create users row:', insertErr.message);
      process.exit(1);
    }
  } else {
    console.log(`Profile: ${profile.full_name}`);
  }

  // Remove student row if exists (admin is not a student)
  await adminClient.from('students').delete().eq('user_id', authUser.id);

  // Upsert into staff_profiles with role = admin
  const { error: staffError } = await adminClient
    .from('staff_profiles')
    .upsert(
      { user_id: authUser.id, role: 'admin', department_id: null },
      { onConflict: 'user_id' }
    );

  if (staffError) {
    console.error('Failed to set admin role:', staffError.message);
    process.exit(1);
  }

  // Write audit record
  await adminClient.from('audit_logs').insert({
    actor_id:   authUser.id,
    action:     'role_change',
    table_name: 'staff_profiles',
    record_id:  authUser.id,
    new_data:   { role: 'admin', email },
  });

  console.log(`\n✓ ${email} is now an admin.`);
  console.log('  They can log in at /auth and access /admin.\n');
}

main().catch(err => {
  console.error('Unexpected error:', err.message);
  process.exit(1);
});
