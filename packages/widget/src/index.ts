/* commentbox loader / entry point (the published widget.js).
 *
 * Reads configuration from `window.CommentWidget`, attaches a Shadow DOM container to
 * the page, injects the bundled CSS into the shadow root, then boots the annotation
 * core. Using Shadow DOM means the host page's CSS cannot affect the widget's UI and
 * the widget's CSS cannot leak into the host. supabase-js is bundled in and
 * lazy-initialized on first use (see supabase.ts). */

// `?inline` returns the (processed, minified) CSS as a string instead of emitting a
// separate stylesheet, so everything ships inside the single widget.js file.
import styleText from "./styles.css?inline";
import { init } from "./init";

const HOST_ID = "commentbox-root";

function mount(): ShadowRoot | null {
  if (document.getElementById(HOST_ID)) {
    // Already installed once on this page — don't double-mount.
    return null;
  }
  const host = document.createElement("div");
  host.id = HOST_ID;
  document.body.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = styleText;
  shadow.appendChild(style);
  return shadow;
}

function boot(): void {
  const cfg = window.CommentWidget;
  const siteId = cfg?.siteId;
  if (!siteId) {
    console.warn(
      "[commentbox] window.CommentWidget.siteId is required. " +
        'Add: <script>window.CommentWidget = { siteId: "your-site-id" };</script>'
    );
    return;
  }
  const root = mount();
  if (!root) return;
  init({ siteId, pageId: cfg?.pageId }, root);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
