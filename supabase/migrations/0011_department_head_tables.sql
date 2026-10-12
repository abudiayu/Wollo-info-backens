-- ============================================================
-- 0011 — Department Head feature tables
--
-- Required by /api/department-head/* endpoints.
-- Run this migration in the Supabase SQL editor or via the CLI.
-- ============================================================

-- ── department_courses ───────────────────────────────────────
create table if not exists public.department_courses (
  id             uuid        primary key default gen_random_uuid(),
  department_id  uuid        not null references public.departments(id) on delete cascade,
  course_name    text        not null,
  prerequisites  text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_dept_courses_dept
  on public.department_courses (department_id);

-- ── department_content ───────────────────────────────────────
create type if not exists public.dept_content_type as enum
  ('opportunity', 'motivation', 'document');

create table if not exists public.department_content (
  id             uuid                        primary key default gen_random_uuid(),
  department_id  uuid                        not null references public.departments(id) on delete cascade,
  head_id        uuid                        references public.users(id) on delete set null,
  type           text                        not null
                   check (type in ('opportunity','motivation','document')),
  title          text                        not null,
  body           text,
  link_url       text,
  created_at     timestamptz                 not null default now(),
  updated_at     timestamptz                 not null default now()
);

create index if not exists idx_dept_content_dept
  on public.department_content (department_id);

-- ── RLS: department heads can manage their own tables ────────
alter table public.department_courses enable row level security;
alter table public.department_content enable row level security;

-- Admins can do everything
create policy "dept_courses_admin_all"
  on public.department_courses for all
  using  (public.is_admin())
  with check (public.is_admin());

create policy "dept_content_admin_all"
  on public.department_content for all
  using  (public.is_admin())
  with check (public.is_admin());

-- Department heads can manage rows for their own department
-- (relies on staff_profiles.role = 'head' and matching department_id)
create policy "dept_courses_head_all"
  on public.department_courses for all
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = department_courses.department_id
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = department_courses.department_id
    )
  );

create policy "dept_content_head_all"
  on public.department_content for all
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = department_content.department_id
    )
  )
  with check (
    exists (
      select 1 from public.staff_profiles sp
      where sp.user_id = auth.uid()
        and sp.role = 'head'
        and sp.department_id = department_content.department_id
    )
  );

-- Public can read published content (optional — remove if you don't want this)
create policy "dept_content_public_read"
  on public.department_content for select
  using (true);

create policy "dept_courses_public_read"
  on public.department_courses for select
  using (true);
