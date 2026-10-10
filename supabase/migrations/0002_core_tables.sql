-- ============================================================
-- 0002 — Core Tables
-- ============================================================

-- ── 1. faculties ─────────────────────────────────────────────
create table if not exists public.faculties (
  id          uuid        primary key default gen_random_uuid(),
  name_en     text        not null,
  name_am     text,
  slug        text        not null,
  color       text        not null default '#2563eb',
  image_url   text,
  description text,
  sort_order  int         not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_faculties_name_en unique (name_en),
  constraint uq_faculties_slug    unique (slug)
);

-- ── 2. departments ────────────────────────────────────────────
create table if not exists public.departments (
  id               uuid        primary key default gen_random_uuid(),
  faculty_id       uuid        references public.faculties(id) on delete restrict,
  name_en          text        not null,
  name_am          text,
  slug             text        not null,
  description      text,
  duration_years   int         not null default 4 check (duration_years > 0),
  graduates_count  int         not null default 0 check (graduates_count >= 0),
  prerequisites    jsonb,
  course_list      jsonb,
  is_active        boolean     not null default true,
  created_by       uuid        references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint uq_departments_slug unique (slug)
);

-- ── 3. programs ───────────────────────────────────────────────
create table if not exists public.programs (
  id             uuid           primary key default gen_random_uuid(),
  department_id  uuid           not null references public.departments(id) on delete cascade,
  name           text           not null,
  level          text           not null default 'undergraduate',
  duration_years int            check (duration_years > 0),
  details        text,
  is_active      boolean        not null default true,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now()
);

-- ── 4. users (profiles) ───────────────────────────────────────
-- Mirrors auth.users; auto-populated by trigger handle_new_user.
create table if not exists public.users (
  id          uuid        primary key references auth.users(id) on delete cascade,
  full_name   text        not null default '',
  username    text,
  email       text        not null,
  avatar_url  text,
  phone       text,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint uq_users_username unique (username),
  constraint uq_users_email    unique (email)
);

-- ── 5. staff_profiles ────────────────────────────────────────
create table if not exists public.staff_profiles (
  user_id        uuid           primary key references public.users(id) on delete cascade,
  role           public.app_role not null,
  department_id  uuid           references public.departments(id) on delete restrict,
  title          text,
  office_number  text,
  created_at     timestamptz    not null default now(),
  updated_at     timestamptz    not null default now(),

  -- admin must have NULL department_id; head MUST have a department_id
  constraint chk_staff_dept check (
    (role = 'admin' and department_id is null) or
    (role = 'head'  and department_id is not null) or
    (role = 'staff')   -- staff dept is optional
  )
);

-- Max one active head per department (partial unique index)
create unique index if not exists uq_one_head_per_dept
  on public.staff_profiles (department_id)
  where role = 'head';

-- ── 6. students ───────────────────────────────────────────────
create table if not exists public.students (
  user_id             uuid        primary key references public.users(id) on delete cascade,
  department_id       uuid        references public.departments(id) on delete set null,
  student_number      text,
  year_of_study       int         check (year_of_study > 0),
  wants_department_id uuid        references public.departments(id) on delete set null,
  library_skipped     boolean     not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint uq_students_number unique (student_number)
);

-- ── 7. opportunities ─────────────────────────────────────────
create table if not exists public.opportunities (
  id            uuid               primary key default gen_random_uuid(),
  department_id uuid               references public.departments(id) on delete cascade,
  title         text               not null,
  details       text,
  link          text,
  deadline      date,
  status        public.content_status not null default 'draft',
  created_by    uuid               references public.users(id) on delete set null,
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

-- ── 8. motivations ───────────────────────────────────────────
create table if not exists public.motivations (
  id            uuid               primary key default gen_random_uuid(),
  department_id uuid               references public.departments(id) on delete cascade,
  title         text               not null,
  details       text,
  media_url     text,
  status        public.content_status not null default 'draft',
  created_by    uuid               references public.users(id) on delete set null,
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

-- ── 9. alumni ────────────────────────────────────────────────
create table if not exists public.alumni (
  id               uuid               primary key default gen_random_uuid(),
  department_id    uuid               references public.departments(id) on delete set null,
  full_name        text               not null,
  graduation_year  int                check (graduation_year > 1900),
  current_position text,
  story            text,
  photo_url        text,
  status           public.content_status not null default 'draft',
  created_by       uuid               references public.users(id) on delete set null,
  created_at       timestamptz        not null default now(),
  updated_at       timestamptz        not null default now()
);

-- ── 10. documents ────────────────────────────────────────────
create table if not exists public.documents (
  id              uuid               primary key default gen_random_uuid(),
  department_id   uuid               references public.departments(id) on delete set null,
  title           text               not null,
  description     text,
  file_path       text               not null,  -- Supabase Storage path
  language        public.doc_language not null default 'en',
  category        text,
  is_guide_source boolean            not null default false,
  status          public.content_status not null default 'draft',
  uploaded_by     uuid               references public.users(id) on delete set null,
  created_at      timestamptz        not null default now(),
  updated_at      timestamptz        not null default now()
);

-- ── 11. student_library ──────────────────────────────────────
create table if not exists public.student_library (
  id          uuid        primary key default gen_random_uuid(),
  student_id  uuid        not null references public.students(user_id) on delete cascade,
  document_id uuid        not null references public.documents(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),

  constraint uq_student_document unique (student_id, document_id)
);

-- ── 12. department_reviews ───────────────────────────────────
create table if not exists public.department_reviews (
  id            uuid               primary key default gen_random_uuid(),
  department_id uuid               references public.departments(id) on delete cascade,
  -- keep backward compat: allow text slug for old data, plus typed student FK
  department_slug text,
  student_id    uuid               references public.students(user_id) on delete set null,
  reviewer_name text               not null,
  role          text               not null default 'Student',
  rating        smallint           not null check (rating between 1 and 5),
  comment       text               not null,
  status        public.content_status not null default 'published',
  created_at    timestamptz        not null default now(),
  updated_at    timestamptz        not null default now()
);

-- ── 13. guide_topics ────────────────────────────────────────
create table if not exists public.guide_topics (
  id            uuid        primary key default gen_random_uuid(),
  title_en      text        not null,
  title_am      text,
  problem_key   text        not null,
  steps         jsonb       not null default '[]',
  department_id uuid        references public.departments(id) on delete set null,
  created_by    uuid        references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint uq_guide_problem_key unique (problem_key)
);

-- ── 14. audit_logs ──────────────────────────────────────────
create table if not exists public.audit_logs (
  id            bigint      generated always as identity primary key,
  actor_id      uuid        references public.users(id) on delete set null,
  action        public.audit_action not null,
  table_name    text        not null,
  record_id     text,
  department_id uuid,
  old_data      jsonb,
  new_data      jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);

-- ── Legacy content tables (keep for backward compat) ─────────
-- These mirror the old MySQL schema so old frontend queries still work.

create table if not exists public.sections (
  id          bigint      generated always as identity primary key,
  slug        text        not null,
  title       text        not null,
  description text,
  sort_order  int         not null default 0,

  constraint uq_sections_slug unique (slug)
);

insert into public.sections (slug, title, description, sort_order)
values
  ('motivation',  'Motivation',    'Motivational stories and advice.', 1),
  ('opportunity', 'Opportunities', 'Clubs, programs and activities.',  2),
  ('department',  'Departments',   'Academic departments.',            3)
on conflict (slug) do nothing;

create table if not exists public.content_items (
  id             bigint             generated always as identity primary key,
  section_id     bigint             not null references public.sections(id) on delete restrict,
  title          text               not null,
  body           text,
  status         public.content_status not null default 'draft',
  cover_media_id bigint,
  sort_order     int                not null default 0,
  created_by     uuid               references public.users(id) on delete restrict,
  published_at   timestamptz,
  created_at     timestamptz        not null default now(),
  updated_at     timestamptz        not null default now()
);

create table if not exists public.media_items (
  id            bigint      generated always as identity primary key,
  original_name text        not null,
  stored_name   text        not null,
  mime_type     text        not null,
  size          bigint      not null default 0,
  type          text        not null default 'file',
  storage_path  text,         -- Supabase Storage path
  url           text        not null,
  uploaded_by   uuid        references public.users(id) on delete restrict,
  created_at    timestamptz not null default now()
);

create table if not exists public.content_media (
  content_id  bigint not null references public.content_items(id) on delete cascade,
  media_id    bigint not null references public.media_items(id)    on delete cascade,
  sort_order  int    not null default 0,
  primary key (content_id, media_id)
);

create table if not exists public.content_versions (
  id          bigint      generated always as identity primary key,
  content_id  bigint      not null references public.content_items(id) on delete cascade,
  title       text        not null,
  body        text,
  edited_by   uuid        references public.users(id) on delete restrict,
  created_at  timestamptz not null default now()
);
