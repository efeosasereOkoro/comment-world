/* commentbox annotation core.
 * Reviewers select text or click a component to attach a named comment. Comments are
 * stored centrally and sync in real time, so everyone on the page sees the same set.
 *
 * All widget UI (toolbar, popover, panel, hint) is rendered INTO the shadow root passed
 * in by the loader, so it is fully isolated from the host page's CSS. The only light-DOM
 * pieces are the pins overlay and the host-element decorations (hover outline / target
 * highlight) — both are self-scoped via inline styles and never rely on host CSS.
 * Hit-testing across the shadow boundary uses event.composedPath(). */

import type { Comment, CommentSnapshot, WidgetConfig } from "./types";
import { NAME_KEY, MARKETING_URL, SHARE_TEXT, COACHMARK_KEY } from "./config";
import { computePageKey } from "./page-key";
import { getSelector, resolveAnchor, elementFromSelection } from "./selector";
import { addHoverOutline, removeHoverOutline, addHighlight, removeHighlight } from "./host-decor";
import { CommentStore } from "./supabase";

interface WidgetState {
  mode: boolean;
  comments: Comment[];
  hoverEl: Element | null;
  popover: HTMLElement | null;
  targetHighlight: Element | null;
  /** Element to restore keyboard focus to when a dialog (popover) closes. */
  returnFocus: HTMLElement | null;
}

// Inline style for the light-DOM pins overlay container (anchored at document origin).
const PINS_LAYER_CSS =
  "position:absolute!important;top:0!important;left:0!important;width:0!important;" +
  "height:0!important;margin:0!important;padding:0!important;border:0!important;" +
  "pointer-events:none!important;z-index:8500!important;";

// Inline style for an individual pin (resists host button/* rules via !important).
const PIN_CSS =
  "position:absolute!important;transform:translate(-50%,-50%)!important;" +
  "box-sizing:border-box!important;width:1.8rem!important;height:1.8rem!important;" +
  "min-width:0!important;margin:0!important;padding:0!important;" +
  "border:2px solid #fff!important;border-radius:50% 50% 50% 0!important;" +
  "background:#00267f!important;color:#fff!important;" +
  "font:700 0.8125rem/1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif!important;" +
  "display:flex!important;align-items:center!important;justify-content:center!important;" +
  "cursor:pointer!important;pointer-events:auto!important;text-transform:none!important;" +
  "letter-spacing:normal!important;box-shadow:0 2px 5px rgba(0,0,0,.3)!important;";

/** Boot the annotation widget for a given site + page, rendering UI into `root`
 *  (the widget's shadow root). Returns a teardown function. */
export function init(config: WidgetConfig, root: ShadowRoot): () => void {
  const pageKey = computePageKey(config.pageId);
  const uiHost = root.host; // the light-DOM element hosting the shadow tree

  const state: WidgetState = {
    mode: false,
    comments: [],
    hoverEl: null,
    popover: null,
    targetHighlight: null,
    returnFocus: null,
  };

  // Coarse pointer / no hover (phones, tablets): switch to a touch-first commenting
  // flow — tap-to-pin with a confirm step and a bottom-sheet composer — since hover
  // outlines and precise element-clicking don't translate to touch.
  const isCoarse =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(hover: none), (pointer: coarse)").matches;

  // ---- small helpers -------------------------------------------------

  function esc(str: unknown): string {
    const d = document.createElement("div");
    d.textContent = str == null ? "" : String(str);
    return d.innerHTML;
  }

  function formatTime(ts: number): string {
    if (!ts) return "";
    return new Date(ts).toLocaleString();
  }

  /** Replies to a given comment id, oldest first. */
  function repliesOf(parentId: string): Comment[] {
    return state.comments
      .filter((c) => c.parentId === parentId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Capture what the anchored spot looks like right now, so the feedback keeps its
   *  original context even if the page is later redesigned. Best-effort; never throws. */
  function captureSnapshot(el: Element | null, quote: string): CommentSnapshot | null {
    try {
      const rect = el ? el.getBoundingClientRect() : null;
      const text = (quote || (el && el.textContent) || "")
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 600);
      return {
        url: location.href,
        title: document.title,
        tag: el ? el.tagName.toLowerCase() : null,
        context: text || null,
        viewport: { w: window.innerWidth, h: window.innerHeight },
        rect: rect
          ? {
              top: Math.round(rect.top + window.scrollY),
              left: Math.round(rect.left + window.scrollX),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          : { top: null, left: null, width: null, height: null },
      };
    } catch {
      return null;
    }
  }

  /** True if the event originated within the widget's own UI (shadow tree or pins). */
  function eventInWidget(e: Event): boolean {
    const path = e.composedPath();
    return path.includes(uiHost) || path.includes(pins);
  }

  // ---- toolbar -------------------------------------------------------

  const toolbar = document.createElement("div");
  toolbar.className = "cmt-toolbar";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "cmt-btn";
  addBtn.setAttribute("aria-pressed", "false");
  addBtn.textContent = "Add comment";

  const panelBtn = document.createElement("button");
  panelBtn.type = "button";
  panelBtn.className = "cmt-btn";
  panelBtn.innerHTML = 'Comments <span class="cmt-btn__count">0</span>';

  toolbar.appendChild(addBtn);
  toolbar.appendChild(panelBtn);
  root.appendChild(toolbar);

  const countEl = panelBtn.querySelector(".cmt-btn__count") as HTMLElement;

  function updateCount(): void {
    // Pins/badge count top-level comments only; replies are nested under them.
    countEl.textContent = String(state.comments.filter((c) => !c.parentId).length);
  }

  addBtn.addEventListener("click", () => setMode(!state.mode));

  // ---- live data feed ------------------------------------------------

  const store = new CommentStore(config.siteId, pageKey, (comments) => {
    state.comments = comments;
    updateCount();
    renderPins();
    if (panel.classList.contains("is-open")) renderPanel();
    if (state.popover && state.popover.dataset.kind === "thread") {
      const body = state.popover.querySelector(".cmt-popover__body") as HTMLElement | null;
      if (body) renderThreadBody(body, state.popover.dataset.selector || "");
    }
  });

  // ---- pins overlay (light DOM, inline-styled) -----------------------

  const pins = document.createElement("div");
  pins.style.cssText = PINS_LAYER_CSS;
  document.body.appendChild(pins);

  // Pins and panel groups are keyed by selector and built from TOP-LEVEL comments
  // only; replies are pulled in via repliesOf() where each comment is rendered.
  function groupedBySelector(): Record<string, Comment[]> {
    const groups: Record<string, Comment[]> = {};
    state.comments
      .filter((c) => !c.parentId)
      .forEach((c) => {
        (groups[c.selector] = groups[c.selector] || []).push(c);
      });
    return groups;
  }

  // Resolve a comment group's anchor (CSS selector + quote fallback), never matching
  // the widget's own UI. Returns null when the comment can no longer be placed on the
  // page — the caller then surfaces it as "orphaned" rather than dropping it.
  function resolveGroup(selector: string, quote?: string): Element | null {
    return resolveAnchor(selector, quote, [uiHost, pins]);
  }

  function renderPins(): void {
    pins.innerHTML = "";
    const groups = groupedBySelector();
    Object.keys(groups).forEach((selector) => {
      const el = resolveGroup(selector, groups[selector][0].quote);
      if (!el) return; // unresolved → shown as orphaned in the panel, never lost
      const rect = el.getBoundingClientRect();
      const pin = document.createElement("button");
      pin.type = "button";
      pin.style.cssText = PIN_CSS;
      pin.style.setProperty("left", rect.right + window.scrollX + "px", "important");
      pin.style.setProperty("top", rect.top + window.scrollY + "px", "important");
      pin.textContent = String(groups[selector].length);
      pin.addEventListener("click", (e) => {
        e.stopPropagation();
        openThread(selector, pin);
      });
      pins.appendChild(pin);
    });
  }

  let rafPending = false;
  function scheduleReposition(): void {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderPins();
    });
  }
  window.addEventListener("scroll", scheduleReposition, true);
  window.addEventListener("resize", scheduleReposition);

  // ---- comment-placing mode -----------------------------------------

  function setMode(on: boolean): void {
    state.mode = on;
    addBtn.setAttribute("aria-pressed", String(on));
    // Crosshair only makes sense with a precise pointer; touch uses tap-to-pin.
    document.body.style.cursor = on && !isCoarse ? "crosshair" : "";
    clearHover();
    hideConfirm();
    if (on) {
      dismissCoachmark();
      if (isCoarse) {
        showHint("Tap any part of the page to comment. Press Esc to cancel.");
        document.addEventListener("click", onTapTarget, true);
      } else {
        showHint(
          "Click any element (or select text) to comment — or use ↑/↓ then Enter. Esc to cancel."
        );
        document.addEventListener("mousemove", onHoverMove, true);
        document.addEventListener("click", onPlaceClick, true);
        document.addEventListener("keydown", onModeKey, true);
        kbStart();
      }
    } else {
      hideHint();
      document.removeEventListener("mousemove", onHoverMove, true);
      document.removeEventListener("click", onPlaceClick, true);
      document.removeEventListener("click", onTapTarget, true);
      document.removeEventListener("keydown", onModeKey, true);
    }
  }

  function onHoverMove(e: MouseEvent): void {
    if (eventInWidget(e)) {
      clearHover();
      return;
    }
    const el = e.composedPath()[0] as Element | undefined;
    if (!el || el.nodeType !== 1) {
      clearHover();
      return;
    }
    if (el === state.hoverEl) return;
    clearHover();
    state.hoverEl = el;
    addHoverOutline(el);
  }

  function clearHover(): void {
    if (state.hoverEl) {
      removeHoverOutline(state.hoverEl);
      state.hoverEl = null;
    }
  }

  /** Anchor a comment to a chosen element and open the composer. Shared by mouse click,
   *  keyboard Enter, and the touch confirm step so all three paths behave identically. */
  function commitTarget(targetEl: Element, quote: string, x: number, y: number): void {
    const selector = getSelector(targetEl);
    const snapshot = captureSnapshot(targetEl, quote);
    clearHover();
    setMode(false);
    openComposer(selector || "", quote, x, y, { snapshot });
  }

  function onPlaceClick(e: MouseEvent): void {
    if (eventInWidget(e)) return;
    e.preventDefault();
    e.stopPropagation();

    const sel = window.getSelection();
    let quote = "";
    let targetEl: Element | null;

    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      quote = sel.toString().trim();
      targetEl = elementFromSelection(sel);
    } else {
      targetEl = (e.composedPath()[0] as Element) ?? (e.target as Element);
    }
    if (!targetEl) return;
    commitTarget(targetEl, quote, e.pageX, e.pageY);
  }

  // ---- keyboard target selection (A2) --------------------------------
  // In comment mode a keyboard user can step across page content with ↑/↓ (←/→) and
  // press Enter to comment on the focused element — no mouse required. We never mutate
  // host tabindex; we drive a roving outline over a snapshot of candidate elements.
  let kbTargets: Element[] = [];
  let kbIndex = -1;

  function kbCandidates(): Element[] {
    const sel =
      "h1,h2,h3,h4,h5,h6,p,li,blockquote,figure,img,button,a,pre,td,th,label,summary";
    return Array.from(document.body.querySelectorAll(sel)).filter((el) => {
      if (uiHost.contains(el) || pins.contains(el)) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== "hidden" && cs.display !== "none";
    });
  }

  function kbStart(): void {
    kbTargets = kbCandidates();
    kbIndex = kbTargets.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.top < window.innerHeight;
    });
    if (kbIndex < 0) kbIndex = 0;
    kbFocus();
  }

  function kbMove(dir: number): void {
    if (!kbTargets.length) kbTargets = kbCandidates();
    if (!kbTargets.length) return;
    kbIndex = (kbIndex + dir + kbTargets.length) % kbTargets.length;
    kbFocus();
  }

  function kbFocus(): void {
    const el = kbTargets[kbIndex];
    if (!el) return;
    clearHover();
    state.hoverEl = el;
    addHoverOutline(el);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function onModeKey(e: KeyboardEvent): void {
    if (!state.mode) return;
    const k = e.key;
    if (k === "ArrowDown" || k === "ArrowRight") {
      e.preventDefault();
      kbMove(1);
    } else if (k === "ArrowUp" || k === "ArrowLeft") {
      e.preventDefault();
      kbMove(-1);
    } else if (k === "Enter" && state.hoverEl) {
      e.preventDefault();
      const el = state.hoverEl;
      const r = el.getBoundingClientRect();
      commitTarget(el, "", r.left + window.scrollX, r.bottom + window.scrollY);
    }
  }

  // ---- touch tap-to-pin + confirm (S1) -------------------------------
  let confirmBar: HTMLElement | null = null;

  function onTapTarget(e: MouseEvent): void {
    if (eventInWidget(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const sel = window.getSelection();
    let quote = "";
    let el: Element | null;
    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      quote = sel.toString().trim();
      el = elementFromSelection(sel);
    } else {
      el = (e.composedPath()[0] as Element) ?? (e.target as Element);
    }
    if (!el) return;
    clearHover();
    state.hoverEl = el;
    addHoverOutline(el);
    showConfirm(el, quote);
  }

  function showConfirm(el: Element, quote: string): void {
    hideConfirm();
    hideHint();
    confirmBar = document.createElement("div");
    confirmBar.className = "cmt-confirm";
    confirmBar.setAttribute("role", "dialog");
    confirmBar.setAttribute("aria-label", "Confirm comment location");
    const label = quote
      ? "“" + (quote.length > 40 ? quote.slice(0, 40).trimEnd() + "…" : quote) + "”"
      : "this " + el.tagName.toLowerCase();
    confirmBar.innerHTML =
      '<span class="cmt-confirm__txt">Comment on ' + esc(label) + "?</span>" +
      '<span class="cmt-confirm__actions">' +
      '<button type="button" class="cmt-action cmt-action--secondary cmt-confirm__again">Pick another</button>' +
      '<button type="button" class="cmt-action cmt-action--primary cmt-confirm__ok">Comment here</button>' +
      "</span>";
    root.appendChild(confirmBar);
    (confirmBar.querySelector(".cmt-confirm__ok") as HTMLElement).addEventListener("click", () => {
      const r = el.getBoundingClientRect();
      hideConfirm();
      commitTarget(el, quote, r.left + window.scrollX, r.bottom + window.scrollY);
    });
    (confirmBar.querySelector(".cmt-confirm__again") as HTMLElement).addEventListener(
      "click",
      () => {
        clearHover();
        hideConfirm();
        if (state.mode) showHint("Tap any part of the page to comment. Press Esc to cancel.");
      }
    );
    (confirmBar.querySelector(".cmt-confirm__ok") as HTMLElement).focus();
  }

  function hideConfirm(): void {
    if (confirmBar) {
      confirmBar.remove();
      confirmBar = null;
    }
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.popover) closePopover(true);
    else if (confirmBar) {
      clearHover();
      hideConfirm();
      if (state.mode) showHint("Tap any part of the page to comment. Press Esc to cancel.");
    } else if (state.mode) setMode(false);
  });

  // ---- popover plumbing ----------------------------------------------

  /** Close the active popover. When `restore` is set (user-initiated close via Esc,
   *  the close button, or Cancel) move focus back to the element that opened it, so
   *  keyboard users aren't dropped at the top of the page. */
  function closePopover(restore = false): void {
    const rf = state.returnFocus;
    state.returnFocus = null;
    if (state.popover) {
      state.popover.remove();
      state.popover = null;
    }
    if (state.targetHighlight) {
      removeHighlight(state.targetHighlight);
      state.targetHighlight = null;
    }
    if (restore) {
      if (rf && rf.isConnected) rf.focus();
      else addBtn.focus();
    }
  }

  function placePopover(pop: HTMLElement, x: number, y: number): void {
    root.appendChild(pop);
    // Touch: render as a bottom sheet pinned to the viewport (positioned purely by CSS).
    // This keeps the composer reachable above the on-screen keyboard and avoids precise
    // coordinate math that doesn't translate to small screens.
    if (isCoarse) {
      pop.classList.add("cmt-popover--sheet");
      return;
    }
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    const left = Math.min(x, window.scrollX + document.documentElement.clientWidth - w - 8);
    let top = y + 12;
    if (top + h > window.scrollY + document.documentElement.clientHeight) {
      top = Math.max(window.scrollY + 8, y - h - 12);
    }
    pop.style.left = Math.max(window.scrollX + 8, left) + "px";
    pop.style.top = top + "px";
  }

  /** Trap Tab focus within an open dialog popover so keyboard users can't escape it
   *  into the host page behind the modal. The listener dies with the popover on close. */
  function trapFocus(pop: HTMLElement): void {
    pop.addEventListener("keydown", (e) => {
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        pop.querySelectorAll<HTMLElement>(
          'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !(el as HTMLButtonElement).disabled && el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = root.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  /** Record the element to return focus to when the about-to-open dialog closes. */
  function captureReturnFocus(): void {
    const active = document.activeElement;
    state.returnFocus =
      active instanceof HTMLElement && active !== document.body ? active : addBtn;
  }

  function highlightTarget(selector: string, quote?: string): Element | null {
    const el = resolveGroup(selector, quote);
    if (el) {
      addHighlight(el);
      state.targetHighlight = el;
    }
    return el;
  }

  document.addEventListener("mousedown", (e) => {
    if (!state.popover) return;
    const path = e.composedPath();
    if (path.includes(state.popover)) return; // click inside the popover
    if (path.includes(pins)) return; // a pin manages its own open/close
    closePopover();
  });

  // ---- composer (new comment) ----------------------------------------

  function openComposer(
    selector: string,
    quote: string,
    x?: number,
    y?: number,
    opts?: { parentId?: string | null; snapshot?: CommentSnapshot | null }
  ): void {
    const parentId = opts?.parentId ?? null;
    const snapshot = opts?.snapshot ?? null;
    captureReturnFocus();
    closePopover();
    const el = highlightTarget(selector, quote);
    if (el && !x) {
      const r = el.getBoundingClientRect();
      x = r.left + window.scrollX;
      y = r.bottom + window.scrollY;
    }

    const savedName = localStorage.getItem(NAME_KEY) || "";
    const titleId = "cmt-title-" + Math.random().toString(36).slice(2, 8);
    const pop = document.createElement("div");
    pop.className = "cmt-popover";
    pop.dataset.kind = "composer";
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "true");
    pop.setAttribute("aria-labelledby", titleId);
    pop.innerHTML =
      '<div class="cmt-popover__head"><span id="' + titleId + '">' +
      (parentId ? "Write a reply" : "Add a comment") +
      "</span>" +
      '<button type="button" class="cmt-close" aria-label="Close">&times;</button></div>' +
      '<div class="cmt-popover__body">' +
      (quote ? '<div class="cmt-quote">' + esc(quote) + "</div>" : "") +
      '<div class="cmt-field"><label>Your name</label>' +
      '<input type="text" class="cmt-name" value="' + esc(savedName) + '" placeholder="e.g. Jane"></div>' +
      '<div class="cmt-field"><label>Comment</label>' +
      '<textarea class="cmt-text" placeholder="Write your comment"></textarea></div>' +
      '<div class="cmt-status" role="status" aria-live="polite"></div>' +
      '<div class="cmt-actions">' +
      '<button type="button" class="cmt-action cmt-action--secondary cmt-cancel">Cancel</button>' +
      '<button type="button" class="cmt-action cmt-action--primary cmt-save">Save</button>' +
      "</div></div>";

    state.popover = pop;
    placePopover(pop, x || 0, y || 0);
    trapFocus(pop);

    const nameInput = pop.querySelector(".cmt-name") as HTMLInputElement;
    const textInput = pop.querySelector(".cmt-text") as HTMLTextAreaElement;
    const saveBtn = pop.querySelector(".cmt-save") as HTMLButtonElement;
    const statusEl = pop.querySelector(".cmt-status") as HTMLElement;
    (savedName ? textInput : nameInput).focus();

    function setStatus(msg: string, isError: boolean): void {
      statusEl.textContent = msg;
      statusEl.classList.toggle("cmt-status--error", isError);
    }

    (pop.querySelector(".cmt-close") as HTMLElement).addEventListener("click", () =>
      closePopover(true)
    );
    (pop.querySelector(".cmt-cancel") as HTMLElement).addEventListener("click", () =>
      closePopover(true)
    );
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const text = textInput.value.trim();
      if (!name) {
        setStatus("Please add your name.", true);
        nameInput.focus();
        return;
      }
      if (!text) {
        setStatus("Please write a comment.", true);
        textInput.focus();
        return;
      }
      setStatus("", false);
      localStorage.setItem(NAME_KEY, name);
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        const { status } = await store.add({ selector, quote, name, text, parentId, snapshot });
        closePopover();
        if (status === "pending") {
          showHint("Thanks! Your comment was submitted and is awaiting review.");
          window.setTimeout(hideHint, 5000);
        }
      } catch (err) {
        console.error("[commentbox] save failed", err);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        const code = (err as { code?: string }).code;
        if (code === "rate_limited") {
          setStatus("You're commenting a bit too quickly — please wait a moment.", true);
        } else {
          setStatus("Could not save your comment. Please try again.", true);
        }
      }
    });
  }

  // ---- thread (existing comments on an element) ----------------------

  function openThread(selector: string, anchorEl: HTMLElement): void {
    captureReturnFocus();
    closePopover();
    const groupQuote = state.comments.find((c) => c.selector === selector)?.quote;
    highlightTarget(selector, groupQuote);
    const rect = anchorEl.getBoundingClientRect();
    const titleId = "cmt-title-" + Math.random().toString(36).slice(2, 8);
    const pop = document.createElement("div");
    pop.className = "cmt-popover";
    pop.dataset.kind = "thread";
    pop.dataset.selector = selector;
    pop.setAttribute("role", "dialog");
    pop.setAttribute("aria-modal", "true");
    pop.setAttribute("aria-labelledby", titleId);
    pop.innerHTML =
      '<div class="cmt-popover__head"><span id="' + titleId + '">Comments</span>' +
      '<button type="button" class="cmt-close" aria-label="Close">&times;</button></div>' +
      '<div class="cmt-popover__body"></div>';
    state.popover = pop;
    renderThreadBody(pop.querySelector(".cmt-popover__body") as HTMLElement, selector);
    placePopover(pop, rect.right + window.scrollX, rect.top + window.scrollY);
    trapFocus(pop);
    const closeBtn = pop.querySelector(".cmt-close") as HTMLElement;
    closeBtn.addEventListener("click", () => closePopover(true));
    closeBtn.focus();
  }

  /** Up-to-two-letter initials for an avatar (first + last word, else first two chars). */
  function initials(name: string): string {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }

  /** Contrast ratio of a color against white text, per WCAG relative-luminance formula. */
  function contrastWithWhite([r, g, b]: [number, number, number]): number {
    const lum = [r, g, b]
      .map((v) => v / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    const L = 0.2126 * lum[0] + 0.7152 * lum[1] + 0.0722 * lum[2];
    return 1.05 / (L + 0.05); // white luminance is 1.0
  }

  /** Deterministic avatar color from the name (same person → same hue). Lightness is
   *  reduced until white text meets WCAG AA (≥4.5:1), so the initials stay legible on
   *  every hue (yellow/cyan would otherwise be too light at a fixed lightness). */
  function avatarColor(name: string): string {
    let h = 0;
    for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
    let l = 42;
    while (l > 18 && contrastWithWhite(hslToRgb(h, 52, l)) < 4.5) l -= 3;
    return "hsl(" + h + ", 52%, " + l + "%)";
  }

  /** Shared comment renderer: avatar + (name / time) header + body text. Used for both
   *  top-level comments and replies, in the thread popover and the side panel. */
  function commentInnerHtml(c: Comment): string {
    const name = c.name || "Anonymous";
    return (
      '<div class="cmt-c__head">' +
      '<span class="cmt-c__avatar" style="background:' +
      avatarColor(name) +
      '">' +
      esc(initials(name)) +
      "</span>" +
      '<span class="cmt-c__author">' +
      esc(name) +
      "</span>" +
      '<span class="cmt-c__time">' +
      esc(formatTime(c.createdAt)) +
      "</span></div>" +
      '<div class="cmt-c__text">' +
      esc(c.text) +
      "</div>"
    );
  }

  function renderThreadBody(body: HTMLElement, selector: string): void {
    // Top-level comments on this element; replies are nested under each one.
    const items = state.comments.filter((c) => c.selector === selector && !c.parentId);
    const quote = items[0] && items[0].quote;
    body.innerHTML = quote ? '<div class="cmt-quote">' + esc(quote) + "</div>" : "";

    if (!items.length) {
      body.innerHTML += '<p class="cmt-empty">This comment was removed.</p>';
      return;
    }

    items.forEach((c) => {
      const item = document.createElement("div");
      item.className = "cmt-item";
      item.innerHTML = commentInnerHtml(c);

      // Nested replies, oldest first.
      repliesOf(c.id).forEach((r) => {
        const reply = document.createElement("div");
        reply.className = "cmt-reply";
        reply.innerHTML = commentInnerHtml(r);
        item.appendChild(reply);
      });

      // Per-comment reply affordance (Disqus-style conversation).
      const replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "cmt-reply-btn";
      replyBtn.textContent = "↳ Reply";
      replyBtn.addEventListener("click", () => {
        const el = resolveGroup(selector, quote || "");
        let x: number | undefined;
        let y: number | undefined;
        if (el) {
          const r = el.getBoundingClientRect();
          x = r.left + window.scrollX;
          y = r.bottom + window.scrollY;
        }
        // Replies reuse the parent's selector but carry no quote/snapshot of their own.
        openComposer(selector, "", x, y, { parentId: c.id });
      });
      item.appendChild(replyBtn);

      body.appendChild(item);
    });

    const addAnother = document.createElement("button");
    addAnother.type = "button";
    addAnother.className = "cmt-action cmt-add-another";
    addAnother.textContent = "+ Add another comment";
    addAnother.addEventListener("click", () => {
      const el = resolveGroup(selector, quote || "");
      let x: number | undefined;
      let y: number | undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left + window.scrollX;
        y = r.bottom + window.scrollY;
      }
      const snapshot = captureSnapshot(el, quote || "");
      openComposer(selector, quote || "", x, y, { snapshot });
    });
    body.appendChild(addAnother);
  }

  // ---- side panel (all comments) -------------------------------------

  const panel = document.createElement("aside");
  panel.className = "cmt-panel";
  panel.setAttribute("aria-label", "All comments on this page");
  panel.innerHTML =
    '<div class="cmt-panel__head"><span>Comments on this page</span>' +
    '<button type="button" class="cmt-close" aria-label="Close panel">&times;</button></div>' +
    '<div class="cmt-panel__body"></div>' +
    // Growth loop: a visitor who likes leaving feedback here can add the widget to
    // their own site or share it with someone who needs it. Kept low-key so it reads
    // as attribution, not an ad.
    '<div class="cmt-panel__foot">' +
    '<a class="cmt-powered" href="' +
    MARKETING_URL +
    '" target="_blank" rel="noopener">Powered by <strong>commentbox</strong></a>' +
    '<span class="cmt-powered__actions">' +
    '<a class="cmt-cta" href="' +
    MARKETING_URL +
    '" target="_blank" rel="noopener">Add to your site →</a>' +
    '<button type="button" class="cmt-share">Share</button>' +
    "</span></div>";
  root.appendChild(panel);
  (panel.querySelector(".cmt-close") as HTMLElement).addEventListener("click", () => {
    panel.classList.remove("is-open");
  });

  // Share: native share sheet where available (mobile especially), otherwise copy the
  // landing link to the clipboard and briefly confirm on the button itself.
  const shareBtn = panel.querySelector(".cmt-share") as HTMLButtonElement;
  shareBtn.addEventListener("click", async () => {
    const shareData = {
      title: "commentbox",
      text: SHARE_TEXT,
      url: MARKETING_URL,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // user dismissed the share sheet — nothing to do
      return;
    }
    try {
      await navigator.clipboard.writeText(MARKETING_URL);
      const prev = shareBtn.textContent;
      shareBtn.textContent = "Link copied ✓";
      shareBtn.disabled = true;
      setTimeout(() => {
        shareBtn.textContent = prev;
        shareBtn.disabled = false;
      }, 1800);
    } catch {
      window.open(MARKETING_URL, "_blank", "noopener");
    }
  });

  panelBtn.addEventListener("click", () => {
    panel.classList.toggle("is-open");
    if (panel.classList.contains("is-open")) renderPanel();
  });

  function buildPanelGroup(selector: string, items: Comment[], located: Element | null): HTMLElement {
    const quote = items[0].quote;
    const group = document.createElement("div");
    group.className = "cmt-panel__group" + (located ? "" : " cmt-panel__group--orphan");
    let preview = quote || "";
    if (!preview && located) {
      const t = (located.textContent || "").trim();
      preview = t.length > 60 ? t.slice(0, 60).trimEnd() + "…" : t;
    }
    if (!preview) preview = "(no preview)";

    if (!located) {
      const tag = document.createElement("div");
      tag.className = "cmt-orphan-tag";
      tag.textContent = "Couldn’t locate on this page";
      group.appendChild(tag);
    }

    const previewEl = document.createElement("div");
    previewEl.className = "cmt-quote";
    previewEl.style.marginBottom = ".4rem";
    previewEl.textContent = preview;
    group.appendChild(previewEl);

    items.forEach((c, idx) => {
      if (idx > 0) {
        const sep = document.createElement("hr");
        sep.className = "cmt-sep";
        group.appendChild(sep);
      }
      const item = document.createElement("div");
      item.innerHTML = commentInnerHtml(c);

      repliesOf(c.id).forEach((r) => {
        const reply = document.createElement("div");
        reply.className = "cmt-reply";
        reply.innerHTML = commentInnerHtml(r);
        item.appendChild(reply);
      });

      // Reply straight from the side panel (only for locatable comments — the
      // composer needs to anchor/highlight the element it's attached to).
      if (located) {
        const replyBtn = document.createElement("button");
        replyBtn.type = "button";
        replyBtn.className = "cmt-reply-btn";
        replyBtn.textContent = "↳ Reply";
        replyBtn.addEventListener("click", (e) => {
          e.stopPropagation(); // don't trigger the group's scroll-to-element
          const el = resolveGroup(selector, quote);
          let x: number | undefined;
          let y: number | undefined;
          if (el) {
            const r = el.getBoundingClientRect();
            x = r.left + window.scrollX;
            y = r.bottom + window.scrollY;
          }
          openComposer(selector, "", x, y, { parentId: c.id });
        });
        item.appendChild(replyBtn);
      }

      group.appendChild(item);
    });

    // Only located groups scroll-to-element on click; orphaned ones are display-only
    // (their full text is shown inline above, so the comment is never lost).
    if (located) {
      group.addEventListener("click", () => {
        const el = resolveGroup(selector, quote);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          addHighlight(el);
          state.targetHighlight = el;
          setTimeout(() => {
            if (state.targetHighlight === el) {
              removeHighlight(el);
              state.targetHighlight = null;
            }
          }, 1600);
        }
      });
    }
    return group;
  }

  function renderPanel(): void {
    const body = panel.querySelector(".cmt-panel__body") as HTMLElement;
    body.innerHTML = "";
    if (!state.comments.length) {
      body.innerHTML =
        '<p class="cmt-empty">No comments yet. Click “Add comment”, then select text or a component.</p>';
      return;
    }
    const groups = groupedBySelector();
    const located: string[] = [];
    const orphaned: string[] = [];
    const resolved: Record<string, Element | null> = {};
    Object.keys(groups).forEach((selector) => {
      const el = resolveGroup(selector, groups[selector][0].quote);
      resolved[selector] = el;
      (el ? located : orphaned).push(selector);
    });

    located.forEach((selector) =>
      body.appendChild(buildPanelGroup(selector, groups[selector], resolved[selector]))
    );

    if (orphaned.length) {
      const header = document.createElement("div");
      header.className = "cmt-panel__section";
      header.innerHTML =
        '<span class="cmt-panel__section-title">Not on this page</span>' +
        '<span class="cmt-panel__section-note">The page changed, so ' +
        (orphaned.length === 1 ? "this comment" : "these comments") +
        " couldn’t be placed. Nothing was lost.</span>";
      body.appendChild(header);
      orphaned.forEach((selector) =>
        body.appendChild(buildPanelGroup(selector, groups[selector], null))
      );
    }
  }

  // ---- hint banner ----------------------------------------------------

  let hint: HTMLElement | null = null;
  function showHint(msg: string): void {
    hideHint();
    hint = document.createElement("div");
    hint.className = "cmt-hint";
    hint.textContent = msg;
    root.appendChild(hint);
  }
  function hideHint(): void {
    if (hint) {
      hint.remove();
      hint = null;
    }
  }

  // ---- first-run coachmark (S4) --------------------------------------
  // A one-time callout so a first-time visitor understands that "Add comment" attaches
  // feedback to the page. Shown once per visitor (localStorage), dismissed on "Got it"
  // or as soon as they enter comment mode.
  let coach: HTMLElement | null = null;
  function maybeCoachmark(): void {
    try {
      if (localStorage.getItem(COACHMARK_KEY)) return;
    } catch {
      return;
    }
    coach = document.createElement("div");
    coach.className = "cmt-coach";
    coach.setAttribute("role", "note");
    coach.innerHTML =
      '<p class="cmt-coach__txt">New here? Press <strong>Add comment</strong>, then ' +
      (isCoarse ? "tap" : "click") +
      " any part of the page to leave feedback.</p>" +
      '<button type="button" class="cmt-action cmt-action--primary cmt-coach__ok">Got it</button>';
    root.appendChild(coach);
    (coach.querySelector(".cmt-coach__ok") as HTMLElement).addEventListener(
      "click",
      dismissCoachmark
    );
  }
  function dismissCoachmark(): void {
    if (coach) {
      coach.remove();
      coach = null;
    }
    try {
      localStorage.setItem(COACHMARK_KEY, "1");
    } catch {
      /* private mode — fine, it'll just show again next visit */
    }
  }

  // ---- init -----------------------------------------------------------

  updateCount();
  renderPins();
  maybeCoachmark();
  void store.subscribe();

  // ---- teardown -------------------------------------------------------

  return function destroy(): void {
    setMode(false);
    closePopover();
    hideHint();
    hideConfirm();
    if (coach) coach.remove();
    store.dispose();
    window.removeEventListener("scroll", scheduleReposition, true);
    window.removeEventListener("resize", scheduleReposition);
    toolbar.remove();
    pins.remove();
    panel.remove();
  };
}
