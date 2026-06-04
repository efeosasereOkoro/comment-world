/* Decorations applied to HOST page elements (light DOM): the hover outline shown
 * while choosing a target, and the highlight on a commented element.
 *
 * These cannot live in the shadow stylesheet (they target the host's own elements),
 * so they are applied as inline styles with `!important` — fully self-scoped, never
 * relying on host CSS, and robust against the host's own rules. We only touch the
 * specific properties we set and remove exactly those on cleanup. */

function styleOf(el: Element): CSSStyleDeclaration | null {
  const s = (el as HTMLElement).style;
  return s ?? null;
}

export function addHoverOutline(el: Element): void {
  const s = styleOf(el);
  if (!s) return;
  s.setProperty("outline", "2px dashed #0e5f64", "important");
  s.setProperty("outline-offset", "2px", "important");
}

export function removeHoverOutline(el: Element): void {
  const s = styleOf(el);
  if (!s) return;
  s.removeProperty("outline");
  s.removeProperty("outline-offset");
}

export function addHighlight(el: Element): void {
  const s = styleOf(el);
  if (!s) return;
  // background-color (not the `background` shorthand) so we don't wipe a host bg image.
  s.setProperty("background-color", "#ffe9a8", "important");
  s.setProperty("box-shadow", "0 0 0 3px #ffc726", "important");
  s.setProperty("transition", "background-color .2s ease", "important");
}

export function removeHighlight(el: Element): void {
  const s = styleOf(el);
  if (!s) return;
  s.removeProperty("background-color");
  s.removeProperty("box-shadow");
  s.removeProperty("transition");
}
