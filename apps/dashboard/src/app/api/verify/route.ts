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

  let html = "";
  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": "commentbox-verifier/1.0" },
      redirect: "follow",
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, reason: `Page returned HTTP ${res.status}.` },
        { status: 200 }
      );
    }
    html = await res.text();
  } catch {
    return NextResponse.json(
      { ok: false, reason: "Could not fetch that URL (timeout or network error)." },
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
