import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

/** Server-side installation check: fetch the owner's page and look for the widget
 *  script and this site's siteId in the returned HTML. Done server-side to avoid
 *  the browser's cross-origin restrictions. */
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

  // Try the URL as given, then forgiving variants. A common mistake is a trailing
  // slash after a filename (e.g. ".../index.html/"), which static hosts like GitHub
  // Pages treat as a missing directory and 404. Build de-duplicated candidates that
  // toggle that trailing slash so the check succeeds on the page the user means.
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
  let fetched = false;
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, {
        headers: { "User-Agent": "commentbox-verifier/1.0" },
        redirect: "follow",
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        html = await res.text();
        fetched = true;
        break;
      }
      lastStatus = res.status;
    } catch {
      lastStatus = 0;
    }
  }

  if (!fetched) {
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

  const foundSiteId = html.includes(siteId);
  const foundScript = /commentbox|widget\.js|CommentWidget/i.test(html);

  return NextResponse.json({
    ok: foundSiteId && foundScript,
    foundSiteId,
    foundScript,
  });
}
