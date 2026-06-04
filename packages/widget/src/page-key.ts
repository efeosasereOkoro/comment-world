/**
 * Compute the page key that scopes comments within a site.
 *
 * Default: normalize the current location — drop the query string and hash, strip a
 * trailing `index.html`, and collapse a trailing slash. The host can override this
 * entirely via `window.CommentWidget.pageId` (e.g. for SPA routes or canonical URLs).
 *
 * The origin is intentionally excluded: comments are already scoped by `site_id`, so
 * keying on the path keeps comments stable if the site moves domains.
 */
export function computePageKey(override?: string): string {
  if (override && override.trim()) return override.trim();

  let path = location.pathname.replace(/index\.html$/i, "");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}
