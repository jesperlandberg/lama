import type { Ticker } from '../core/ticker.js';
import type { Flip, FlipEntry } from './flip.js';

/**
 * The DOM writer for a Flip registry. Each frame, every flying entry gets a
 * transform that moves its element from where layout put it (`entry.layout`)
 * to where the flight says it is (`entry.pose`):
 *
 *   translate(pose - layout) scale(pose / layout), origin 0 0
 *
 * The transform is recorded on the entry so the registry can invert it when
 * it measures the element next frame — measurement stays live, and never has
 * to clear the transform to read the layout underneath.
 *
 * Landed entries have their transform cleared. Held entries whose element is
 * gone have no element to write to; a page transition that needs a visible
 * stand-in during the gap renders one from `entry.pose` itself (a GL plane
 * does this natively).
 */

export interface DomFlipOptions {
  /** Counter-scale the border radius so corners stay round mid-flight. Default true. */
  radius?: boolean;
  /** Raise flying elements. Default 100; null leaves z-index alone. */
  zIndex?: number | null;
  /** Called after each element is written. */
  onWrite?: (entry: FlipEntry, el: HTMLElement) => void;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

export function applyFlipToDom(flip: Flip, ticker: Ticker, opts: DomFlipOptions = {}): () => void {
  const radius = opts.radius ?? true;
  const z = opts.zIndex === undefined ? 100 : opts.zIndex;

  const clear = (e: FlipEntry, el: HTMLElement) => {
    el.style.transform = '';
    el.style.transformOrigin = '';
    if (radius) el.style.borderRadius = '';
    if (z !== null) el.style.zIndex = '';
    e.applied = null;
  };

  const write = () => {
    for (const e of flip) {
      const el = e.el as HTMLElement;
      if (!el.style) continue;

      if (!e.flight || !e.pose || !e.layout) {
        if (e.applied) clear(e, el);
        continue;
      }

      const L = e.layout, P = e.pose;
      const sx = L.width ? P.width / L.width : 1;
      const sy = L.height ? P.height / L.height : 1;
      const tx = P.left - L.left;
      const ty = P.top - L.top;

      el.style.transformOrigin = '0 0';
      el.style.transform = `translate3d(${fmt(tx)}px, ${fmt(ty)}px, 0) scale(${fmt(sx)}, ${fmt(sy)})`;
      if (radius) {
        const r = e.radius;
        el.style.borderRadius = r ? `${fmt(r / sx)}px / ${fmt(r / sy)}px` : '';
      }
      if (z !== null) el.style.zIndex = String(z);
      e.applied = { tx, ty, sx, sy };
      opts.onWrite?.(e, el);
    }
  };

  const offWrite = ticker.onWrite(write);
  return () => {
    offWrite();
    for (const e of flip) if (e.applied) clear(e, e.el as HTMLElement);
  };
}
