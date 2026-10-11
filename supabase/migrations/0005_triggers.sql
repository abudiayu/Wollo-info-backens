-- ============================================================
-- 0005 — Triggers
-- ============================================================

-- ── updated_at triggers ──────────────────────────────────────
do $$ begin
  create trigger trg_faculties_updated_at
    before update on public.faculties
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_departments_updated_at
    before update on public.departments
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_programs_updated_at
    before update on public.programs
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_users_updated_at
    before update on public.users
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_staff_profiles_updated_at
    before update on public.staff_profiles
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_students_updated_at
    before update on public.students
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_opportunities_updated_at
    before update on public.opportunities
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_motivations_updated_at
    before update on public.motivations
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_alumni_updated_at
    before update on public.alumni
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_documents_updated_at
    before update on public.documents
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_dept_reviews_updated_at
    before update on public.department_reviews
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_guide_topics_updated_at
    before update on public.guide_topics
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_content_items_updated_at
    before update on public.content_items
    for each row execute function public.touch_updated_at();
exception when duplicate_object then null; end $$;

-- ── handle_new_user trigger ───────────────────────────────────
-- Fires after every INSERT into auth.users
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Audit triggers ────────────────────────────────────────────
do $$ begin
  create trigger trg_audit_departments
    after insert or update or delete on public.departments
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_programs
    after insert or update or delete on public.programs
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_staff_profiles
    after insert or update or delete on public.staff_profiles
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_students
    after insert or update or delete on public.students
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_opportunities
    after insert or update or delete on public.opportunities
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_motivations
    after insert or update or delete on public.motivations
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_alumni
    after insert or update or delete on public.alumni
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_documents
    after insert or update or delete on public.documents
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger trg_audit_guide_topics
    after insert or update or delete on public.guide_topics
    for each row execute function public.write_audit();
exception when duplicate_object then null; end $$;

-- ── Role escalation guard on staff_profiles ───────────────────
do $$ begin
  create trigger trg_prevent_role_escalation
    before update on public.staff_profiles
    for each row execute function public.prevent_role_escalation();
exception when duplicate_object then null; end $$;
