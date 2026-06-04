-- commentbox Phase 3 — Row Level Security
-- Run after 0001_schema.sql.
--
-- Two audiences:
--   * Public widget visitors (anon publishable key): READ comments only. They never
--     write directly — inserts go through the origin-checked post-comment Edge
--     Function, which uses the service role and bypasses RLS.
--   * Owners (authenticated): full control over THEIR sites and those sites' comments.
--   * Super-admins (platform_admins): global READ oversight, no write into others'
--     data — the per-owner moderation boundary is preserved.

-- Helper: is the given user a platform super-admin? SECURITY DEFINER so policies can
-- consult platform_admins without the caller needing select rights on it (and to
-- avoid RLS recursion).
create or replace function public.is_platform_admin(uid uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from public.platform_admins where user_id = uid);
$$;

alter table public.profiles        enable row level security;
alter table public.sites           enable row level security;
alter table public.platform_admins enable row level security;
alter table public.comments        enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select_self_or_admin on public.profiles;
create policy profiles_select_self_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_platform_admin(auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());
-- INSERT is handled by the on_auth_user_created trigger (SECURITY DEFINER); no
-- client insert policy is needed or wanted.

-- ---------------------------------------------------------------------------
-- sites  (private to the owner; super-admins may read)
-- ---------------------------------------------------------------------------
drop policy if exists sites_select_owner_or_admin on public.sites;
create policy sites_select_owner_or_admin on public.sites
  for select to authenticated
  using (owner_id = auth.uid() or public.is_platform_admin(auth.uid()));

drop policy if exists sites_insert_owner on public.sites;
create policy sites_insert_owner on public.sites
  for insert to authenticated
  with check (owner_id = auth.uid());

drop policy if exists sites_update_owner on public.sites;
create policy sites_update_owner on public.sites
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists sites_delete_owner on public.sites;
create policy sites_delete_owner on public.sites
  for delete to authenticated
  using (owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- platform_admins  (only admins can see the roster; no API write policy, so only
-- the service role can add/remove admins)
-- ---------------------------------------------------------------------------
drop policy if exists platform_admins_select_admin on public.platform_admins;
create policy platform_admins_select_admin on public.platform_admins
  for select to authenticated
  using (public.is_platform_admin(auth.uid()));

-- ---------------------------------------------------------------------------
-- comments
--   SELECT: public. Comments are public annotations on public pages; the widget
--           reads them with the anon key and scopes its queries by site_id + page.
--   INSERT: none for anon/authenticated — writes flow through the Edge Function.
--   UPDATE/DELETE: only the owner of the comment's site (moderation).
-- ---------------------------------------------------------------------------
drop policy if exists comments_select_public on public.comments;
create policy comments_select_public on public.comments
  for select to anon, authenticated
  using (true);

drop policy if exists comments_update_owner on public.comments;
create policy comments_update_owner on public.comments
  for update to authenticated
  using (exists (
    select 1 from public.sites s
    where s.id = comments.site_id and s.owner_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.sites s
    where s.id = comments.site_id and s.owner_id = auth.uid()
  ));

drop policy if exists comments_delete_owner on public.comments;
create policy comments_delete_owner on public.comments
  for delete to authenticated
  using (exists (
    select 1 from public.sites s
    where s.id = comments.site_id and s.owner_id = auth.uid()
  ));
