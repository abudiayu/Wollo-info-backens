-- ============================================================
-- 0001 — Extensions & Enums
-- Run first. Safe to re-run (CREATE IF NOT EXISTS / DO blocks).
-- ============================================================

-- Enable uuid generation
create extension if not exists "pgcrypto";

-- ── Enums ────────────────────────────────────────────────────

do $$ begin
  create type public.app_role as enum ('admin', 'head', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_action as enum (
    'insert', 'update', 'delete', 'login', 'role_change'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.content_status as enum ('draft', 'published', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.doc_language as enum ('am', 'en');
exception when duplicate_object then null; end $$;
