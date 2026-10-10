-- ============================================================
-- 0008 — RPC Functions (callable via supabase.rpc())
-- Most are SECURITY INVOKER so RLS still applies.
-- Functions that need elevated access are SECURITY DEFINER
-- with explicit is_admin() / is_head_of() checks.
-- ============================================================

-- ── Slugify helper ────────────────────────────────────────────
create or replace function public.slugify(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(
    regexp_replace(lower(trim(p_text)), '[^a-z0-9]+', '-', 'g'),
    '^-+|-+$', '', 'g'
  );
$$;

-- ── create_department ─────────────────────────────────────────
create or replace function public.create_department(
  p_faculty_id      uuid,
  p_name_en         text,
  p_name_am         text    default null,
  p_slug            text    default null,
  p_description     text    default null,
  p_duration_years  int     default 4
)
returns public.departments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_slug text;
  v_row  public.departments;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;
  if p_name_en is null or trim(p_name_en) = '' then
    raise exception 'name_en is required.' using errcode = 'P0002';
  end if;

  v_slug := coalesce(p_slug, public.slugify(p_name_en));

  insert into public.departments
    (faculty_id, name_en, name_am, slug, description, duration_years, created_by)
  values
    (p_faculty_id, trim(p_name_en), p_name_am, v_slug, p_description, p_duration_years, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ── update_department ─────────────────────────────────────────
create or replace function public.update_department(
  p_id    uuid,
  p_patch jsonb
)
returns public.departments
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row    public.departments;
  v_is_head boolean;
  v_allowed_head_fields text[] := array[
    'description','graduates_count','duration_years','course_list','prerequisites'
  ];
  v_field text;
begin
  select public.is_head_of(p_id) into v_is_head;

  if not (public.is_admin() or v_is_head) then
    raise exception 'Access denied.' using errcode = 'P0001';
  end if;

  -- Head can only update limited fields
  if v_is_head and not public.is_admin() then
    for v_field in select jsonb_object_keys(p_patch) loop
      if not (v_field = any(v_allowed_head_fields)) then
        raise exception 'Heads may not update field: %', v_field using errcode = 'P0001';
      end if;
    end loop;
  end if;

  update public.departments set
    name_en         = coalesce((p_patch->>'name_en'),        name_en),
    name_am         = coalesce((p_patch->>'name_am'),        name_am),
    slug            = coalesce((p_patch->>'slug'),           slug),
    description     = coalesce((p_patch->>'description'),   description),
    duration_years  = coalesce((p_patch->>'duration_years')::int, duration_years),
    graduates_count = coalesce((p_patch->>'graduates_count')::int, graduates_count),
    prerequisites   = coalesce((p_patch->'prerequisites'),  prerequisites),
    course_list     = coalesce((p_patch->'course_list'),    course_list),
    is_active       = coalesce((p_patch->>'is_active')::boolean, is_active),
    updated_at      = now()
  where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'Department not found.' using errcode = 'P0404';
  end if;
  return v_row;
end;
$$;

-- ── delete_department (soft by default) ──────────────────────
create or replace function public.delete_department(
  p_id      uuid,
  p_hard    boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;

  if p_hard then
    delete from public.departments where id = p_id;
  else
    update public.departments set is_active = false, updated_at = now() where id = p_id;
  end if;

  return found;
end;
$$;

-- ── assign_staff ─────────────────────────────────────────────
-- Admin-only. Creates / updates a staff_profiles row.
-- Uses SECURITY DEFINER to bypass RLS when inserting staff_profiles.
create or replace function public.assign_staff(
  p_user_id       uuid,
  p_role          public.app_role,
  p_department_id uuid    default null
)
returns public.staff_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_profiles;
begin
  -- Explicit admin check even though SECURITY DEFINER
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;

  insert into public.staff_profiles (user_id, role, department_id)
  values (p_user_id, p_role, p_department_id)
  on conflict (user_id) do update
    set role          = excluded.role,
        department_id = excluded.department_id,
        updated_at    = now()
  returning * into v_row;

  -- Write audit manually (trigger covers this, but let's be explicit for role_change)
  insert into public.audit_logs (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'role_change', 'staff_profiles', p_user_id::text, to_jsonb(v_row));

  return v_row;
end;
$$;

-- ── set_student_department ────────────────────────────────────
create or replace function public.set_student_department(
  p_department_id uuid
)
returns public.students
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.students;
begin
  update public.students
  set department_id = p_department_id, updated_at = now()
  where user_id = (select auth.uid())
  returning * into v_row;

  if not found then
    raise exception 'Student profile not found.' using errcode = 'P0404';
  end if;
  return v_row;
end;
$$;

-- ── add_to_library ────────────────────────────────────────────
create or replace function public.add_to_library(p_document_id uuid)
returns public.student_library
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.student_library;
begin
  insert into public.student_library (student_id, document_id)
  values ((select auth.uid()), p_document_id)
  on conflict (student_id, document_id) do nothing
  returning * into v_row;
  return v_row;
end;
$$;

-- ── remove_from_library ───────────────────────────────────────
create or replace function public.remove_from_library(p_document_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.student_library
  where student_id  = (select auth.uid())
    and document_id = p_document_id;
  return found;
end;
$$;

-- ── admin_update_user ─────────────────────────────────────────
create or replace function public.admin_update_user(
  p_user_id   uuid,
  p_full_name text  default null,
  p_username  text  default null
)
returns public.users
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.users;
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;

  update public.users set
    full_name  = coalesce(p_full_name, full_name),
    username   = coalesce(p_username,  username),
    updated_at = now()
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'User not found.' using errcode = 'P0404';
  end if;
  return v_row;
end;
$$;

-- ── create_opportunity ───────────────────────────────────────
create or replace function public.create_opportunity(
  p_title         text,
  p_details       text       default null,
  p_link          text       default null,
  p_deadline      date       default null,
  p_department_id uuid       default null,
  p_status        public.content_status default 'draft'
)
returns public.opportunities
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.opportunities;
begin
  if not (public.is_admin() or public.is_head_of(p_department_id)) then
    raise exception 'Access denied.' using errcode = 'P0001';
  end if;

  insert into public.opportunities (department_id, title, details, link, deadline, status, created_by)
  values (p_department_id, p_title, p_details, p_link, p_deadline, p_status, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ── create_motivation ────────────────────────────────────────
create or replace function public.create_motivation(
  p_title         text,
  p_details       text       default null,
  p_media_url     text       default null,
  p_department_id uuid       default null,
  p_status        public.content_status default 'draft'
)
returns public.motivations
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.motivations;
begin
  if not (public.is_admin() or public.is_head_of(p_department_id)) then
    raise exception 'Access denied.' using errcode = 'P0001';
  end if;

  insert into public.motivations (department_id, title, details, media_url, status, created_by)
  values (p_department_id, p_title, p_details, p_media_url, p_status, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

-- ── create_document ──────────────────────────────────────────
create or replace function public.create_document(
  p_title           text,
  p_file_path       text,
  p_description     text           default null,
  p_language        public.doc_language default 'en',
  p_category        text           default null,
  p_department_id   uuid           default null,
  p_is_guide_source boolean        default false,
  p_status          public.content_status default 'draft'
)
returns public.documents
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.documents;
begin
  if not (public.is_admin() or public.is_head_of(p_department_id)) then
    raise exception 'Access denied.' using errcode = 'P0001';
  end if;

  insert into public.documents
    (department_id, title, description, file_path, language, category, is_guide_source, status, uploaded_by)
  values
    (p_department_id, p_title, p_description, p_file_path, p_language, p_category, p_is_guide_source, p_status, auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;
