"use client";

import { useState } from "react";

type Result =
  | { ok: true }
  | { ok: false; foundSiteId?: boolean; foundScript?: boolean; reason?: string };

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

      {result && result.ok && (
        <div className="notice notice--ok">
          ✓ Installed correctly — the widget script and your siteId were found on that page.
        </div>
      )}
      {result && !result.ok && (
        <div className="notice notice--error">
          {"reason" in result && result.reason ? (
            result.reason
          ) : (
            <>
              Not detected.{" "}
              {result.foundScript === false && "The widget script tag wasn't found. "}
              {result.foundSiteId === false && "Your siteId wasn't found on the page. "}
              Make sure both script tags are pasted into the page.
            </>
          )}
        </div>
      )}
    </form>
  );
}
