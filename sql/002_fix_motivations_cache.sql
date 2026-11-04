-- ============================================================
-- 002_fix_motivations_cache.sql
--
-- Fixes "Table motivations not found" when the table physically
-- exists but PostgREST's schema cache is stale (PGRST205).
--
-- WHERE TO RUN:
--   Supabase Dashboard → your project (akxrrdmiclnixgommfhh)
--   → left sidebar "SQL Editor" → "New query"
--   → paste this whole file → click "Run"
--
-- SAFE TO RE-RUN: every statement is idempotent.
-- ============================================================

-- ── 1. Verify the table exists ────────────────────────────────
-- You should see rows here. If not, run 001_motivations.sql first.
select
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'motivations'
order by ordinal_position;

-- ── 2. Ensure the content_status enum exists ──────────────────
do $$ begin
  create type public.content_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

-- ── 3. Ensure the motivations table exists with ALL columns ───
create table if not exists public.motivations (
  id            uuid                  primary key default gen_random_uuid(),
  department_id uuid                  references public.departments(id) on delete cascade,
  title         text                  not null,
  details       text,
  media_url     text,
  status        public.content_status not null default 'draft',
  created_by    uuid                  references auth.users(id) on delete set null,
  created_at    timestamptz           not null default now(),
  updated_at    timestamptz           not null default now()
);

-- Add any columns that might be missing from an older creation
alter table public.motivations
  add column if not exists details       text,
  add column if not exists media_url     text,
  add column if not exists department_id uuid references public.departments(id) on delete cascade,
  add column if not exists created_by    uuid references auth.users(id) on delete set null,
  add column if not exists updated_at    timestamptz not null default now();

-- ── 4. Ensure indexes exist ───────────────────────────────────
create index if not exists idx_motivations_status
  on public.motivations (status);

create index if not exists idx_motivations_dept
  on public.motivations (department_id);

create index if not exists idx_motivations_created
  on public.motivations (created_at desc);

-- ── 5. updated_at trigger ─────────────────────────────────────
create or replace function public._mot_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_motivations_updated_at on public.motivations;
create trigger trg_motivations_updated_at
  before update on public.motivations
  for each row execute function public._mot_touch_updated_at();

-- ── 6. RLS ────────────────────────────────────────────────────
alter table public.motivations enable row level security;
alter table public.motivations force  row level security;

-- Drop all existing motivation policies so this is fully idempotent
drop policy if exists "mot_select_published_anon" on public.motivations;
drop policy if exists "mot_select_admin"           on public.motivations;
drop policy if exists "mot_select_head_own"        on public.motivations;
drop policy if exists "mot_insert_admin_head"      on public.motivations;
drop policy if exists "mot_update_admin_head"      on public.motivations;
drop policy if exists "mot_delete_admin_head"      on public.motivations;
drop policy if exists "motivations_anon_published" on public.motivations;
drop policy if exists "motivations_admin_all"      on public.motivations;
drop policy if exists "motivations_head_own_dept"  on public.motivations;

-- Public/anon: read only published
create policy "mot_select_published_anon"
  on public.motivations for select
  using (status = 'published');

-- Authenticated admin: full access
create policy "mot_select_admin"
  on public.motivations for select to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role = 'admin'
    )
  );

create policy "mot_insert_admin_head"
  on public.motivations for insert to authenticated
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid() and sp.role in ('admin', 'head')
    )
  );

create policy "mot_update_admin_head"
  on public.motivations for update to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (sp.role = 'admin'
             or (sp.role = 'head' and sp.department_id = motivations.department_id))
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (sp.role = 'admin'
             or (sp.role = 'head' and sp.department_id = motivations.department_id))
    )
  );

create policy "mot_delete_admin_head"
  on public.motivations for delete to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and (sp.role = 'admin'
             or (sp.role = 'head' and sp.department_id = motivations.department_id))
    )
  );

create policy "mot_select_head_own"
  on public.motivations for select to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = motivations.department_id
    )
  );

-- ── 7. Explicit grants to PostgREST roles ─────────────────────
-- These ensure PostgREST can query the table regardless of RLS.
grant usage  on schema public                      to anon, authenticated;
grant select on table  public.motivations          to anon;
grant select, insert, update, delete
              on table  public.motivations          to authenticated;

-- ── 8. THE CRITICAL FIX — reload PostgREST schema cache ───────
-- Without this, PostgREST returns PGRST205 "Table not found in
-- schema cache" even though the table physically exists.
-- This notify call signals the PostgREST worker to refresh.
notify pgrst, 'reload schema';

-- ── 9. Confirm policies were created ─────────────────────────
select tablename, policyname, cmd, roles
from pg_policies
where tablename = 'motivations'
order by policyname;
