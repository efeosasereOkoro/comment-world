/**
 * Pure origin-normalization helpers, kept free of Next/server imports so they can
 * be unit-tested in isolation. Used by the dashboard server actions when saving a
 * site's allowed-origins list.
 */

/**
 * Normalize a single origin entry to exactly what a browser sends in the `Origin`
 * header: scheme + host + (non-default) port, no path/query/hash. This is critical —
 * the post-comment Edge Function compares the request Origin against these values, so
 * a stored full URL like "https://site.tld/page.html" can NEVER match and silently
 * blocks all comments. We parse with the URL API (prepending https:// when the user
 * omits a scheme) and keep only `.origin`. The "*" wildcard is passed through as-is.
 * Returns null for anything unparseable so the caller can drop it.
 */
export function normalizeOrigin(entry: string): string | null {
  const s = entry.trim();
  if (!s) return null;
  if (s === "*") return "*";
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "https://" + s;
    return new URL(withScheme).origin.toLowerCase();
  } catch {
    return null;
  }
}

/** Parse a textarea of origins (comma- or newline-separated) into a clean, deduped
 *  array of normalized origins. Unparseable entries are dropped. */
export function parseOrigins(raw: string): string[] {
  return Array.from(
    new Set(
      raw
        .split(/[\n,]/)
        .map(normalizeOrigin)
        .filter((o): o is string => o !== null)
    )
  );
}
