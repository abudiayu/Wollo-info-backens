-- ============================================================
-- 0004 — Helper Functions (SECURITY DEFINER, set search_path='')
-- ============================================================

-- ── touch_updated_at ─────────────────────────────────────────
-- Generic trigger function: sets updated_at = now() on every UPDATE.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── current_app_role ─────────────────────────────────────────
-- Returns the app_role of the calling user (null if student/anon).
create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select sp.role
  from   public.staff_profiles sp
  where  sp.user_id = (select auth.uid())
  limit  1;
$$;

-- ── is_admin ─────────────────────────────────────────────────
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from   public.staff_profiles sp
    where  sp.user_id = (select auth.uid())
      and  sp.role    = 'admin'
  );
$$;

-- ── is_head_of ───────────────────────────────────────────────
-- Returns true when the calling user is the head of the given department.
create or replace function public.is_head_of(p_dept_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from   public.staff_profiles sp
    where  sp.user_id       = (select auth.uid())
      and  sp.role          = 'head'
      and  sp.department_id = p_dept_id
  );
$$;

-- ── current_department_id ────────────────────────────────────
-- Returns the department_id for the current user (head/staff).
create or replace function public.current_department_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sp.department_id
  from   public.staff_profiles sp
  where  sp.user_id = (select auth.uid())
  limit  1;
$$;

-- ── handle_new_user ──────────────────────────────────────────
-- Trigger on auth.users INSERT: creates a users row and a students row.
-- If metadata contains role='head'/'admin'/'staff', a staff_profiles row
-- is created instead of a students row (only when called by service role).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_full_name text;
  v_username  text;
  v_role      text;
  v_dept_id   uuid;
begin
  v_full_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  v_username := coalesce(
    new.raw_user_meta_data->>'username',
    regexp_replace(lower(split_part(new.email, '@', 1)), '[^a-z0-9_]', '_', 'g')
  );
  v_role    := new.raw_user_meta_data->>'app_role';
  v_dept_id := (new.raw_user_meta_data->>'department_id')::uuid;

  -- Insert into users (profile)
  insert into public.users (id, full_name, username, email, created_at, updated_at)
  values (new.id, v_full_name, v_username, new.email, now(), now())
  on conflict (id) do nothing;

  -- Create role-specific row
  if v_role in ('admin', 'head', 'staff') then
    insert into public.staff_profiles (user_id, role, department_id)
    values (new.id, v_role::public.app_role, v_dept_id)
    on conflict (user_id) do nothing;
  else
    -- default: student
    insert into public.students (user_id, created_at, updated_at)
    values (new.id, now(), now())
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- ── write_audit ──────────────────────────────────────────────
-- Generic audit trigger: records INSERT/UPDATE/DELETE with actor + dept.
create or replace function public.write_audit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id    uuid;
  v_dept_id     uuid;
  v_record_id   text;
  v_action      public.audit_action;
  v_old         jsonb;
  v_new         jsonb;
begin
  v_actor_id := auth.uid();

  if tg_op = 'INSERT' then
    v_action    := 'insert';
    v_new       := to_jsonb(new);
    v_old       := null;
    v_record_id := new.id::text;
  elsif tg_op = 'UPDATE' then
    v_action    := 'update';
    v_new       := to_jsonb(new);
    v_old       := to_jsonb(old);
    v_record_id := new.id::text;
  else
    v_action    := 'delete';
    v_new       := null;
    v_old       := to_jsonb(old);
    v_record_id := old.id::text;
  end if;

  -- Try to resolve department_id from the row itself
  begin
    if tg_op = 'DELETE' then
      v_dept_id := (old.department_id)::uuid;
    else
      v_dept_id := (new.department_id)::uuid;
    end if;
  exception when others then
    v_dept_id := null;
  end;

  insert into public.audit_logs
    (actor_id, action, table_name, record_id, department_id, old_data, new_data)
  values
    (v_actor_id, v_action, tg_table_name, v_record_id, v_dept_id, v_old, v_new);

  return coalesce(new, old);
end;
$$;

-- ── prevent_role_escalation ──────────────────────────────────
-- Blocks non-admins from changing staff_profiles.role or department_id.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only admins may change role or department_id
  if not public.is_admin() then
    if new.role <> old.role then
      raise exception 'Only admins may change a staff role.' using errcode = 'P0003';
    end if;
    if new.department_id is distinct from old.department_id then
      raise exception 'Only admins may reassign department.' using errcode = 'P0003';
    end if;
  end if;
  return new;
end;
$$;
