"use client";

import { useState } from "react";

export default function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div>
      <code className="code">{text}</code>
      <button className="btn btn--secondary btn--sm" onClick={copy} style={{ marginTop: ".6rem" }}>
        {copied ? "Copied!" : "Copy snippet"}
      </button>
    </div>
  );
}
