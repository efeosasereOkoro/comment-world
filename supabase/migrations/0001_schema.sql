-- commentbox Phase 3 — multi-tenant schema
-- Run this first in the Supabase SQL editor (or via `supabase db push`).
--
-- Model: one platform, many customers ("owners"). Each owner registers one or more
-- `sites` (a website they want commenting on). Every comment belongs to exactly one
-- site, so tenants are isolated by `site_id`. A small `platform_admins` allowlist gets
-- global read-only oversight (Phase 4 /admin view).

create extension if not exists pgcrypto; -- provides gen_random_uuid()

-- ---------------------------------------------------------------------------
-- profiles: one row per authenticated owner, mirroring auth.users.
-- Populated automatically by the on_auth_user_created trigger (migration 0003).
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sites: a website registered by an owner. `id` is the public siteId carried in
-- the host's <script> tag (not secret — access is governed by RLS + Origin check).
-- `allowed_origins` is the allowlist the post-comment Edge Function enforces on
-- writes; use '*' during testing to accept any origin.
-- ---------------------------------------------------------------------------
create table if not exists public.sites (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references auth.users (id) on delete cascade,
  name            text not null,
  allowed_origins text[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists sites_owner_id_idx on public.sites (owner_id);

-- ---------------------------------------------------------------------------
-- platform_admins: super-admin allowlist for global oversight. Rows are managed
-- manually (service role only — there is no API write policy, see migration 0002).
-- ---------------------------------------------------------------------------
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- comments: now scoped to a site. Column names match the widget's CommentRow
-- (page / selector / quote / author / content / created_at) plus site_id.
-- ---------------------------------------------------------------------------
create table if not exists public.comments (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id) on delete cascade,
  page       text not null,
  selector   text,
  quote      text,
  author     text,
  content    text,
  created_at timestamptz not null default now()
);
create index if not exists comments_site_page_idx on public.comments (site_id, page);
