// commentbox — origin-checked write path (Phase 3, hardened in Phase 5)
//
// The widget never inserts comments directly; it POSTs here. This function is the
// ONLY place comments are written, because Postgres RLS cannot see the HTTP Origin
// header — so origin enforcement has to live in an Edge Function. We look the site
// up with the service role, verify the request's Origin against the site's
// allowed_origins allowlist, then insert (service role bypasses RLS).
//
// Phase 5 hardening, all enforced here (server-side, where they can't be bypassed):
//   * Rate limiting — per (site, hashed-IP) sliding window. Tunable via env.
//   * Moderation    — if the site has moderation_enabled, new rows are inserted as
//                     'pending' (hidden from the public widget until an owner approves).
//   * Turnstile     — optional CAPTCHA. Only enforced when TURNSTILE_SECRET is set in
//                     the function's env; otherwise skipped, so the path is inert until
//                     you provision Cloudflare keys.
//
// Deploy with JWT verification OFF (it's a public endpoint; see supabase/config.toml):
//   supabase functions deploy post-comment
//
// Security is the Origin allowlist + per-site scoping, not a secret key. The widget
// still sends the publishable key as `apikey` so the platform gateway lets it through.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Rate limiting (tunable without a redeploy via function env / secrets).
const RATE_LIMIT_MAX = Number(Deno.env.get("RATE_LIMIT_MAX") ?? "5");
const RATE_LIMIT_WINDOW_SEC = Number(Deno.env.get("RATE_LIMIT_WINDOW_SEC") ?? "60");
const RATE_LIMIT_SALT = Deno.env.get("RATE_LIMIT_SALT") ?? "commentbox-rate-salt";

// Optional CAPTCHA. Enforced only when a secret is configured.
const TURNSTILE_SECRET = Deno.env.get("TURNSTILE_SECRET") ?? "";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Optional owner email notifications. Sent via Resend, but ONLY when a key is
// configured — so the path is inert until you provision it, exactly like the
// CAPTCHA above. A mail outage must never break commenting, so the send is
// fire-and-forget after the row is safely written.
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const RESEND_API_URL = "https://api.resend.com/emails";
// Must be an address on a domain you've verified in Resend.
const NOTIFY_FROM = Deno.env.get("NOTIFY_FROM") ?? "commentbox <notifications@commentbox.app>";
// Where the "review and reply" link points (the owner's dashboard).
const DASHBOARD_URL =
  Deno.env.get("DASHBOARD_URL") ?? "https://comment-world-dashboard.vercel.app";

const MAX_NAME = 120;
const MAX_TEXT = 4000;
const MAX_QUOTE = 2000;
const MAX_SELECTOR = 1000;

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    Vary: "Origin",
  };
}

function json(status: number, body: unknown, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function normOrigin(value: string): string {
  return value.trim().replace(/\/+$/, "").toLowerCase();
}

function originAllowed(origin: string | null, allowed: string[] | null): boolean {
  if (!allowed || allowed.length === 0) return false; // site not configured → deny
  if (allowed.includes("*")) return true; // explicit wildcard (testing convenience)
  if (!origin) return false;
  const o = normOrigin(origin);
  return allowed.some((a) => normOrigin(a) === o);
}

function clip(value: unknown, max: number): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s ? s.slice(0, max) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sanitize the widget's capture-time snapshot into a small, fixed-shape object.
 *  Only whitelisted fields are kept; strings are clipped and numbers rounded, so a
 *  client can't smuggle arbitrary/oversized JSON into the column. */
function sanitizeSnapshot(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  const vp = obj(r.viewport);
  const rect = obj(r.rect);
  const snap = {
    url: clip(r.url, 2000),
    title: clip(r.title, 300),
    tag: clip(r.tag, 40),
    context: clip(r.context, 600),
    viewport: { w: num(vp.w), h: num(vp.h) },
    rect: {
      top: num(rect.top),
      left: num(rect.left),
      width: num(rect.width),
      height: num(rect.height),
    },
  };
  // Drop entirely if nothing useful survived sanitization.
  const hasContent = snap.url || snap.title || snap.tag || snap.context;
  return hasContent ? snap : null;
}

/** Best-effort client IP from the platform's proxy headers. */
function clientIp(req: Request): string | null {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-real-ip") ??
    null
  );
}

/** Salted, non-reversible hash of the IP. Stored only for rate limiting. */
async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(RATE_LIMIT_SALT + ":" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Verify a Cloudflare Turnstile token. Only called when TURNSTILE_SECRET is set. */
async function turnstileOk(token: string | null, ip: string | null): Promise<boolean> {
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.set("secret", TURNSTILE_SECRET);
    form.set("response", token);
    if (ip) form.set("remoteip", ip);
    const res = await fetch(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
    const out = (await res.json()) as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Run a promise in the background so the HTTP response isn't held up, and so a
 *  failure can never bubble into the request path. Uses the platform's waitUntil
 *  when available so the worker isn't torn down before the send finishes. */
function runBackground(p: Promise<unknown>): void {
  const guarded = p.catch((e) => console.error("[notify] failed:", e));
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(guarded);
}

/** Resolve the site owner's email. Prefers the profiles mirror; falls back to
 *  the auth record so a missing profile row doesn't silently drop the email. */
async function ownerEmail(
  // deno-lint-ignore no-explicit-any
  admin: any,
  ownerId: string,
): Promise<string | null> {
  const { data } = await admin
    .from("profiles")
    .select("email")
    .eq("id", ownerId)
    .maybeSingle();
  if (data?.email) return data.email as string;
  try {
    const { data: u } = await admin.auth.admin.getUserById(ownerId);
    return u?.user?.email ?? null;
  } catch {
    return null;
  }
}

/** Build the owner notification. Copy follows GDS service-design style: plain
 *  English, sentence case, says what happened and the one thing to do next. */
function buildOwnerEmail(opts: {
  siteName: string;
  author: string;
  content: string;
  page: string;
  pending: boolean;
}): { subject: string; text: string; html: string } {
  const { siteName, author, content, page, pending } = opts;
  const reviewUrl = DASHBOARD_URL.replace(/\/+$/, "") + "/dashboard";
  const snippet = content.length > 600 ? content.slice(0, 600) + "…" : content;
  const subject = pending
    ? `New comment to review on ${siteName}`
    : `New comment on ${siteName}`;
  const statusLine = pending
    ? "This comment is waiting for you to approve it. It will not appear on your site until you do."
    : "This comment is now live on your site.";

  const text = [
    `${author} left a comment on ${siteName}.`,
    "",
    `"${snippet}"`,
    "",
    `Page: ${page}`,
    "",
    statusLine,
    "",
    `Review and reply: ${reviewUrl}`,
    "",
    "—",
    `You are getting this email because you own ${siteName} on commentbox.`,
  ].join("\n");

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3f4f6;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0b1020;line-height:1.5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;border:1px solid #e5e7eb;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0 0 4px;font-size:18px;line-height:1.3;">${escapeHtml(subject)}</h1>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;">${escapeHtml(author)} left a comment on ${escapeHtml(siteName)}.</p>
      <blockquote style="margin:0 0 16px;padding:12px 16px;background:#f9fafb;border-left:3px solid #00267f;border-radius:0 8px 8px 0;font-size:15px;white-space:pre-wrap;">${escapeHtml(snippet)}</blockquote>
      <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">Page</p>
      <p style="margin:0 0 16px;font-size:14px;word-break:break-all;">${escapeHtml(page)}</p>
      <p style="margin:0 0 20px;font-size:14px;color:#4b5563;">${escapeHtml(statusLine)}</p>
      <a href="${escapeHtml(reviewUrl)}" style="display:inline-block;background:#00267f;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;border-radius:8px;">Review and reply</a>
    </td></tr>
    <tr><td style="padding:20px 28px 28px;">
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 12px;" />
      <p style="margin:0;color:#9ca3af;font-size:12px;">You are getting this email because you own ${escapeHtml(siteName)} on commentbox.</p>
    </td></tr>
  </table>
</body></html>`;

  return { subject, text, html };
}

/** Email the site owner about a new comment. Best-effort: any failure is logged,
 *  never thrown, so the comment write is unaffected. */
async function notifyOwner(
  // deno-lint-ignore no-explicit-any
  admin: any,
  opts: {
    ownerId: string;
    siteName: string;
    author: string;
    content: string;
    page: string;
    pending: boolean;
  },
): Promise<void> {
  const to = await ownerEmail(admin, opts.ownerId);
  if (!to) {
    console.warn("[notify] no owner email for site owner", opts.ownerId);
    return;
  }
  const { subject, text, html } = buildOwnerEmail(opts);
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject, text, html }),
  });
  if (!res.ok) {
    console.error("[notify] resend error", res.status, await res.text());
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" }, origin);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" }, origin);
  }

  const siteId = clip(body.siteId, 64);
  const page = clip(body.page, 1000);
  const name = clip(body.name, MAX_NAME);
  const text = clip(body.text, MAX_TEXT);
  const selector = clip(body.selector, MAX_SELECTOR);
  const quote = clip(body.quote, MAX_QUOTE);
  const turnstileToken = clip(body.turnstileToken, 4000);
  const parentId = clip(body.parentId, 64);
  const snapshot = sanitizeSnapshot(body.snapshot);

  if (!siteId || !page || !name || !text) {
    return json(400, { error: "missing_fields" }, origin);
  }

  if (parentId && !UUID_RE.test(parentId)) {
    return json(400, { error: "invalid_parent" }, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, name, owner_id, allowed_origins, moderation_enabled")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr) return json(500, { error: "lookup_failed" }, origin);
  if (!site) return json(404, { error: "unknown_site" }, origin);

  if (!originAllowed(origin, site.allowed_origins as string[] | null)) {
    return json(403, { error: "origin_not_allowed" }, origin);
  }

  // A reply must point at an existing comment on THIS site (prevents cross-tenant
  // threading and dangling parents).
  if (parentId) {
    const { data: parent, error: parentErr } = await admin
      .from("comments")
      .select("id, site_id")
      .eq("id", parentId)
      .maybeSingle();
    if (parentErr) return json(500, { error: "lookup_failed" }, origin);
    if (!parent || parent.site_id !== siteId) {
      return json(400, { error: "invalid_parent" }, origin);
    }
  }

  // ---- optional CAPTCHA (only when configured) -----------------------------
  if (TURNSTILE_SECRET) {
    const ok = await turnstileOk(turnstileToken, clientIp(req));
    if (!ok) return json(403, { error: "captcha_failed" }, origin);
  }

  // ---- rate limiting -------------------------------------------------------
  const ip = clientIp(req);
  const ipHash = ip ? await hashIp(ip) : null;
  if (ipHash && RATE_LIMIT_MAX > 0) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_SEC * 1000).toISOString();
    const { count, error: rlErr } = await admin
      .from("comments")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId)
      .eq("ip_hash", ipHash)
      .gte("created_at", since);
    if (!rlErr && typeof count === "number" && count >= RATE_LIMIT_MAX) {
      return new Response(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: {
          ...corsHeaders(origin),
          "Content-Type": "application/json",
          "Retry-After": String(RATE_LIMIT_WINDOW_SEC),
        },
      });
    }
  }

  // ---- insert (pending if the site moderates) ------------------------------
  const status = site.moderation_enabled ? "pending" : "approved";

  const { error: insErr } = await admin.from("comments").insert({
    site_id: siteId,
    page,
    selector,
    quote,
    author: name,
    content: text,
    status,
    ip_hash: ipHash,
    parent_id: parentId,
    snapshot,
  });

  if (insErr) return json(500, { error: "insert_failed" }, origin);

  // ---- notify the owner (best-effort, only when email is configured) --------
  // The row is already written; this runs in the background and can never affect
  // the response or the comment itself.
  if (RESEND_API_KEY && site.owner_id) {
    runBackground(
      notifyOwner(admin, {
        ownerId: site.owner_id as string,
        siteName: (site.name as string) ?? "your site",
        author: name,
        content: text,
        page,
        pending: status === "pending",
      }),
    );
  }

  return json(200, { ok: true, status }, origin);
});
