export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function sameRect(a: Rect | null, b: Rect | null, eps = 0.01): boolean {
  if (!a || !b) return a === b;
  return (
    Math.abs(a.left - b.left) < eps &&
    Math.abs(a.top - b.top) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

/** Viewport rect of a connected element, or null when it is not in the document. */
export function measureElement(el: Element): Rect | null {
  if (!el.isConnected) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** The element's own corner radius in px (first value only), 0 when unknown. */
export function measureRadius(el: Element): number {
  if (typeof getComputedStyle !== 'function' || !el.isConnected) return 0;
  return parseFloat(getComputedStyle(el).borderRadius) || 0;
}
