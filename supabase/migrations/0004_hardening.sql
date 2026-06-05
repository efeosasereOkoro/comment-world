-- commentbox Phase 5 — hardening
-- Run after 0003. Adds optional moderation, a per-comment status, and the columns
-- the post-comment Edge Function needs for IP-based rate limiting.
--
--   * sites.moderation_enabled — when true, new comments arrive as 'pending' and stay
--     hidden from the public widget until an owner approves them.
--   * comments.status — 'approved' (visible) or 'pending' (awaiting moderation).
--   * comments.ip_hash — a salted SHA-256 of the poster's IP, written by the Edge
--     Function purely for rate limiting. It is not reversible and never exposed to the
--     public read path (the widget selects specific columns).

-- ---------------------------------------------------------------------------
-- new columns
-- ---------------------------------------------------------------------------
alter table public.sites
  add column if not exists moderation_enabled boolean not null default false;

alter table public.comments
  add column if not exists status text not null default 'approved'
    check (status in ('approved', 'pending'));

alter table public.comments
  add column if not exists ip_hash text;

-- Rate-limit lookups count recent rows per (site, ip) — index for them.
create index if not exists comments_site_ip_created_idx
  on public.comments (site_id, ip_hash, created_at);

-- Moderation queues filter by (site, status) — index for the dashboard + widget.
create index if not exists comments_site_status_idx
  on public.comments (site_id, status);

-- ---------------------------------------------------------------------------
-- comments SELECT policy — split into two audiences.
--   Public (anon + authenticated): only APPROVED comments are visible. This is what
--     hides a pending comment from the widget when moderation is on.
--   Owner/super-admin: see ALL of their sites' comments (incl. pending) so the
--     dashboard moderation queue works. Policies are OR'd, so an owner viewing their
--     own site still sees everything.
-- ---------------------------------------------------------------------------
drop policy if exists comments_select_public on public.comments;
create policy comments_select_public on public.comments
  for select to anon, authenticated
  using (status = 'approved');

drop policy if exists comments_select_owner_or_admin on public.comments;
create policy comments_select_owner_or_admin on public.comments
  for select to authenticated
  using (
    public.is_platform_admin(auth.uid())
    or exists (
      select 1 from public.sites s
      where s.id = comments.site_id and s.owner_id = auth.uid()
    )
  );
