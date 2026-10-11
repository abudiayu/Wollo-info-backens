-- ============================================================
-- 0009 — Storage Buckets & Policies
-- Run in Supabase SQL editor.
-- ============================================================

-- ── Create buckets ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('documents', 'documents', false, 20971520,  -- 20 MB, private
   array['application/pdf','application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'text/plain']),
  ('media',     'media',     true,  10485760,  -- 10 MB, public read
   array['image/jpeg','image/png','image/gif','image/webp',
         'video/mp4','audio/mpeg']),
  ('avatars',   'avatars',   true,  5242880,   -- 5 MB, public read
   array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- ── Storage RLS ──────────────────────────────────────────────
-- NOTE: Supabase storage policies live in storage.objects table.

-- DOCUMENTS bucket (private) ──────────────────────────────────

-- Admin: full access
create policy "documents_admin_all"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'documents'
    and public.is_admin()
  )
  with check (
    bucket_id = 'documents'
    and public.is_admin()
  );

-- Head: upload only under department/<their-dept-id>/
create policy "documents_head_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and public.current_app_role() = 'head'
    and (storage.foldername(name))[1] = 'department'
    and (storage.foldername(name))[2] = public.current_department_id()::text
  );

create policy "documents_head_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (
      public.is_admin()
      or (
        public.current_app_role() = 'head'
        and (storage.foldername(name))[2] = public.current_department_id()::text
      )
    )
  );

-- Authenticated students can download documents
create policy "documents_student_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and (select auth.uid()) is not null
  );

-- MEDIA bucket (public read) ──────────────────────────────────

create policy "media_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'media');

create policy "media_admin_head_write"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media'
    and (
      public.is_admin()
      or public.current_app_role() in ('head', 'staff')
    )
  );

create policy "media_admin_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media'
    and public.is_admin()
  );

-- AVATARS bucket (public read) ────────────────────────────────

create policy "avatars_public_select"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Users upload only their own avatar: path must start with their uid
create policy "avatars_user_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "avatars_admin_all"
  on storage.objects for all
  to authenticated
  using (
    bucket_id = 'avatars'
    and public.is_admin()
  )
  with check (
    bucket_id = 'avatars'
    and public.is_admin()
  );
