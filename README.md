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
5. **Hardening** — server-side rate limiting, optional per-site moderation, and an (env-gated) Turnstile CAPTCHA path. ✅
6. **Anchor robustness** — two-anchor resolution (CSS path + text quote) with graceful orphaning so no comment is lost. ✅

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
- `supabase/migrations/0004_hardening.sql` — moderation flag, comment `status`, rate-limit `ip_hash`, split read policy *(Phase 5)*

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

## Hardening (Phase 5)

Abuse controls live in the `post-comment` Edge Function and the database, where they
can't be bypassed by a tampered client:

- **Rate limiting** — each request is keyed by `(site_id, hashed-IP)` over a sliding
  window. The IP is salted-SHA-256'd (`ip_hash`, never exposed to the read path) purely
  to count recent posts; over the limit returns `429 rate_limited`. Tunable via the
  function's env (no redeploy needed):

  | Env var | Default | Meaning |
  | --- | --- | --- |
  | `RATE_LIMIT_MAX` | `5` | Max comments per window per IP per site (`0` disables). |
  | `RATE_LIMIT_WINDOW_SEC` | `60` | Window length in seconds. |
  | `RATE_LIMIT_SALT` | _(built-in)_ | Secret salt for the IP hash — set your own. |

- **Optional moderation** — flip `moderation_enabled` on a site (dashboard → site →
  Moderation). New comments then insert as `status = 'pending'` and are hidden from the
  public widget by RLS (public read sees only `approved`; owners/admins see all). The
  owner approves or rejects from the site's comment list; the widget shows the poster a
  "submitted for review" notice.

- **Turnstile CAPTCHA (optional, off by default)** — set `TURNSTILE_SECRET` in the
  function's env to require a Cloudflare Turnstile token on every post (verified
  server-side; failure returns `403 captcha_failed`). With no secret set the check is
  skipped entirely, so nothing breaks until you provision keys. The widget already
  forwards a `turnstileToken` field when present.

  Set function env/secrets with the CLI, e.g.:

  ```bash
  supabase secrets set RATE_LIMIT_MAX=10 RATE_LIMIT_SALT=$(openssl rand -hex 16)
  supabase secrets set TURNSTILE_SECRET=1x0000000000000000000000000000000AA   # to enable CAPTCHA
  ```

> **Note on anonymous auth.** The original plan listed Supabase anonymous auth. Because
> writes already go through the service-role Edge Function and reads are public
> annotations, a per-visitor anonymous JWT added churn without a clear security gain
> here — IP-based rate limiting covers the abuse case. It's intentionally deferred; the
> hook to add it (token in `add()`) is in place if a future feature needs per-visitor
> identity.

## Anchor robustness (Phase 6)

Host pages change — a redesign, an A/B test, or a CMS edit can move or rename the
element a comment was attached to. Every comment already stores **two anchors**: the
CSS-path `selector` and the highlighted `quote` text. `resolveAnchor` (in
`packages/widget/src/selector.ts`) now tries them in order of precision so a comment
re-attaches itself instead of disappearing:

1. **Exact selector** — `document.querySelector(selector)`. Trusted only if the matched
   element still contains the quote; a bare selector match can silently land on the
   *wrong* element after sibling insertion shifts an `nth-of-type` index, so the quote
   acts as a tie-breaker.
2. **Quote within the nearest surviving ancestor** — the selector's `" > "` chain is
   walked from the full path down to its first segment; the longest still-present prefix
   scopes a text search for the deepest element containing the quote.
3. **Quote anywhere** — the same text search across `<body>` as a last resort.

If none match (the quoted text is gone from the page), the comment is **orphaned, not
lost**: no pin is drawn, but it still appears in the side panel under a "Not on this
page" section with its full text, so reviewers never lose a comment to DOM drift. The
text search skips the widget's own UI (shadow host + pins layer) so it can't match
itself.

## Email notifications & auth flow (Phase 7)

Two pieces of messaging, both written in plain, GDS-style service-design English (say
what happened, then the one thing to do next):

### 1. Email the owner when a comment arrives

After the `post-comment` Edge Function writes a row, it emails the site owner via
[Resend](https://resend.com). The send is **best-effort and out of the request path** —
it runs in the background (`EdgeRuntime.waitUntil`) and any failure is logged, never
thrown, so a mail outage can't break commenting. The owner address is read from
`profiles.email`, falling back to the auth record.

Like the CAPTCHA, the feature is **inert until configured** — no key, no send, nothing
breaks. To enable it, verify a sending domain in Resend, then set the function secrets:

| Env var | Default | Meaning |
| --- | --- | --- |
| `RESEND_API_KEY` | _(unset → disabled)_ | Resend API key. Presence enables notifications. |
| `NOTIFY_FROM` | `commentbox <notifications@commentbox.app>` | From address on a Resend-verified domain. |
| `DASHBOARD_URL` | `https://comment-world-dashboard.vercel.app` | Base for the email's "Review and reply" link. |

```bash
supabase secrets set RESEND_API_KEY=re_xxx NOTIFY_FROM="commentbox <hello@yourdomain>"
supabase functions deploy post-comment
```

The email states who commented, the comment text, the page, and whether it is live or
**waiting for approval** (when the site moderates), with a single "Review and reply"
button to the dashboard.

### 2. After confirming their email, owners land back on the sign-up page

Sign-up passes `emailRedirectTo = <origin>/login?confirmed=1`. When a new owner clicks
the confirmation link in their inbox, they come back to the sign-in page, which shows a
clear confirmation — _"You've confirmed your email address. Sign in to get started."_ —
and defaults to the sign-in form.

> **One-time Supabase setting:** add the redirect target to **Auth → URL Configuration →
> Redirect URLs** so Supabase will honour it:
> `https://comment-world-dashboard.vercel.app/login` and, for local dev,
> `http://localhost:3001/login`.
