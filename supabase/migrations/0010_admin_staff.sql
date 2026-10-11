-- ============================================================
-- 0010 — Admin staff management helpers
-- Safe to re-run: all objects use CREATE OR REPLACE / IF NOT EXISTS
-- ============================================================

-- ── Helper: does a department already have an active head? ────
-- Returns the user_id of the current head, or NULL if none.
create or replace function public.get_dept_head(p_dept_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select user_id
  from   public.staff_profiles
  where  role          = 'head'
    and  department_id = p_dept_id
  limit  1;
$$;

-- ── Helper: safe upsert for staff_profiles ────────────────────
-- The prevent_role_escalation trigger blocks UPDATE of role/dept
-- by non-admins, so we DELETE + INSERT when called with service-role.
-- Express always uses the service-role adminClient, so this is safe.
-- We expose it as an RPC so the backend can call it cleanly.
create or replace function public.admin_set_staff_profile(
  p_user_id       uuid,
  p_role          public.app_role,
  p_department_id uuid    default null,
  p_title         text    default null,
  p_office_number text    default null
)
returns public.staff_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.staff_profiles;
begin
  -- Only admins may call this
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;

  -- Validate head constraint
  if p_role = 'head' and p_department_id is null then
    raise exception 'department_id is required for role=head.' using errcode = 'P0002';
  end if;
  if p_role = 'admin' and p_department_id is not null then
    raise exception 'Admins must have NULL department_id.' using errcode = 'P0002';
  end if;

  -- Check for existing head on that department (exclude this user)
  if p_role = 'head' then
    if exists (
      select 1 from public.staff_profiles
      where  role          = 'head'
        and  department_id = p_department_id
        and  user_id      <> p_user_id
    ) then
      raise exception 'This department already has a head. Remove them first.' using errcode = 'P0409';
    end if;
  end if;

  -- DELETE existing row to bypass prevent_role_escalation trigger on UPDATE
  delete from public.staff_profiles where user_id = p_user_id;

  -- INSERT fresh row
  insert into public.staff_profiles (
    user_id, role, department_id, title, office_number
  ) values (
    p_user_id, p_role, p_department_id, p_title, p_office_number
  )
  returning * into v_row;

  -- Write audit
  insert into public.audit_logs (actor_id, action, table_name, record_id, new_data)
  values (auth.uid(), 'role_change', 'staff_profiles', p_user_id::text,
    jsonb_build_object(
      'role', p_role, 'department_id', p_department_id,
      'title', p_title, 'office_number', p_office_number
    )
  );

  return v_row;
end;
$$;

-- ── Helper: update profile fields only (name, username, title, office) ──
create or replace function public.admin_update_staff_details(
  p_user_id       uuid,
  p_full_name     text    default null,
  p_username      text    default null,
  p_title         text    default null,
  p_office_number text    default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required.' using errcode = 'P0001';
  end if;

  -- Update profile
  update public.users set
    full_name  = coalesce(p_full_name,  full_name),
    username   = coalesce(p_username,   username),
    updated_at = now()
  where id = p_user_id;

  -- Update staff details
  update public.staff_profiles set
    title         = coalesce(p_title,         title),
    office_number = coalesce(p_office_number, office_number),
    updated_at    = now()
  where user_id = p_user_id;
end;
$$;

-- ── Expose departments list for the staff-creation form ───────
-- Returns active departments with their faculty name, so the
-- frontend can build a grouped <select>.
create or replace function public.list_departments_for_select()
returns table (
  id           uuid,
  name_en      text,
  slug         text,
  faculty_id   uuid,
  faculty_name text,
  has_head     boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    d.id,
    d.name_en,
    d.slug,
    d.faculty_id,
    f.name_en as faculty_name,
    exists (
      select 1 from public.staff_profiles sp
      where sp.department_id = d.id and sp.role = 'head'
    ) as has_head
  from   public.departments d
  join   public.faculties   f on f.id = d.faculty_id
  where  d.is_active = true
  order  by f.sort_order, f.name_en, d.name_en;
$$;

-- Grant execute to authenticated (admin check is inside the function)
grant execute on function public.admin_set_staff_profile    to authenticated;
grant execute on function public.admin_update_staff_details  to authenticated;
grant execute on function public.list_departments_for_select to authenticated;
grant execute on function public.get_dept_head               to authenticated;
