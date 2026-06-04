/* commentbox loader / entry point.
 * Reads configuration from `window.CommentWidget`, then boots the annotation core.
 *
 * Phase 1: styles are injected into <head> (light DOM) via the CSS import below, and
 * UI is appended to <body>. Phase 2 replaces this with a Shadow DOM container that
 * receives the inlined CSS, so the widget is fully isolated from the host page. */

import "./styles.css";
import { init } from "./init";

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
  init({ siteId, pageId: cfg?.pageId });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
