-- commentbox Phase 7 — threaded replies, triage workflow, capture-time snapshot
-- Run after 0004_hardening.sql (Supabase SQL editor or `supabase db push`).
--
-- Three additive feature columns on public.comments — all nullable / defaulted, so
-- existing rows and the existing read/write paths keep working unchanged:
--
--   * parent_id    — threaded replies. A reply is a comment whose parent_id points at
--                    another comment on the SAME site. Top-level comments have NULL.
--   * triage_*     — owner-facing workflow, ORTHOGONAL to the moderation `status`
--                    column (which controls public visibility). triage_status tracks
--                    open / in_progress / resolved; assignee + tags are free metadata.
--   * snapshot     — JSON captured by the widget at comment time (page url/title,
--                    viewport, anchored element tag/rect, a short text excerpt) so the
--                    feedback keeps its original visual context even after a redesign.

-- ---------------------------------------------------------------------------
-- threaded replies
-- ---------------------------------------------------------------------------
alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete cascade;

create index if not exists comments_parent_id_idx on public.comments (parent_id);

-- ---------------------------------------------------------------------------
-- triage workflow (owner-facing; does not affect public visibility)
-- ---------------------------------------------------------------------------
alter table public.comments
  add column if not exists triage_status text not null default 'open'
    check (triage_status in ('open', 'in_progress', 'resolved'));

alter table public.comments
  add column if not exists assignee text;

alter table public.comments
  add column if not exists tags text[] not null default '{}';

-- Dashboard filters/sorts the queue by (site, triage_status).
create index if not exists comments_site_triage_idx
  on public.comments (site_id, triage_status);

-- ---------------------------------------------------------------------------
-- capture-time context snapshot
-- ---------------------------------------------------------------------------
-- Stores only data already visible on the public page (URL, title, the anchored
-- element's tag + bounding box + a short visible-text excerpt, and the viewport
-- size). The Edge Function sanitizes and size-caps it before insert. The widget's
-- public read selects explicit columns and never pulls this back, so it adds no new
-- payload to the live feed.
alter table public.comments
  add column if not exists snapshot jsonb;

-- ---------------------------------------------------------------------------
-- RLS note: no policy changes needed.
--   * Replies are ordinary comment rows — the Phase 5 split SELECT policies
--     (public sees approved; owner/admin sees all) and the owner UPDATE/DELETE
--     policy already cover them.
--   * Triage edits are owner UPDATEs, already permitted by comments_update_owner.
-- ---------------------------------------------------------------------------
