/* commentbox annotation core.
 * Reviewers select text or click a component to attach a named comment. Comments are
 * stored centrally and sync in real time, so everyone on the page sees the same set.
 *
 * This is the original `comments.js` logic refactored into a single `init()` entry
 * point with NO module-level state or implicit globals — everything lives inside the
 * call. Behavior and UX are unchanged from the original. (Shadow-DOM isolation and the
 * single-file bundle land in Phase 2.) */

import type { Comment, WidgetConfig } from "./types";
import { NAME_KEY } from "./config";
import { computePageKey } from "./page-key";
import { getSelector, resolveTarget, elementFromSelection } from "./selector";
import { CommentStore } from "./supabase";

interface WidgetState {
  mode: boolean;
  comments: Comment[];
  hoverEl: Element | null;
  popover: HTMLElement | null;
  targetHighlight: Element | null;
}

/** Boot the annotation widget for a given site + page. Returns a teardown function. */
export function init(config: WidgetConfig): () => void {
  const pageKey = computePageKey(config.pageId);

  const state: WidgetState = {
    mode: false,
    comments: [],
    hoverEl: null,
    popover: null,
    targetHighlight: null,
  };

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

  function isOwnUi(el: Element | null): Element | null {
    return el ? el.closest(".cmt-toolbar, .cmt-popover, .cmt-pins, .cmt-panel, .cmt-hint") : null;
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
  document.body.appendChild(toolbar);

  const countEl = panelBtn.querySelector(".cmt-btn__count") as HTMLElement;

  function updateCount(): void {
    countEl.textContent = String(state.comments.length);
  }

  addBtn.addEventListener("click", () => setMode(!state.mode));

  // ---- live data feed ------------------------------------------------

  const store = new CommentStore(pageKey, (comments) => {
    state.comments = comments;
    updateCount();
    renderPins();
    if (panel.classList.contains("is-open")) renderPanel();
    if (state.popover && state.popover.dataset.kind === "thread") {
      const body = state.popover.querySelector(".cmt-popover__body") as HTMLElement | null;
      if (body) renderThreadBody(body, state.popover.dataset.selector || "");
    }
  });

  // ---- pins overlay --------------------------------------------------

  const pins = document.createElement("div");
  pins.className = "cmt-pins";
  document.body.appendChild(pins);

  function groupedBySelector(): Record<string, Comment[]> {
    const groups: Record<string, Comment[]> = {};
    state.comments.forEach((c) => {
      (groups[c.selector] = groups[c.selector] || []).push(c);
    });
    return groups;
  }

  function renderPins(): void {
    pins.innerHTML = "";
    const groups = groupedBySelector();
    Object.keys(groups).forEach((selector) => {
      const el = resolveTarget(selector);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "cmt-pin";
      pin.textContent = String(groups[selector].length);
      pin.style.left = rect.right + window.scrollX + "px";
      pin.style.top = rect.top + window.scrollY + "px";
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
    document.body.classList.toggle("cmt-mode", on);
    clearHover();
    if (on) {
      showHint("Select text or click any element to comment. Press Esc to cancel.");
      document.addEventListener("mousemove", onHoverMove, true);
      document.addEventListener("click", onPlaceClick, true);
    } else {
      hideHint();
      document.removeEventListener("mousemove", onHoverMove, true);
      document.removeEventListener("click", onPlaceClick, true);
    }
  }

  function onHoverMove(e: MouseEvent): void {
    const el = e.target as Element | null;
    if (!el || isOwnUi(el)) {
      clearHover();
      return;
    }
    if (el === state.hoverEl) return;
    clearHover();
    state.hoverEl = el;
    el.classList.add("cmt-hover-outline");
  }

  function clearHover(): void {
    if (state.hoverEl) {
      state.hoverEl.classList.remove("cmt-hover-outline");
      state.hoverEl = null;
    }
  }

  function onPlaceClick(e: MouseEvent): void {
    if (isOwnUi(e.target as Element)) return;
    e.preventDefault();
    e.stopPropagation();

    const sel = window.getSelection();
    let quote = "";
    let targetEl: Element | null;

    if (sel && !sel.isCollapsed && sel.toString().trim()) {
      quote = sel.toString().trim();
      targetEl = elementFromSelection(sel);
    } else {
      targetEl = e.target as Element;
    }
    if (isOwnUi(targetEl)) return;

    const selector = getSelector(targetEl);
    clearHover();
    setMode(false);
    openComposer(selector || "", quote, e.pageX, e.pageY);
  }

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.popover) closePopover();
    else if (state.mode) setMode(false);
  });

  // ---- popover plumbing ----------------------------------------------

  function closePopover(): void {
    if (state.popover) {
      state.popover.remove();
      state.popover = null;
    }
    if (state.targetHighlight) {
      state.targetHighlight.classList.remove("cmt-target-highlight");
      state.targetHighlight = null;
    }
  }

  function placePopover(pop: HTMLElement, x: number, y: number): void {
    document.body.appendChild(pop);
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    let left = Math.min(x, window.scrollX + document.documentElement.clientWidth - w - 8);
    let top = y + 12;
    if (top + h > window.scrollY + document.documentElement.clientHeight) {
      top = Math.max(window.scrollY + 8, y - h - 12);
    }
    pop.style.left = Math.max(window.scrollX + 8, left) + "px";
    pop.style.top = top + "px";
  }

  function highlightTarget(selector: string): Element | null {
    const el = resolveTarget(selector);
    if (el) {
      el.classList.add("cmt-target-highlight");
      state.targetHighlight = el;
    }
    return el;
  }

  document.addEventListener("mousedown", (e) => {
    const target = e.target as Element;
    if (state.popover && !state.popover.contains(target) && !target.closest(".cmt-pin")) {
      closePopover();
    }
  });

  // ---- composer (new comment) ----------------------------------------

  function openComposer(selector: string, quote: string, x?: number, y?: number): void {
    closePopover();
    const el = highlightTarget(selector);
    if (el && !x) {
      const r = el.getBoundingClientRect();
      x = r.left + window.scrollX;
      y = r.bottom + window.scrollY;
    }

    const savedName = localStorage.getItem(NAME_KEY) || "";
    const pop = document.createElement("div");
    pop.className = "cmt-popover";
    pop.dataset.kind = "composer";
    pop.innerHTML =
      '<div class="cmt-popover__head"><span>Add a comment</span>' +
      '<button type="button" class="cmt-close" aria-label="Close">&times;</button></div>' +
      '<div class="cmt-popover__body">' +
      (quote ? '<div class="cmt-quote">' + esc(quote) + "</div>" : "") +
      '<div class="cmt-field"><label>Your name</label>' +
      '<input type="text" class="cmt-name" value="' + esc(savedName) + '" placeholder="e.g. Jane"></div>' +
      '<div class="cmt-field"><label>Comment</label>' +
      '<textarea class="cmt-text" placeholder="Write your comment"></textarea></div>' +
      '<div class="cmt-actions">' +
      '<button type="button" class="cmt-action cmt-action--secondary cmt-cancel">Cancel</button>' +
      '<button type="button" class="cmt-action cmt-action--primary cmt-save">Save</button>' +
      "</div></div>";

    state.popover = pop;
    placePopover(pop, x || 0, y || 0);

    const nameInput = pop.querySelector(".cmt-name") as HTMLInputElement;
    const textInput = pop.querySelector(".cmt-text") as HTMLTextAreaElement;
    const saveBtn = pop.querySelector(".cmt-save") as HTMLButtonElement;
    (savedName ? textInput : nameInput).focus();

    (pop.querySelector(".cmt-close") as HTMLElement).addEventListener("click", closePopover);
    (pop.querySelector(".cmt-cancel") as HTMLElement).addEventListener("click", closePopover);
    saveBtn.addEventListener("click", async () => {
      const name = nameInput.value.trim();
      const text = textInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      if (!text) {
        textInput.focus();
        return;
      }
      localStorage.setItem(NAME_KEY, name);
      saveBtn.disabled = true;
      saveBtn.textContent = "Saving…";
      try {
        await store.add({ selector, quote, name, text });
        closePopover();
      } catch (err) {
        console.error("[commentbox] save failed", err);
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
        alert("Could not save your comment. Please try again.");
      }
    });
  }

  // ---- thread (existing comments on an element) ----------------------

  function openThread(selector: string, anchorEl: HTMLElement): void {
    closePopover();
    highlightTarget(selector);
    const rect = anchorEl.getBoundingClientRect();
    const pop = document.createElement("div");
    pop.className = "cmt-popover";
    pop.dataset.kind = "thread";
    pop.dataset.selector = selector;
    pop.innerHTML =
      '<div class="cmt-popover__head"><span>Comments</span>' +
      '<button type="button" class="cmt-close" aria-label="Close">&times;</button></div>' +
      '<div class="cmt-popover__body"></div>';
    state.popover = pop;
    renderThreadBody(pop.querySelector(".cmt-popover__body") as HTMLElement, selector);
    placePopover(pop, rect.right + window.scrollX, rect.top + window.scrollY);
    (pop.querySelector(".cmt-close") as HTMLElement).addEventListener("click", closePopover);
  }

  function renderThreadBody(body: HTMLElement, selector: string): void {
    const items = state.comments.filter((c) => c.selector === selector);
    const quote = items[0] && items[0].quote;
    body.innerHTML = quote ? '<div class="cmt-quote">' + esc(quote) + "</div>" : "";

    if (!items.length) {
      body.innerHTML += '<p class="cmt-empty">This comment was removed.</p>';
      return;
    }

    items.forEach((c) => {
      const item = document.createElement("div");
      item.className = "cmt-item";
      item.innerHTML =
        '<div class="cmt-item__meta"><span class="cmt-item__author">' +
        esc(c.name) +
        '</span><span class="cmt-item__time">' +
        esc(formatTime(c.createdAt)) +
        "</span></div>" +
        '<div class="cmt-item__text">' +
        esc(c.text) +
        "</div>";
      body.appendChild(item);
    });

    const addAnother = document.createElement("button");
    addAnother.type = "button";
    addAnother.className = "cmt-action cmt-action--secondary";
    addAnother.style.marginTop = ".6rem";
    addAnother.textContent = "Add another comment";
    addAnother.addEventListener("click", () => {
      const el = resolveTarget(selector);
      let x: number | undefined;
      let y: number | undefined;
      if (el) {
        const r = el.getBoundingClientRect();
        x = r.left + window.scrollX;
        y = r.bottom + window.scrollY;
      }
      openComposer(selector, quote || "", x, y);
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
    '<div class="cmt-panel__body"></div>';
  document.body.appendChild(panel);
  (panel.querySelector(".cmt-close") as HTMLElement).addEventListener("click", () => {
    panel.classList.remove("is-open");
  });

  panelBtn.addEventListener("click", () => {
    panel.classList.toggle("is-open");
    if (panel.classList.contains("is-open")) renderPanel();
  });

  function renderPanel(): void {
    const body = panel.querySelector(".cmt-panel__body") as HTMLElement;
    body.innerHTML = "";
    if (!state.comments.length) {
      body.innerHTML =
        '<p class="cmt-empty">No comments yet. Click “Add comment”, then select text or a component.</p>';
      return;
    }
    const groups = groupedBySelector();
    Object.keys(groups).forEach((selector) => {
      const items = groups[selector];
      const quote = items[0].quote;
      const group = document.createElement("div");
      group.className = "cmt-panel__group";
      const target = resolveTarget(selector);
      const preview = quote || (target ? (target.textContent || "").trim().slice(0, 60) : selector);
      group.innerHTML =
        '<div class="cmt-quote" style="margin-bottom:.4rem">' +
        esc(preview) +
        "</div>" +
        items
          .map(
            (c) =>
              '<div class="cmt-item__meta"><span class="cmt-item__author">' +
              esc(c.name) +
              '</span><span class="cmt-item__time">' +
              esc(formatTime(c.createdAt)) +
              "</span></div>" +
              '<div class="cmt-item__text">' +
              esc(c.text) +
              "</div>"
          )
          .join('<hr style="border:none;border-top:1px solid #eee;margin:.4rem 0">');
      group.addEventListener("click", () => {
        const el = resolveTarget(selector);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          highlightTarget(selector);
          setTimeout(() => {
            if (state.targetHighlight === el) {
              el.classList.remove("cmt-target-highlight");
              state.targetHighlight = null;
            }
          }, 1600);
        }
      });
      body.appendChild(group);
    });
  }

  // ---- hint banner ----------------------------------------------------

  let hint: HTMLElement | null = null;
  function showHint(msg: string): void {
    hideHint();
    hint = document.createElement("div");
    hint.className = "cmt-hint";
    hint.textContent = msg;
    document.body.appendChild(hint);
  }
  function hideHint(): void {
    if (hint) {
      hint.remove();
      hint = null;
    }
  }

  // ---- init -----------------------------------------------------------

  updateCount();
  renderPins();
  void store.subscribe();

  // ---- teardown -------------------------------------------------------

  return function destroy(): void {
    setMode(false);
    closePopover();
    hideHint();
    store.dispose();
    window.removeEventListener("scroll", scheduleReposition, true);
    window.removeEventListener("resize", scheduleReposition);
    toolbar.remove();
    pins.remove();
    panel.remove();
  };
}
