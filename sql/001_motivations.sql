-- ============================================================
-- 001_motivations.sql
-- Wollo Info Hub — create the motivations table, indexes,
-- updated_at trigger, RLS and PostgREST schema-cache refresh.
--
-- WHERE TO RUN:
--   Supabase Dashboard
--     → (select your project)
--     → left sidebar: "SQL Editor"
--     → "New query"
--     → paste the whole file
--     → click "Run" (or Ctrl+Enter)
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- ============================================================

-- ── 0. Prerequisite: content_status enum ─────────────────────
-- The motivations.status column uses this enum type.
-- Skip if it already exists.
do $$ begin
  create type public.content_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

-- ── 1. Create the motivations table ──────────────────────────
create table if not exists public.motivations (
  id            uuid                       primary key default gen_random_uuid(),
  department_id uuid                       references public.departments(id) on delete cascade,
  title         text                       not null,
  details       text,
  media_url     text,
  status        public.content_status      not null default 'draft',
  created_by    uuid                       references auth.users(id) on delete set null,
  created_at    timestamptz                not null default now(),
  updated_at    timestamptz                not null default now()
);

-- ── 2. Add any missing columns safely ────────────────────────
-- (no-op if the column already exists)
alter table public.motivations
  add column if not exists media_url    text,
  add column if not exists updated_at  timestamptz not null default now(),
  add column if not exists department_id uuid references public.departments(id) on delete cascade,
  add column if not exists created_by   uuid references auth.users(id) on delete set null;

-- ── 3. Indexes ────────────────────────────────────────────────
create index if not exists idx_motivations_status
  on public.motivations (status);

create index if not exists idx_motivations_dept
  on public.motivations (department_id);

create index if not exists idx_motivations_created
  on public.motivations (created_at desc);

-- ── 4. updated_at trigger ─────────────────────────────────────
-- Reuse the existing touch_updated_at() function if it exists,
-- otherwise create a minimal version here.
create or replace function public._touch_updated_at_motivations()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_motivations_updated_at on public.motivations;
create trigger trg_motivations_updated_at
  before update on public.motivations
  for each row execute function public._touch_updated_at_motivations();

-- ── 5. Row-Level Security ─────────────────────────────────────
alter table public.motivations enable row level security;
alter table public.motivations force  row level security;

-- Drop existing policies first so this file is idempotent
drop policy if exists "mot_select_published_anon" on public.motivations;
drop policy if exists "mot_select_admin"           on public.motivations;
drop policy if exists "mot_select_head_own"        on public.motivations;
drop policy if exists "mot_insert_admin_head"      on public.motivations;
drop policy if exists "mot_update_admin_head"      on public.motivations;
drop policy if exists "mot_delete_admin_head"      on public.motivations;
-- Also drop the names used in the previous session's SQL if any were applied
drop policy if exists "motivations_anon_published" on public.motivations;
drop policy if exists "motivations_admin_all"      on public.motivations;
drop policy if exists "motivations_head_own_dept"  on public.motivations;

-- 5a. Public/anon: read only published rows
--     (The Express backend also uses adminClient which bypasses RLS,
--      but this policy protects direct PostgREST and Dashboard queries.)
create policy "mot_select_published_anon"
  on public.motivations
  for select
  using (status = 'published');

-- 5b. Admin (staff_profiles.role = 'admin'): full access
--     Uses is_admin() helper; falls back gracefully if not defined.
create policy "mot_select_admin"
  on public.motivations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role = 'admin'
    )
  );

create policy "mot_insert_admin_head"
  on public.motivations
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('admin', 'head')
    )
  );

create policy "mot_update_admin_head"
  on public.motivations
  for update
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (
          sp.role = 'admin'
          or (sp.role = 'head' and sp.department_id = motivations.department_id)
        )
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (
          sp.role = 'admin'
          or (sp.role = 'head' and sp.department_id = motivations.department_id)
        )
    )
  );

create policy "mot_delete_admin_head"
  on public.motivations
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (
          sp.role = 'admin'
          or (sp.role = 'head' and sp.department_id = motivations.department_id)
        )
    )
  );

-- Head own-department select
create policy "mot_select_head_own"
  on public.motivations
  for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = motivations.department_id
    )
  );

-- ── 6. Refresh PostgREST schema cache ─────────────────────────
-- This is CRITICAL. Without it, PostgREST will continue to return
-- "Could not find the table in the schema cache" even after the
-- table is created, until the API server restarts on its own.
notify pgrst, 'reload schema';

-- ── 7. Verification query ─────────────────────────────────────
-- After running, you should see the motivations table and its columns.
select
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name   = 'motivations'
order by c.ordinal_position;
