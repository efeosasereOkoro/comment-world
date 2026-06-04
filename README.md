# commentbox

An embeddable, multi-tenant comment / annotation widget. Drop two `<script>` tags on
any website and visitors can leave anchored comments that everyone sees, scoped to that
site — like a feedback layer (Hypothesis / Marker.io style), installed like tawk.to.

```html
<script>window.CommentWidget = { siteId: "your-site-id" };</script>
<script async src="https://cdn.commentbox.app/widget.js"></script>
```

## Monorepo layout

| Path                 | What it is                                                            |
| -------------------- | --------------------------------------------------------------------- |
| `packages/widget`    | The embeddable widget. Builds to a single self-contained `widget.js`. |
| `apps/dashboard`     | Owner + platform-admin dashboard (Next.js App Router).                |
| `supabase`           | Database schema, RLS policies, and the `post-comment` Edge Function. *(Phase 3)* |
| `examples/test-host` | A different-CSS-framework page used to prove style isolation. *(Phase 2)* |

## Build phases

1. **Refactor** — wrap the original `comments.js` logic in `init({ siteId, pageId })`, no globals. ✅
2. **Isolation + bundle** — Shadow DOM for all UI, single minified `widget.js`, inlined CSS, lazy supabase. ✅
3. **Multi-tenancy** — `sites`/`profiles` tables, `site_id` on comments, two-audience RLS, origin-checked write path. ✅
4. **Dashboard** — owner auth, create-site, embed snippet, moderation; platform super-admin oversight. ✅
5. **Hardening** — anonymous auth, rate limiting, Turnstile CAPTCHA, optional moderation mode. ← *current*
6. **Anchor robustness** — multi-anchor storage + graceful orphaning so no comment is lost.

## Develop the widget

```bash
npm install
npm run dev:widget      # opens the dev harness in packages/widget/index.html
npm run build:widget    # produces packages/widget/dist/widget.js
```

The Supabase URL + publishable key are public and baked into the widget build via
`packages/widget/.env` (see `.env.example`). The host page only ever supplies `siteId`.

## Backend setup (Phase 3)

The `supabase/` folder holds everything the backend needs. With no Supabase CLI, run
the SQL by hand; with the CLI, link the project and push.

**1. Run the migrations** (Supabase dashboard → SQL editor), in order:

- `supabase/migrations/0001_schema.sql` — `profiles`, `sites`, `platform_admins`, `comments`
- `supabase/migrations/0002_rls.sql` — Row Level Security policies
- `supabase/migrations/0003_realtime_and_triggers.sql` — realtime + new-user trigger

**2. Deploy the write path** (origin-checked Edge Function):

```bash
supabase functions deploy post-comment   # config.toml sets verify_jwt = false
```

The function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, which Supabase
injects automatically — no extra secrets to set.

**3. Register a site.** Until the Phase 4 dashboard exists, insert one by hand (as the
owner, or via SQL editor):

```sql
insert into public.sites (owner_id, name, allowed_origins)
values (auth.uid(), 'My site', array['https://example.com'])
returning id;   -- this id is the siteId for the <script> tag
```

Use `array['*']` for `allowed_origins` only while testing — it accepts any origin.

**4. (Optional) Grant yourself super-admin** for the Phase 4 `/admin` view:

```sql
insert into public.platform_admins (user_id) values ('<your-auth-user-id>');
```

### How writes are secured

Postgres RLS can't see the HTTP `Origin` header, so the widget never inserts directly.
It POSTs to `post-comment`, which verifies the request's `Origin` against the site's
`allowed_origins` and then inserts with the service role. Anonymous reads are allowed
(comments are public annotations); anonymous inserts/updates/deletes are not.

## Dashboard (Phase 4)

`apps/dashboard` is a Next.js App Router app for owners and the platform admin.

```bash
cp apps/dashboard/.env.example apps/dashboard/.env.local   # fill in the Supabase values
npm -w @commentbox/dashboard run dev                       # http://localhost:3001
```

- **Owners** sign in (Supabase Auth, email/password), create sites, copy the embed
  snippet, set each site's `allowed_origins`, run a "verify installation" check
  (server-side fetch of the page), and moderate (delete) their own sites' comments.
- **Platform admin** (`/admin`) gets read-only oversight: total users, who they are,
  sites per user, and comment counts. Visible only to users in `platform_admins`.

Auth, data access, and the admin gate are all enforced by the same RLS policies from
Phase 3 — the dashboard uses only the public publishable key, never the service role.
