-- ============================================================
-- 0003 — Indexes
-- ============================================================

-- faculties
create index if not exists idx_faculties_slug       on public.faculties (slug);

-- departments
create index if not exists idx_departments_faculty  on public.departments (faculty_id);
create index if not exists idx_departments_slug     on public.departments (slug);
create index if not exists idx_departments_active   on public.departments (is_active);

-- programs
create index if not exists idx_programs_dept        on public.programs (department_id);
create index if not exists idx_programs_active      on public.programs (is_active);

-- users
create index if not exists idx_users_email          on public.users (email);

-- staff_profiles
create index if not exists idx_staff_role           on public.staff_profiles (role);
create index if not exists idx_staff_dept           on public.staff_profiles (department_id);

-- students
create index if not exists idx_students_dept        on public.students (department_id);
create index if not exists idx_students_wants_dept  on public.students (wants_department_id);

-- opportunities
create index if not exists idx_opp_dept             on public.opportunities (department_id);
create index if not exists idx_opp_status           on public.opportunities (status);
create index if not exists idx_opp_deadline         on public.opportunities (deadline);

-- motivations
create index if not exists idx_mot_dept             on public.motivations (department_id);
create index if not exists idx_mot_status           on public.motivations (status);

-- alumni
create index if not exists idx_alumni_dept          on public.alumni (department_id);
create index if not exists idx_alumni_status        on public.alumni (status);
create index if not exists idx_alumni_year          on public.alumni (graduation_year);

-- documents
create index if not exists idx_docs_dept            on public.documents (department_id);
create index if not exists idx_docs_status          on public.documents (status);
create index if not exists idx_docs_guide           on public.documents (is_guide_source);

-- student_library
create index if not exists idx_lib_student          on public.student_library (student_id);
create index if not exists idx_lib_doc              on public.student_library (document_id);

-- department_reviews
create index if not exists idx_rev_dept             on public.department_reviews (department_id);
create index if not exists idx_rev_slug             on public.department_reviews (department_slug);
create index if not exists idx_rev_created          on public.department_reviews (created_at desc);

-- guide_topics
create index if not exists idx_guide_dept           on public.guide_topics (department_id);

-- audit_logs
create index if not exists idx_audit_actor          on public.audit_logs (actor_id);
create index if not exists idx_audit_table          on public.audit_logs (table_name);
create index if not exists idx_audit_dept           on public.audit_logs (department_id);
create index if not exists idx_audit_created        on public.audit_logs (created_at desc);

-- content_items
create index if not exists idx_ci_section           on public.content_items (section_id);
create index if not exists idx_ci_status            on public.content_items (status);

-- media_items
create index if not exists idx_media_uploader       on public.media_items (uploaded_by);
