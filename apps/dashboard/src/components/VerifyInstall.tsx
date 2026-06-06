"use client";

import { useState } from "react";

type WriteStatus =
  | "ok"
  | "pending"
  | "origin_not_allowed"
  | "rate_limited"
  | "captcha_required"
  | "unknown_site"
  | "error";

type Result =
  | { ok: false; reason: string } // page couldn't be fetched
  | {
      ok: boolean;
      scriptOk: boolean;
      siteIdOk: boolean;
      writeOk: boolean;
      writeStatus: WriteStatus;
      origin: string;
      checkedUrl: string;
    };

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: "flex", gap: ".5rem", alignItems: "baseline" }}>
      <span aria-hidden style={{ color: ok ? "var(--ok)" : "var(--danger)", fontWeight: 700 }}>
        {ok ? "✓" : "✗"}
      </span>
      <span>{children}</span>
    </li>
  );
}

export default function VerifyInstall({
  siteId,
  defaultUrl,
}: {
  siteId: string;
  defaultUrl: string;
}) {
  const [url, setUrl] = useState(defaultUrl);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, siteId }),
      });
      setResult(await res.json());
    } catch {
      setResult({ ok: false, reason: "Verification request failed." });
    }
    setBusy(false);
  }

  return (
    <form onSubmit={check} className="stack">
      <div className="field">
        <label htmlFor="verify-url">Page URL to check</label>
        <input
          id="verify-url"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/"
          required
        />
      </div>
      <button className="btn btn--secondary" type="submit" disabled={busy}>
        {busy ? "Checking…" : "Verify installation"}
      </button>

      {/* Page couldn't be fetched at all */}
      {result && "reason" in result && (
        <div className="notice notice--error">{result.reason}</div>
      )}

      {/* Full check ran */}
      {result && "scriptOk" in result && (
        <div className={`notice ${result.ok ? "notice--ok" : "notice--error"}`}>
          <strong>{result.ok ? "✓ Installed and working" : "Almost there"}</strong>
          <ul style={{ margin: ".5rem 0 0", paddingLeft: "1.1rem", listStyle: "none" }}>
            <Row ok={result.scriptOk}>
              {result.scriptOk
                ? "Widget script found on the page"
                : "Widget script tag not found — paste both tags before </body>"}
            </Row>
            <Row ok={result.siteIdOk}>
              {result.siteIdOk
                ? "Your siteId is present"
                : "Your siteId wasn't found in the snippet on the page"}
            </Row>
            <Row ok={result.writeOk}>{writeMessage(result.writeStatus, result.origin)}</Row>
          </ul>
        </div>
      )}
    </form>
  );
}

function writeMessage(status: WriteStatus, origin: string): React.ReactNode {
  switch (status) {
    case "ok":
      return "Comments can be posted from this page (live write test passed)";
    case "pending":
      return "Write test passed — comments arrive as pending (moderation is on)";
    case "rate_limited":
      return "Write path works (the test was rate-limited, which is expected)";
    case "origin_not_allowed":
      return (
        <>
          Comments are blocked: add <code>{origin}</code> to this site&apos;s Allowed
          origins below, then re-check.
        </>
      );
    case "captcha_required":
      return "Turnstile CAPTCHA is enabled, so the write test can't run automatically — post a real comment to confirm.";
    case "unknown_site":
      return "The backend doesn't recognize this siteId.";
    default:
      return "Couldn't complete the live write test.";
  }
}
