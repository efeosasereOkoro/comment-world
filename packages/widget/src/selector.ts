// Element addressing. Generates a CSS-path selector for a commented element and
// resolves it back. This single-anchor approach is preserved from the original
// implementation; Phase 6 extends it with text-quote + stable-ancestor fallbacks.

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

/** Best-effort element for the current text selection. */
export function elementFromSelection(sel: Selection): Element | null {
  const node = sel.getRangeAt(0).commonAncestorContainer;
  return node.nodeType === 1 ? (node as Element) : node.parentElement;
}
