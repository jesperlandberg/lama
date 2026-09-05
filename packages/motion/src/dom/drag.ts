import type { Spring, SpringParams } from '../core/spring.js';
import { VelocityTracker, projectFling } from '../core/velocity-tracker.js';
import type { PointerTarget } from './pointer.js';

/**
 * Drag with velocity handoff. While dragging, the pointer's offset becomes the
 * spring's target every move — the spring follows with its own lag, which is
 * the "weight" of the thing. On release the finger's velocity is injected
 * into the spring and the target is set to where a fling would come to rest,
 * so the release is the same motion continued, not a new one started.
 *
 * Only `setTarget` and `addVelocity` are ever called on the springs.
 */

export interface DragBounds {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
}

export interface DragOptions {
  x?: Spring;
  y?: Spring;
  /** Release targets are clamped to these. During the drag, overshoot is scaled by `rubberband`. */
  bounds?: DragBounds;
  /** 0 = hard stop at bounds while dragging, 1 = no resistance. Default 0.5. */
  rubberband?: number;
  /**
   * Fling on release: the target is projected from the release velocity
   * (UIKit deceleration). `false` drops the element where it is (the spring
   * still carries the velocity, so it overshoots and comes back). A number
   * sets the deceleration rate. Default true (0.998).
   */
  fling?: boolean | number;
  /** Override the release target. Receives the current target and pointer velocity per axis. */
  release?: (axis: 'x' | 'y', position: number, velocity: number) => number;
  /** px the pointer must move before the drag begins (so taps stay taps). Default 3. */
  threshold?: number;
  /** Decide per pointerdown whether this gesture may become a drag (e.g. only inside a band of the element). */
  accept?: (e: PointerEvent) => boolean;
  /**
   * Axis lock: once the pointer crosses the threshold, one axis wins and only
   * that spring moves for the rest of the gesture. `true` picks the dominant
   * axis; a function decides from the pointer offset (e.g. to bias toward the
   * axis that currently has somewhere to go). `onStart` receives the axis.
   * Default false (both springs follow).
   */
  lock?: boolean | ((dx: number, dy: number) => 'x' | 'y');
  /** Multiply pointer movement per axis before it reaches the spring; -1 inverts (content follows the finger). */
  axisScale?: { x?: number; y?: number };
  /** Cap on the velocity handed to the spring, px/s. Default 6000 — a hard flick; anything above is event noise. */
  maxVelocity?: number;
  /**
   * Params to switch the springs to while dragging (e.g. a stiffer follow),
   * restored on release. Optional; the default follow uses the spring's own.
   */
  dragParams?: SpringParams;
  /** `axis` is the locked axis, or null when not locking. */
  onStart?(axis: 'x' | 'y' | null): void;
  onMove?(dx: number, dy: number): void;
  onEnd?(vx: number, vy: number): void;
  /** Clock in seconds — injectable for tests. */
  now?: () => number;
}

type PE = Event & { pointerId?: number; clientX?: number; clientY?: number };

const clamp = (v: number, lo = -Infinity, hi = Infinity) => Math.min(hi, Math.max(lo, v));

function rubber(v: number, lo: number, hi: number, k: number): number {
  if (v < lo) return lo + (v - lo) * k;
  if (v > hi) return hi + (v - hi) * k;
  return v;
}

export function bindDrag(el: PointerTarget & { style?: CSSStyleDeclaration | Record<string, string> }, opts: DragOptions): () => void {
  const { x, y } = opts;
  if (!x && !y) throw new Error('bindDrag: need an x and/or y spring');

  const now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000);
  const threshold = opts.threshold ?? 3;
  const k = opts.rubberband ?? 0.5;
  const b = opts.bounds ?? {};
  const decel = opts.fling === false ? null : typeof opts.fling === 'number' ? opts.fling : 0.998;

  const vx = new VelocityTracker();
  const vy = new VelocityTracker();

  let id = -1;
  let active = false;   // pointer is down
  let dragging = false; // moved past threshold
  let axis: 'x' | 'y' | null = null; // the locked axis, when locking
  const sx = opts.axisScale?.x ?? 1;
  const sy = opts.axisScale?.y ?? 1;
  let px = 0, py = 0;   // pointer at down
  let ox = 0, oy = 0;   // spring value at down — grab it where it IS, no jump
  let savedX: Spring['config'] | null = null;
  let savedY: Spring['config'] | null = null;

  // Move/up listen on the window while a drag is active: the spring lags the
  // finger, so the pointer can leave the element mid-drag, and capture is
  // not guaranteed. Falls back to the element itself where there is no window.
  const root: EventTarget = typeof window !== 'undefined' ? window : el;

  // Stop the browser from scrolling on the axes we drag.
  const style = el.style as Record<string, string> | undefined;
  const prevTouch = style?.touchAction;
  if (style) style.touchAction = x && y ? 'none' : x ? 'pan-y' : 'pan-x';

  const down = (e: Event) => {
    if (active) return;
    if (opts.accept && !opts.accept(e as PointerEvent)) return;
    const p = e as PE;
    active = true;
    dragging = false;
    id = p.pointerId ?? 0;
    px = p.clientX ?? 0;
    py = p.clientY ?? 0;
    ox = x?.value ?? 0;
    oy = y?.value ?? 0;
    vx.reset(); vy.reset();
    const t = now();
    vx.add(px, t); vy.add(py, t);
    root.addEventListener('pointermove', move);
    root.addEventListener('pointerup', up);
    root.addEventListener('pointercancel', up);
  };

  const begin = (dx: number, dy: number) => {
    dragging = true;
    if (typeof opts.lock === 'function') axis = opts.lock(dx, dy);
    else axis = opts.lock ? (Math.abs(dx) >= Math.abs(dy) || !y ? (x ? 'x' : 'y') : 'y') : null;
    // Capture only once this IS a drag. Capturing on pointerdown would make
    // the browser deliver the tap's `click` to this element instead of the
    // child under the finger — a button or card inside a draggable strip
    // would never receive its click.
    try { el.setPointerCapture?.(id); } catch { /* not capturable */ }
    if (opts.dragParams) {
      if (x && axis !== 'y') { savedX = x.config; x.setParams(opts.dragParams); }
      if (y && axis !== 'x') { savedY = y.config; y.setParams(opts.dragParams); }
    }
    opts.onStart?.(axis);
  };

  const move = (e: Event) => {
    if (!active) return;
    const p = e as PE;
    if ((p.pointerId ?? 0) !== id) return;
    const cx = p.clientX ?? 0, cy = p.clientY ?? 0;
    const dx = cx - px, dy = cy - py;
    const t = now();
    vx.add(cx, t); vy.add(cy, t);

    if (!dragging) {
      if (Math.hypot(x ? dx : 0, y ? dy : 0) < threshold) return;
      begin(dx, dy);
    }

    if (x && axis !== 'y') x.setTarget(rubber(ox + dx * sx, b.minX ?? -Infinity, b.maxX ?? Infinity, k));
    if (y && axis !== 'x') y.setTarget(rubber(oy + dy * sy, b.minY ?? -Infinity, b.maxY ?? Infinity, k));
    opts.onMove?.(dx, dy);
  };

  const up = (e: Event) => {
    if (!active) return;
    if (((e as PE).pointerId ?? 0) !== id) return;
    active = false;
    id = -1;
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    if (!dragging) return;
    dragging = false;

    const t = now();
    const cap = opts.maxVelocity ?? 6000;
    const velX = clamp(vx.velocity(t) * sx, -cap, cap), velY = clamp(vy.velocity(t) * sy, -cap, cap);

    if (savedX && x) { x.config = savedX; savedX = null; }
    if (savedY && y) { y.config = savedY; savedY = null; }

    const settle = (axis: 'x' | 'y', s: Spring, v: number, lo?: number, hi?: number) => {
      let target: number;
      if (opts.release) target = opts.release(axis, s.target, v);
      else target = clamp(decel === null ? s.target : s.target + projectFling(v, decel), lo, hi);
      s.setTarget(target);
      // Hand the pointer's velocity over exactly — replace, don't stack.
      s.addVelocity(v - s.velocity);
    };
    if (x && axis !== 'y') settle('x', x, velX, b.minX, b.maxX);
    if (y && axis !== 'x') settle('y', y, velY, b.minY, b.maxY);
    axis = null;

    opts.onEnd?.(velX, velY);
  };

  el.addEventListener('pointerdown', down);

  return () => {
    el.removeEventListener('pointerdown', down);
    root.removeEventListener('pointermove', move);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', up);
    if (style) style.touchAction = prevTouch ?? '';
  };
}
