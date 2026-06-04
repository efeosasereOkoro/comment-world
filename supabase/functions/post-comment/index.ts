// commentbox — origin-checked write path (Phase 3)
//
// The widget never inserts comments directly; it POSTs here. This function is the
// ONLY place comments are written, because Postgres RLS cannot see the HTTP Origin
// header — so origin enforcement has to live in an Edge Function. We look the site
// up with the service role, verify the request's Origin against the site's
// allowed_origins allowlist, then insert (service role bypasses RLS).
//
// Deploy with JWT verification OFF (it's a public endpoint; see supabase/config.toml):
//   supabase functions deploy post-comment
//
// Security is the Origin allowlist + per-site scoping, not a secret key. The widget
// still sends the publishable key as `apikey` so the platform gateway lets it through.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

  if (!siteId || !page || !name || !text) {
    return json(400, { error: "missing_fields" }, origin);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: site, error: siteErr } = await admin
    .from("sites")
    .select("id, allowed_origins")
    .eq("id", siteId)
    .maybeSingle();

  if (siteErr) return json(500, { error: "lookup_failed" }, origin);
  if (!site) return json(404, { error: "unknown_site" }, origin);

  if (!originAllowed(origin, site.allowed_origins as string[] | null)) {
    return json(403, { error: "origin_not_allowed" }, origin);
  }

  const { error: insErr } = await admin.from("comments").insert({
    site_id: siteId,
    page,
    selector,
    quote,
    author: name,
    content: text,
  });

  if (insErr) return json(500, { error: "insert_failed" }, origin);

  return json(200, { ok: true }, origin);
});
