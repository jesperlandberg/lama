import type { Spring } from '../core/spring.js';
import type { SpringSet } from '../core/spring-set.js';
import type { Ticker } from '../core/ticker.js';

/**
 * The DOM write side. Springs never know about elements; this adapter reads
 * spring values in the ticker's write phase and writes styles. A binding
 * writes only on frames where one of its springs moved (plus one frame after
 * it settles, so the final value lands exactly), so a settled page costs no
 * style writes at all.
 */

export interface TransformSprings {
  /** px */
  x?: Spring;
  /** px */
  y?: Spring;
  scale?: Spring;
  scaleX?: Spring;
  scaleY?: Spring;
  /** degrees */
  rotate?: Spring;
  /** 0..1 — written to `opacity`, not the transform */
  opacity?: Spring;
}

export interface SetTransformChannels {
  x?: number;
  y?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  opacity?: number;
}

/** The subset of HTMLElement the adapter touches — lets tests pass a stub. */
export interface Styleable {
  style: CSSStyleDeclaration | Record<string, string>;
}

const fmt = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return r === 0 ? '0' : String(r);
};

function composeTransform(x: number | undefined, y: number | undefined, sx: number | undefined, sy: number | undefined, rot: number | undefined): string {
  let t = '';
  if (x !== undefined || y !== undefined) t += `translate3d(${fmt(x ?? 0)}px, ${fmt(y ?? 0)}px, 0)`;
  if (rot !== undefined) t += ` rotate(${fmt(rot)}deg)`;
  if (sx !== undefined || sy !== undefined) t += ` scale(${fmt(sx ?? 1)}, ${fmt(sy ?? 1)})`;
  return t.trim();
}

function setStyle(el: Styleable, prop: string, value: string): void {
  const s = el.style as CSSStyleDeclaration;
  if (prop.startsWith('--') && typeof s.setProperty === 'function') s.setProperty(prop, value);
  else (s as unknown as Record<string, string>)[prop] = value;
}

type Binding = { write(force: boolean): void };

export class DomAdapter {
  private bindings = new Set<Binding>();
  private off: () => void;

  constructor(ticker: Ticker) {
    this.off = ticker.onWrite(() => {
      for (const b of this.bindings) b.write(false);
    });
  }

  /**
   * Drive an element's transform (and optionally opacity) from springs.
   * Any subset of channels; the transform is composed translate → rotate →
   * scale. Returns an unbind function.
   */
  transform(el: Styleable, springs: TransformSprings): () => void {
    const list = Object.values(springs).filter(Boolean) as Spring[];
    let wasAwake = true; // write once on bind

    const b: Binding = {
      write: (force) => {
        let awake = false;
        for (const s of list) if (!s.sleeping) { awake = true; break; }
        if (!force && !awake && !wasAwake) return;
        wasAwake = awake;

        const sx = springs.scaleX?.value ?? springs.scale?.value;
        const sy = springs.scaleY?.value ?? springs.scale?.value;
        if (springs.x || springs.y || springs.rotate || sx !== undefined || sy !== undefined) {
          setStyle(el, 'transform', composeTransform(springs.x?.value, springs.y?.value, sx, sy, springs.rotate?.value));
        }
        if (springs.opacity) setStyle(el, 'opacity', fmt(springs.opacity.value));
      },
    };
    b.write(true);
    this.bindings.add(b);
    return () => { this.bindings.delete(b); };
  }

  /**
   * Drive a single CSS property (or `--custom-property`) from a spring.
   * `format` turns the value into the CSS string; default appends `unit`.
   */
  style(el: Styleable, prop: string, spring: Spring, format: ((v: number) => string) | string = ''): () => void {
    const f = typeof format === 'string' ? (v: number) => fmt(v) + format : format;
    let wasAwake = true;
    const b: Binding = {
      write: (force) => {
        const awake = !spring.sleeping;
        if (!force && !awake && !wasAwake) return;
        wasAwake = awake;
        setStyle(el, prop, f(spring.value));
      },
    };
    b.write(true);
    this.bindings.add(b);
    return () => { this.bindings.delete(b); };
  }

  /**
   * Drive many elements from one SpringSet: element i reads spring i, with
   * `channels` naming which channel index feeds which transform part.
   * Only awake springs (and those that just settled) are written.
   */
  setTransforms(els: ArrayLike<Styleable>, set: SpringSet, channels: SetTransformChannels): () => void {
    const n = Math.min(els.length, set.count);
    const was = new Uint8Array(n).fill(1);
    const C = set.channels;
    const ch = (i: number, c: number | undefined) => (c === undefined ? undefined : set.values[i * C + c]);

    const b: Binding = {
      write: (force) => {
        for (let i = 0; i < n; i++) {
          const awake = set.awake[i]!;
          if (!force && !awake && !was[i]) continue;
          was[i] = awake;
          const el = els[i]!;
          const sx = ch(i, channels.scaleX) ?? ch(i, channels.scale);
          const sy = ch(i, channels.scaleY) ?? ch(i, channels.scale);
          if (channels.x !== undefined || channels.y !== undefined || channels.rotate !== undefined || sx !== undefined) {
            setStyle(el, 'transform', composeTransform(ch(i, channels.x), ch(i, channels.y), sx, sy, ch(i, channels.rotate)));
          }
          if (channels.opacity !== undefined) setStyle(el, 'opacity', fmt(ch(i, channels.opacity)!));
        }
      },
    };
    b.write(true);
    this.bindings.add(b);
    return () => { this.bindings.delete(b); };
  }

  dispose(): void {
    this.bindings.clear();
    this.off();
  }
}
