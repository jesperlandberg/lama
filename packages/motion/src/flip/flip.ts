import type { SpringParams } from '../core/spring.js';
import type { Steppable } from '../core/ticker.js';
import { Flight, FLIGHT_PARAMS } from './flight.js';
import { measureElement, measureRadius, sameRect, type Rect } from './rect.js';

/**
 * The FLIP registry — the state machine per id:
 *
 *   SETTLED → HELD       hold(id): pose frozen at lastRect past the element's death
 *   SETTLED → RETIRED    element died unheld (sweep)
 *   HELD    → FLYING     register(id, newEl) claims the id — the handoff
 *   HELD    → RETIRED    hold timed out, or expireHolds() after a navigation
 *                        that never claimed it
 *   FLYING  → FLYING     any retarget: register again, layout shift, resize
 *   FLYING  → HELD       hold() mid-flight (an interrupting navigation)
 *   FLYING  → SETTLED    arrival
 *
 * Every transition is "set the target"; nothing is cancelled. play() covers
 * the in-page case: mutate the layout, call play() in the same task, and each
 * settled element flies from its previous-frame pose to its new live rect.
 *
 * The registry only produces geometry (`entry.pose`). Writers consume it:
 * `applyFlipToDom` for markup, a GL adapter reads the same poses.
 */

export interface FlipOptions {
  params?: SpringParams;
  scroll?: () => { x: number; y: number };
  /** Clock in ms. Default performance.now. */
  now?: () => number;
  /** Untransformed viewport rect of an element, or null when it is not in the document. */
  measure?: (el: Element) => Rect | null;
  /** Corner radius in px. */
  radius?: (el: Element) => number;
  /** Hold timeout, ms. Default 4000. */
  holdTimeout?: number;
  /** Grace for an entry whose element has never been in the document, ms. Default 4000. */
  newbornGrace?: number;
  /** An entry left the registry — the writer clears anything it wrote. */
  onRetire?: (entry: FlipEntry) => void;
}

export interface RegisterOptions {
  /**
   * The departure offer: `true` offers this element to any flip, an array
   * only toward those destination families. Nothing flips unless offered.
   */
  offer?: boolean | string[];
  /** Anything the writer wants to carry along. */
  data?: unknown;
}

/** The last transform a writer applied to `el`; measure() inverts it. */
export interface AppliedTransform {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

export interface FlipEntry {
  readonly id: string;
  el: Element;
  /** Where the element IS this frame — the writer draws this. */
  pose: Rect | null;
  /** Corner radius accompanying `pose`. */
  radius: number;
  /** The element's untransformed live rect this frame (null when dead). */
  layout: Rect | null;
  /** Stamped while settled: the flight's FROM should the element die. */
  lastRect: Rect | null;
  flight: Flight | null;
  held: boolean;
  holdUntil: number;
  offer: boolean | string[];
  data: unknown;
  applied: AppliedTransform | null;
  readonly bornAt: number;
}

export class Flip implements Steppable {
  private entries = new Map<string, FlipEntry>();
  private opts: Required<Pick<FlipOptions, 'params' | 'now' | 'measure' | 'radius' | 'holdTimeout' | 'newbornGrace'>> & FlipOptions;

  constructor(opts: FlipOptions = {}) {
    this.opts = {
      ...opts,
      params: opts.params ?? FLIGHT_PARAMS,
      now: opts.now ?? (() => performance.now()),
      measure: opts.measure ?? measureElement,
      radius: opts.radius ?? measureRadius,
      holdTimeout: opts.holdTimeout ?? 4000,
      newbornGrace: opts.newbornGrace ?? 4000,
    };
  }

  get(id: string): FlipEntry | null {
    return this.entries.get(id) ?? null;
  }

  pose(id: string): Rect | null {
    return this.entries.get(id)?.pose ?? null;
  }

  [Symbol.iterator](): IterableIterator<FlipEntry> {
    return this.entries.values();
  }

  /** Retune: applies to running flights and every flight started after. */
  setParams(params: SpringParams): this {
    this.opts.params = params;
    for (const e of this.entries.values()) e.flight?.set.setParams(params);
    return this;
  }

  /** Number of entries currently flying. */
  get flying(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.flight) n++;
    return n;
  }

  /**
   * Register an element under an id. Re-registering the same element only
   * refreshes the offer. A HELD id meeting a new element is the handoff: the
   * entry attaches to the element and flies there from wherever it stands —
   * the frozen rect if held, the live pose if a flight was interrupted.
   * Same id, different live element (a remount) replaces the entry.
   */
  register(id: string, el: Element, o: RegisterOptions = {}): FlipEntry {
    const existing = this.entries.get(id);
    if (existing) {
      if (existing.el === el) {
        existing.offer = o.offer ?? existing.offer;
        if (o.data !== undefined) existing.data = o.data;
        return existing;
      }
      if (existing.held || existing.flight) {
        this.attach(existing, el, o);
        return existing;
      }
      this.retire(existing);
    }

    const entry: FlipEntry = {
      id, el,
      pose: null, radius: 0, layout: null, lastRect: null,
      flight: null, held: false, holdUntil: 0,
      offer: o.offer ?? false, data: o.data,
      applied: null,
      bornAt: this.opts.now(),
    };
    this.entries.set(id, entry);
    this.settle(entry);
    return entry;
  }

  /** Drop an entry immediately (no hold, no flight). */
  unregister(id: string): void {
    const e = this.entries.get(id);
    if (e) this.retire(e);
  }

  /**
   * Keep the entry alive past its element's death. The caller navigates
   * next; the incoming page's register() with the same id claims it. The
   * timeout stops a failed navigation from leaking a frozen entry.
   */
  hold(id: string, timeout = this.opts.holdTimeout): void {
    const e = this.entries.get(id);
    if (!e) return;
    e.held = true;
    e.holdUntil = this.opts.now() + timeout;
  }

  /** Ids offering themselves toward `family` (or anywhere). The dispatcher intersects these with what the destination will mount. */
  candidates(family?: string): string[] {
    const out: string[] = [];
    for (const [id, e] of this.entries) {
      const f = e.offer;
      if (f === true || (family !== undefined && Array.isArray(f) && f.includes(family))) out.push(id);
    }
    return out;
  }

  /** A hold nothing claimed must not squat over the new page — call a beat after each navigation lands. */
  expireHolds(): void {
    for (const e of this.entries.values()) {
      if (e.held && !e.el.isConnected) e.holdUntil = 0;
    }
  }

  /**
   * In-page FLIP. Call synchronously after mutating the layout: every settled
   * entry whose live rect no longer matches its previous-frame pose flies
   * there. Entries already flying need nothing — their target is live.
   */
  play(ids?: Iterable<string>): number {
    let started = 0;
    const list = ids ? [...ids].map((id) => this.entries.get(id)).filter(Boolean) as FlipEntry[] : [...this.entries.values()];
    for (const e of list) {
      if (e.flight || !e.pose) continue;
      const live = this.measure(e);
      if (!live || sameRect(live, e.pose)) continue;
      this.fly(e, e.pose, e.radius);
      started++;
    }
    return started;
  }

  /** `mutate()` then `play()`. */
  mutate(fn: () => void, ids?: Iterable<string>): number {
    fn();
    return this.play(ids);
  }

  /** Advance the sweep and every flight by dt seconds. Returns true while anything flies. */
  step(dt: number): boolean {
    const now = this.opts.now();
    let moving = false;

    for (const e of [...this.entries.values()]) {
      if (e.el.isConnected) {
        if (e.flight) {
          e.flight.step(dt);
          e.pose = e.flight.pose;
          e.radius = e.flight.radius;
          e.layout = e.flight.lastTarget;
          if (e.flight.arrived) this.land(e);
          else moving = true;
        } else {
          this.settle(e);
        }
        continue;
      }

      // Element gone.
      e.layout = null;
      if (e.held) {
        if (now < e.holdUntil) {
          if (e.flight) {
            // Frozen target: glide to a stop where it last stood.
            e.flight.step(dt);
            e.pose = e.flight.pose;
            e.radius = e.flight.radius;
            moving = true;
          } else if (e.lastRect) {
            e.pose = e.lastRect;
          }
          continue;
        }
        e.held = false;
      }

      // Newborn grace: components can register before their page is inserted.
      if (!e.lastRect && now < e.bornAt + this.opts.newbornGrace) continue;

      this.retire(e);
    }
    return moving;
  }

  // --- internals ---

  private measure(e: FlipEntry): Rect | null {
    const r = this.opts.measure(e.el);
    if (!r) return null;
    const a = e.applied;
    if (!a) return r;
    // Undo our own translate/scale (origin 0 0) to recover the layout rect.
    return {
      left: r.left - a.tx,
      top: r.top - a.ty,
      width: a.sx ? r.width / a.sx : r.width,
      height: a.sy ? r.height / a.sy : r.height,
    };
  }

  private settle(e: FlipEntry): void {
    const r = this.measure(e);
    if (!r) return;
    e.layout = r;
    e.pose = r;
    e.lastRect = r;
    e.radius = this.opts.radius(e.el);
  }

  private targetFor(e: FlipEntry) {
    return {
      rect: () => this.measure(e),
      radius: () => this.opts.radius(e.el),
    };
  }

  private fly(e: FlipEntry, from: Rect, fromRadius: number): void {
    e.flight = new Flight(from, this.targetFor(e), { params: this.opts.params, scroll: this.opts.scroll }, fromRadius);
    e.pose = e.flight.pose;
  }

  private attach(e: FlipEntry, el: Element, o: RegisterOptions): void {
    const from = e.pose ?? e.lastRect;
    e.el = el;
    e.held = false;
    e.offer = o.offer ?? e.offer;
    if (o.data !== undefined) e.data = o.data;

    if (!from) {
      this.settle(e);
      return;
    }
    // Already flying: the target closure reads e.el, so the springs simply
    // aim somewhere new. Velocity carries through.
    if (e.flight) e.flight.retarget(this.targetFor(e));
    else this.fly(e, from, e.radius);
  }

  private land(e: FlipEntry): void {
    const f = e.flight!;
    e.flight = null;
    e.pose = f.lastTarget ?? f.pose;
    e.layout = e.pose;
    e.lastRect = e.pose;
    e.radius = this.opts.radius(e.el);
  }

  private retire(e: FlipEntry): void {
    this.entries.delete(e.id);
    e.flight = null;
    e.held = false;
    this.opts.onRetire?.(e);
  }
}
