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
    .select("id, allowed_origins, moderation_enabled")
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

  return json(200, { ok: true, status }, origin);
});
