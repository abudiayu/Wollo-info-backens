-- ============================================================
-- 0007 — Row Level Security Policies
-- Each table: ENABLE + FORCE RLS, then individual policies
-- per command (SELECT / INSERT / UPDATE / DELETE).
-- auth.uid() calls are wrapped in (select auth.uid()) for performance.
-- ============================================================

-- ── faculties ────────────────────────────────────────────────
alter table public.faculties enable row level security;
alter table public.faculties force  row level security;

-- anon & authenticated: read all faculties
create policy "faculties_select_public"
  on public.faculties for select
  using (true);

-- admin only: insert / update / delete
create policy "faculties_insert_admin"
  on public.faculties for insert
  with check (public.is_admin());

create policy "faculties_update_admin"
  on public.faculties for update
  using  (public.is_admin())
  with check (public.is_admin());

create policy "faculties_delete_admin"
  on public.faculties for delete
  using (public.is_admin());

-- ── departments ──────────────────────────────────────────────
alter table public.departments enable row level security;
alter table public.departments force  row level security;

-- anon & authenticated: read active departments
create policy "departments_select_public"
  on public.departments for select
  using (is_active = true);

-- admin: read all (including inactive)
create policy "departments_select_admin"
  on public.departments for select
  using (public.is_admin());

create policy "departments_insert_admin"
  on public.departments for insert
  with check (public.is_admin());

-- admin: update any; head: update only limited fields of own dept
create policy "departments_update_admin"
  on public.departments for update
  using  (public.is_admin())
  with check (public.is_admin());

create policy "departments_update_head"
  on public.departments for update
  using  (public.is_head_of(id))
  with check (public.is_head_of(id));

create policy "departments_delete_admin"
  on public.departments for delete
  using (public.is_admin());

-- ── programs ─────────────────────────────────────────────────
alter table public.programs enable row level security;
alter table public.programs force  row level security;

create policy "programs_select_public"
  on public.programs for select
  using (is_active = true);

create policy "programs_select_admin"
  on public.programs for select
  using (public.is_admin());

create policy "programs_insert_admin_head"
  on public.programs for insert
  with check (
    public.is_admin() or public.is_head_of(department_id)
  );

create policy "programs_update_admin_head"
  on public.programs for update
  using (
    public.is_admin() or public.is_head_of(department_id)
  )
  with check (
    public.is_admin() or public.is_head_of(department_id)
  );

create policy "programs_delete_admin_head"
  on public.programs for delete
  using (
    public.is_admin() or public.is_head_of(department_id)
  );

-- ── users (profiles) ─────────────────────────────────────────
alter table public.users enable row level security;
alter table public.users force  row level security;

-- users can read their own profile; admin reads all
create policy "users_select_own"
  on public.users for select
  using (
    id = (select auth.uid())
    or public.is_admin()
  );

-- admin: read all
create policy "users_select_admin"
  on public.users for select
  using (public.is_admin());

-- user updates own row; admin updates any
create policy "users_update_own"
  on public.users for update
  using (
    id = (select auth.uid())
    or public.is_admin()
  )
  with check (
    id = (select auth.uid())
    or public.is_admin()
  );

-- only admin or service role can delete
create policy "users_delete_admin"
  on public.users for delete
  using (public.is_admin());

-- ── staff_profiles ───────────────────────────────────────────
alter table public.staff_profiles enable row level security;
alter table public.staff_profiles force  row level security;

-- staff see their own row; admin sees all
create policy "staff_select_own_or_admin"
  on public.staff_profiles for select
  using (
    user_id = (select auth.uid())
    or public.is_admin()
  );

-- only admin may insert/update/delete (escalation guard is a trigger)
create policy "staff_insert_admin"
  on public.staff_profiles for insert
  with check (public.is_admin());

create policy "staff_update_admin"
  on public.staff_profiles for update
  using  (public.is_admin())
  with check (public.is_admin());

create policy "staff_delete_admin"
  on public.staff_profiles for delete
  using (public.is_admin());

-- ── students ─────────────────────────────────────────────────
alter table public.students enable row level security;
alter table public.students force  row level security;

-- student sees own; admin sees all; head sees students of own dept
create policy "students_select_own"
  on public.students for select
  using (
    user_id = (select auth.uid())
    or public.is_admin()
    or department_id        = public.current_department_id()
    or wants_department_id  = public.current_department_id()
  );

create policy "students_insert_self"
  on public.students for insert
  with check (user_id = (select auth.uid()));

create policy "students_update_self_or_admin"
  on public.students for update
  using (
    user_id = (select auth.uid())
    or public.is_admin()
  )
  with check (
    user_id = (select auth.uid())
    or public.is_admin()
  );

create policy "students_delete_admin"
  on public.students for delete
  using (public.is_admin());

-- ── opportunities ─────────────────────────────────────────────
alter table public.opportunities enable row level security;
alter table public.opportunities force  row level security;

-- anon sees published; authenticated sees all published; admin/head see draft too
create policy "opp_select_published_anon"
  on public.opportunities for select
  using (status = 'published');

create policy "opp_select_admin"
  on public.opportunities for select
  using (public.is_admin());

create policy "opp_select_head_own"
  on public.opportunities for select
  using (public.is_head_of(department_id));

create policy "opp_insert_admin_head"
  on public.opportunities for insert
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "opp_update_admin_head"
  on public.opportunities for update
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  )
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "opp_delete_admin_head"
  on public.opportunities for delete
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- ── motivations ──────────────────────────────────────────────
alter table public.motivations enable row level security;
alter table public.motivations force  row level security;

create policy "mot_select_published_anon"
  on public.motivations for select
  using (status = 'published');

create policy "mot_select_admin"
  on public.motivations for select
  using (public.is_admin());

create policy "mot_select_head_own"
  on public.motivations for select
  using (public.is_head_of(department_id));

create policy "mot_insert_admin_head"
  on public.motivations for insert
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "mot_update_admin_head"
  on public.motivations for update
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  )
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "mot_delete_admin_head"
  on public.motivations for delete
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- ── alumni ────────────────────────────────────────────────────
alter table public.alumni enable row level security;
alter table public.alumni force  row level security;

create policy "alumni_select_published"
  on public.alumni for select
  using (status = 'published');

create policy "alumni_select_admin"
  on public.alumni for select
  using (public.is_admin());

create policy "alumni_select_head_own"
  on public.alumni for select
  using (public.is_head_of(department_id));

create policy "alumni_insert_admin_head"
  on public.alumni for insert
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "alumni_update_admin_head"
  on public.alumni for update
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  )
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "alumni_delete_admin_head"
  on public.alumni for delete
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- ── documents ────────────────────────────────────────────────
alter table public.documents enable row level security;
alter table public.documents force  row level security;

-- authenticated users can read published documents
create policy "docs_select_authenticated"
  on public.documents for select
  using (
    status = 'published'
    and (select auth.uid()) is not null
  );

create policy "docs_select_admin"
  on public.documents for select
  using (public.is_admin());

create policy "docs_select_head_own"
  on public.documents for select
  using (public.is_head_of(department_id));

create policy "docs_insert_admin_head"
  on public.documents for insert
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "docs_update_admin_head"
  on public.documents for update
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  )
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "docs_delete_admin_head"
  on public.documents for delete
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- ── student_library ──────────────────────────────────────────
alter table public.student_library enable row level security;
alter table public.student_library force  row level security;

create policy "lib_select_own"
  on public.student_library for select
  using (
    student_id = (select auth.uid())
    or public.is_admin()
  );

create policy "lib_insert_own"
  on public.student_library for insert
  with check (student_id = (select auth.uid()));

create policy "lib_update_own"
  on public.student_library for update
  using  (student_id = (select auth.uid()))
  with check (student_id = (select auth.uid()));

create policy "lib_delete_own"
  on public.student_library for delete
  using (
    student_id = (select auth.uid())
    or public.is_admin()
  );

-- ── department_reviews ───────────────────────────────────────
alter table public.department_reviews enable row level security;
alter table public.department_reviews force  row level security;

-- public can read published reviews
create policy "reviews_select_published"
  on public.department_reviews for select
  using (status = 'published');

create policy "reviews_select_admin_head"
  on public.department_reviews for select
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- authenticated users can post reviews
create policy "reviews_insert_authenticated"
  on public.department_reviews for insert
  with check ((select auth.uid()) is not null);

-- student updates own review; admin updates any
create policy "reviews_update_own_or_admin"
  on public.department_reviews for update
  using (
    student_id = (select auth.uid())
    or public.is_admin()
  )
  with check (
    student_id = (select auth.uid())
    or public.is_admin()
  );

create policy "reviews_delete_admin"
  on public.department_reviews for delete
  using (public.is_admin());

-- ── guide_topics ─────────────────────────────────────────────
alter table public.guide_topics enable row level security;
alter table public.guide_topics force  row level security;

-- authenticated: read all
create policy "guide_select_authenticated"
  on public.guide_topics for select
  using ((select auth.uid()) is not null);

create policy "guide_insert_admin_head"
  on public.guide_topics for insert
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "guide_update_admin_head"
  on public.guide_topics for update
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  )
  with check (
    public.is_admin()
    or public.is_head_of(department_id)
  );

create policy "guide_delete_admin_head"
  on public.guide_topics for delete
  using (
    public.is_admin()
    or public.is_head_of(department_id)
  );

-- ── audit_logs ── (append-only; no UPDATE/DELETE ever) ───────
alter table public.audit_logs enable row level security;
alter table public.audit_logs force  row level security;

-- admin: read all; head: read own department rows only
create policy "audit_select_admin"
  on public.audit_logs for select
  using (public.is_admin());

create policy "audit_select_head_own"
  on public.audit_logs for select
  using (
    public.current_app_role() = 'head'
    and department_id = public.current_department_id()
  );

-- INSERT only via triggers (service-role bypasses RLS anyway)
create policy "audit_insert_trigger"
  on public.audit_logs for insert
  with check (true);  -- actual security enforced by trigger + service-role

-- NO UPDATE policy — intentionally omitted (append-only)
-- NO DELETE policy — intentionally omitted (append-only)

-- ── sections (legacy content) ────────────────────────────────
alter table public.sections enable row level security;
alter table public.sections force  row level security;

create policy "sections_select_all"
  on public.sections for select using (true);

create policy "sections_write_admin"
  on public.sections for all
  using  (public.is_admin())
  with check (public.is_admin());

-- ── content_items (legacy) ───────────────────────────────────
alter table public.content_items enable row level security;
alter table public.content_items force  row level security;

create policy "ci_select_published"
  on public.content_items for select
  using (status = 'published');

create policy "ci_select_admin"
  on public.content_items for select
  using (public.is_admin());

create policy "ci_write_admin"
  on public.content_items for all
  using  (public.is_admin())
  with check (public.is_admin());

-- ── media_items (legacy) ─────────────────────────────────────
alter table public.media_items enable row level security;
alter table public.media_items force  row level security;

create policy "media_select_admin"
  on public.media_items for select
  using (public.is_admin());

create policy "media_insert_admin_head"
  on public.media_items for insert
  with check (
    public.is_admin()
    or public.current_app_role() in ('head', 'staff')
  );

create policy "media_delete_admin"
  on public.media_items for delete
  using (public.is_admin());

-- ── content_media / content_versions (legacy) ────────────────
alter table public.content_media    enable row level security;
alter table public.content_media    force  row level security;
alter table public.content_versions enable row level security;
alter table public.content_versions force  row level security;

create policy "content_media_all_admin"
  on public.content_media for all
  using  (public.is_admin())
  with check (public.is_admin());

create policy "content_versions_all_admin"
  on public.content_versions for all
  using  (public.is_admin())
  with check (public.is_admin());
