import { NextResponse } from "next/server";
import https from "node:https";
import { getUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, SUPABASE_KEY } from "@/lib/env";
import { INSTALL_CHECK_PAGE } from "@/lib/constants";
import { interpretWriteResult, type PostResult } from "@/lib/verify-result";

/**
 * Server-side installation check. Two parts:
 *  1. Fetch the owner's page and confirm the widget script + siteId are present.
 *  2. Actually exercise the write path: POST a throwaway test comment to the
 *     post-comment Edge Function with the page's Origin, so we catch the #1 real
 *     failure — an origin that isn't on the site's allowlist (a 403 the plain
 *     "script is on the page" check can't see). The test comment is written to a
 *     hidden page key and deleted immediately, so it never shows on the live page.
 *
 *  Done server-side to dodge the browser's cross-origin restrictions, and to let us
 *  set the Origin header to the verified page (browsers forbid that; Node doesn't).
 */

const CHECK_PAGE = INSTALL_CHECK_PAGE;
const FUNCTIONS_URL = SUPABASE_URL ? SUPABASE_URL.replace(/\/+$/, "") + "/functions/v1" : "";

/** Best-effort delete of every test comment on the hidden install-check page for a
 *  site, using the owner's RLS session. Called both before the live test (sweeping
 *  residue from any earlier run whose cleanup failed) and after it. */
async function sweepCheckComments(siteId: string): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.from("comments").delete().eq("site_id", siteId).eq("page", CHECK_PAGE);
  } catch {
    /* best effort; the check page is filtered out of the dashboard anyway */
  }
}

/** POST to the Edge Function with a chosen Origin header (node:https gives us full
 *  header control — fetch/undici strips a forbidden `Origin`). */
function postTestComment(origin: string, siteId: string): Promise<PostResult> {
  return new Promise((resolve) => {
    const u = new URL(FUNCTIONS_URL + "/post-comment");
    const data = JSON.stringify({
      siteId,
      page: CHECK_PAGE,
      name: "commentbox",
      text: "Installation check — safe to ignore.",
      selector: "",
      quote: "",
    });
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
          apikey: SUPABASE_KEY,
          Authorization: "Bearer " + SUPABASE_KEY,
          Origin: origin,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let body: PostResult["body"] = null;
          try {
            body = JSON.parse(raw);
          } catch {
            /* non-JSON body */
          }
          resolve({ status: res.statusCode || 0, body });
        });
      }
    );
    req.on("error", () => resolve({ status: 0, body: null }));
    req.setTimeout(10000, () => {
      req.destroy();
      resolve({ status: 0, body: null });
    });
    req.write(data);
    req.end();
  });
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { url?: string; siteId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { url, siteId } = body;
  if (!url || !siteId) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) throw new Error("bad protocol");
  } catch {
    return NextResponse.json({ error: "invalid_url" }, { status: 400 });
  }

  // Try the URL as given, then forgiving variants. A trailing slash after a filename
  // (".../index.html/") makes static hosts 404; toggle it so the check still finds
  // the page the user means.
  const candidates: string[] = [];
  const pushCandidate = (u: URL) => {
    const s = u.toString();
    if (!candidates.includes(s)) candidates.push(s);
  };
  pushCandidate(target);
  if (/\.[a-z0-9]+\/$/i.test(target.pathname)) {
    const noSlash = new URL(target.toString());
    noSlash.pathname = noSlash.pathname.replace(/\/+$/, "");
    pushCandidate(noSlash);
  } else if (!target.pathname.endsWith("/")) {
    const withSlash = new URL(target.toString());
    withSlash.pathname = withSlash.pathname + "/";
    pushCandidate(withSlash);
  }

  let html = "";
  let lastStatus = 0;
  let fetchedUrl = "";
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { "User-Agent": "commentbox-verifier/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        html = await res.text();
        fetchedUrl = res.url || candidate;
        break;
      }
      lastStatus = res.status;
    } catch {
      lastStatus = 0;
    }
  }

  if (!fetchedUrl) {
    return NextResponse.json(
      {
        ok: false,
        reason: lastStatus
          ? `Page returned HTTP ${lastStatus}.`
          : "Could not fetch that URL (timeout or network error).",
      },
      { status: 200 }
    );
  }

  const siteIdOk = html.includes(siteId);
  const scriptOk = /commentbox|widget\.js|CommentWidget/i.test(html);
  const origin = new URL(fetchedUrl).origin;

  // Part 2: exercise the real write path from the page's origin.
  let writeOk = false;
  let writeStatus: ReturnType<typeof interpretWriteResult>["writeStatus"] = "error";

  if (FUNCTIONS_URL) {
    // Sweep any residue from an earlier run whose post-test cleanup failed, so a
    // successful test never adds to a growing pile of leftover check comments.
    await sweepCheckComments(siteId);

    const res = await postTestComment(origin, siteId);
    ({ writeOk, writeStatus } = interpretWriteResult(res));

    // If the write landed (200/pending), delete the throwaway comment immediately.
    if (res.status === 200) await sweepCheckComments(siteId);
  }

  return NextResponse.json({
    ok: siteIdOk && scriptOk && writeOk,
    scriptOk,
    siteIdOk,
    writeOk,
    writeStatus,
    origin,
    checkedUrl: fetchedUrl,
  });
}
