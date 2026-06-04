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
| `apps/dashboard`     | Owner + platform-admin dashboard (Next.js). *(Phase 4)*               |
| `supabase`           | Database schema, RLS policies, and the `post-comment` Edge Function. *(Phase 3)* |
| `examples/test-host` | A different-CSS-framework page used to prove style isolation. *(Phase 2)* |

## Build phases

1. **Refactor** — wrap the original `comments.js` logic in `init({ siteId, pageId })`, no globals. ← *current*
2. **Isolation + bundle** — Shadow DOM for all UI, single minified `widget.js`, inlined CSS, lazy supabase.
3. **Multi-tenancy** — `sites`/`profiles` tables, `site_id` on comments, two-audience RLS, origin-checked write path.
4. **Dashboard** — owner auth, create-site, embed snippet, moderation; platform super-admin oversight.
5. **Hardening** — anonymous auth, rate limiting, Turnstile CAPTCHA, optional moderation mode.
6. **Anchor robustness** — multi-anchor storage + graceful orphaning so no comment is lost.

## Develop the widget

```bash
npm install
npm run dev:widget      # opens the dev harness in packages/widget/index.html
npm run build:widget    # produces packages/widget/dist/widget.js
```

The Supabase URL + publishable key are public and baked into the widget build via
`packages/widget/.env` (see `.env.example`). The host page only ever supplies `siteId`.
