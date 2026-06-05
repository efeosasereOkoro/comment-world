// Element addressing. Generates a CSS-path selector for a commented element and
// resolves it back. Each comment carries TWO anchors — the CSS path and the quoted
// text — and {@link resolveAnchor} tries them in order so a comment survives DOM
// drift: exact selector → quote within the nearest surviving ancestor → quote
// anywhere. When every strategy fails the caller treats the comment as orphaned
// (shown in the panel) rather than dropping it, so no comment is ever lost.

/** Build a CSS-path selector that uniquely addresses `el`. */
export function getSelector(el: Element | null): string | null {
  if (!el || el.nodeType !== 1) return null;
  if (el.id) return "#" + CSS.escape(el.id);

  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && node !== document.body) {
    if (node.id) {
      parts.unshift("#" + CSS.escape(node.id));
      break;
    }
    let tag = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.prototype.filter.call(
        parent.children,
        (c: Element) => c.tagName === node!.tagName
      ) as Element[];
      if (sameTag.length > 1) {
        tag += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
    }
    parts.unshift(tag);
    node = parent;
  }
  return parts.join(" > ");
}

/** Resolve a selector to a live element, or null if it no longer matches. */
export function resolveTarget(selector: string | null): Element | null {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

/**
 * The nearest still-present ancestor implied by a CSS-path selector, used to scope
 * a text-quote search after the exact selector breaks. Walks the " > " chain from
 * the full path down to the first segment, returning the longest surviving prefix
 * (so we search as tightly as possible). Falls back to <body>.
 */
function searchRoot(selector: string): Element {
  const parts = selector.split(" > ");
  for (let i = parts.length - 1; i >= 1; i--) {
    const prefix = parts.slice(0, i).join(" > ");
    try {
      const el = document.querySelector(prefix);
      if (el) return el;
    } catch {
      /* malformed prefix — keep walking up */
    }
  }
  return document.body;
}

/**
 * Deepest single element within `root` whose text content contains `needle`,
 * skipping any subtree in `exclude` (the widget's own UI/pins). Returning the
 * deepest match gives the tightest anchor; if the quote spans siblings, the common
 * ancestor is returned instead.
 */
function deepestContaining(root: Element, needle: string, exclude: Element[]): Element | null {
  if (exclude.indexOf(root) !== -1) return null;
  if ((root.textContent || "").indexOf(needle) === -1) return null;
  const children = Array.prototype.slice.call(root.children) as Element[];
  for (const child of children) {
    const found = deepestContaining(child, needle, exclude);
    if (found) return found;
  }
  return root;
}

/**
 * Resolve a comment's anchor to a live element using its two stored anchors in
 * order of precision:
 *   1. the exact CSS-path selector;
 *   2. the quoted text within the nearest surviving ancestor of that selector;
 *   3. the quoted text anywhere in the document.
 * Returns null when none match — the caller then treats the comment as orphaned
 * (kept and shown in the panel) rather than dropping it.
 *
 * `exclude` lists widget-owned roots (shadow host, pins layer) to keep the
 * text-quote search from matching the widget's own DOM.
 */
export function resolveAnchor(
  selector: string | null,
  quote?: string,
  exclude: Element[] = []
): Element | null {
  const needle = (quote || "").trim();
  const direct = resolveTarget(selector);

  // Trust the direct hit when there's no quote to check against, or when the matched
  // element actually contains the quote (selector still points at the right place).
  // A selector can survive structurally yet match the WRONG element after sibling
  // insertion (e.g. nth-of-type shifts) — the quote check catches that drift.
  if (direct && (!needle || (direct.textContent || "").indexOf(needle) !== -1)) {
    return direct;
  }

  // Selector missing or drifted: re-anchor by quoted text, scoped first to the
  // nearest surviving ancestor, then the whole document.
  if (needle) {
    const scoped = deepestContaining(searchRoot(selector || ""), needle, exclude);
    if (scoped) return scoped;
    const inBody = document.body ? deepestContaining(document.body, needle, exclude) : null;
    if (inBody) return inBody;
    // Quote was provided but is gone from the page → orphan, rather than pin to an
    // unrelated element the stale selector happens to match.
    return null;
  }

  return direct || null;
}

/** Best-effort element for the current text selection. */
export function elementFromSelection(sel: Selection): Element | null {
  const node = sel.getRangeAt(0).commonAncestorContainer;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}
