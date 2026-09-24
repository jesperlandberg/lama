import type { Spring } from '../core/spring.js';
import type { SpringSet } from '../core/spring-set.js';
import type { Ticker } from '../core/ticker.js';

/**
 * The DOM write side. Springs never know about elements; this adapter reads
 * spring values in the ticker's write phase and writes styles.
 *
 * A binding writes when a value it wrote has changed, and is silent
 * otherwise, so a settled page costs no style writes. The test is the value
 * itself, never the awake flag: `snap()` moves a spring and leaves it
 * asleep, a spring can wake and settle inside one tick, and a consumer can
 * write into a `SpringSet`'s arrays directly — a flag misses all three,
 * while the numbers cannot lie about themselves. Comparing a handful of
 * floats per binding is cheaper than composing the string it would write.
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

/** True when any spring's value differs from the one stored in `last`; stores the new ones. */
function changed(springs: readonly Spring[], last: Float64Array): boolean {
  let moved = false;
  for (let i = 0; i < springs.length; i++) {
    const v = springs[i]!.value;
    if (v !== last[i]) { last[i] = v; moved = true; }
  }
  return moved;
}

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
    const last = new Float64Array(list.length).fill(NaN);

    const b: Binding = {
      write: (force) => {
        const moved = changed(list, last);
        if (!force && !moved) return;

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
    let last = NaN;
    const b: Binding = {
      write: (force) => {
        const v = spring.value;
        if (!force && v === last) return;
        last = v;
        setStyle(el, prop, f(v));
      },
    };
    b.write(true);
    this.bindings.add(b);
    return () => { this.bindings.delete(b); };
  }

  /**
   * The fan-out: run `write` in the write phase whenever any of `springs`
   * moved. This is how one spring drives several things at once — a scale
   * here, an opacity there, a colour mix, a sibling element, a canvas — with
   * the adapter still deciding when there is anything to do.
   *
   *   dom.bind([hover], () => {
   *     card.style.transform = `scale(${1 + hover.value * 0.05})`;
   *     glow.style.opacity = String(hover.value);
   *   });
   */
  bind(springs: Iterable<Spring>, write: () => void): () => void {
    const list = [...springs];
    const last = new Float64Array(list.length).fill(NaN);
    const b: Binding = {
      write: (force) => {
        const moved = changed(list, last);
        if (force || moved) write();
      },
    };
    b.write(true);
    this.bindings.add(b);
    return () => { this.bindings.delete(b); };
  }

  /**
   * Drive many elements from one SpringSet: element i reads spring i, with
   * `channels` naming which channel index feeds which transform part.
   * An element is written only when one of the channels it reads changed.
   */
  setTransforms(els: ArrayLike<Styleable>, set: SpringSet, channels: SetTransformChannels): () => void {
    const n = Math.min(els.length, set.count);
    const C = set.channels;
    const used: number[] = [];
    for (const key of ['x', 'y', 'scale', 'scaleX', 'scaleY', 'rotate', 'opacity'] as const) {
      const c = channels[key];
      if (c === undefined) continue;
      if (!Number.isInteger(c) || c < 0 || c >= C) throw new RangeError(`@lama/motion: channel ${key} must be an integer in [0, ${C}) (got ${c})`);
      used.push(c);
    }
    const last = new Float64Array(n * used.length).fill(NaN);
    const ch = (i: number, c: number | undefined) => (c === undefined ? undefined : set.values[i * C + c]);

    const b: Binding = {
      write: (force) => {
        for (let i = 0; i < n; i++) {
          let moved = false;
          const base = i * used.length;
          for (let u = 0; u < used.length; u++) {
            const v = set.values[i * C + used[u]!]!;
            if (v !== last[base + u]) { last[base + u] = v; moved = true; }
          }
          if (!force && !moved) continue;
          const el = els[i]!;
          const sx = ch(i, channels.scaleX) ?? ch(i, channels.scale);
          const sy = ch(i, channels.scaleY) ?? ch(i, channels.scale);
          if (channels.x !== undefined || channels.y !== undefined || channels.rotate !== undefined || sx !== undefined || sy !== undefined) {
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
