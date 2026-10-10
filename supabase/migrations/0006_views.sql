-- ============================================================
-- 0006 — Views
-- ============================================================

-- ── v_admin_users ─────────────────────────────────────────────
-- One clean, de-duplicated row per user for the Admin page.
-- security_invoker = true so the caller's RLS context is applied.
drop view if exists public.v_admin_users;
create view public.v_admin_users
with (security_invoker = true)
as
select
  u.id,
  u.full_name,
  u.username,
  u.email,
  u.avatar_url,
  u.phone,
  u.is_active,
  u.created_at,
  -- role: admin > head > staff > student
  coalesce(sp.role::text, 'student') as role,
  sp.department_id,
  d.name_en   as department_name,
  sp.title,
  sp.office_number,
  st.student_number,
  st.year_of_study,
  st.department_id as student_department_id
from
  public.users u
  left join public.staff_profiles sp on sp.user_id       = u.id
  left join public.departments     d  on d.id             = sp.department_id
  left join public.students        st on st.user_id       = u.id
order by
  u.created_at desc;

-- ── department_students ──────────────────────────────────────
-- Students enrolled in OR interested in a department.
-- security_invoker = true — head sees only their department's students via RLS.
drop view if exists public.department_students;
create view public.department_students
with (security_invoker = true)
as
select
  coalesce(st.department_id, st.wants_department_id) as department_id,
  d.name_en    as department_name,
  u.id         as user_id,
  u.full_name,
  u.email,
  st.student_number,
  st.year_of_study,
  case
    when st.department_id is not null then 'enrolled'
    else 'interested'
  end          as membership_type
from
  public.students  st
  join  public.users       u  on u.id  = st.user_id
  join  public.departments d  on d.id  = coalesce(st.department_id, st.wants_department_id)
where
  st.department_id is not null
  or st.wants_department_id is not null;
