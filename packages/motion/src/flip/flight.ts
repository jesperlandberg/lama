import { SpringSet } from '../core/spring-set.js';
import type { SpringParams } from '../core/spring.js';
import type { Steppable } from '../core/ticker.js';
import type { Rect } from './rect.js';

/**
 * One flight: five springs (x, y, w, h, radius) toward a target that is
 * RE-READ every frame. Motion state lives on the springs — pose and velocity
 * — never on a tween, so:
 *
 * - retarget = the target reads differently. Velocity carries through, and
 *   the new destination behaves as if it had been the destination all along.
 * - a moving destination (late layout, font swap, resize) is absorbed frame
 *   by frame; "Last" is never a snapshot.
 * - scroll is NOT target motion: the spring VALUE is shifted by the scroll
 *   delta, so the plane rides the page like a settled element while the gap
 *   it is closing stays the same. The flight lands on schedule mid-scroll
 *   instead of chasing.
 * - a target that DIES (returns null) freezes where it last stood; the
 *   springs glide to a stop there instead of freeze-framing.
 */

export interface FlightTarget {
  /** Live viewport rect, or null when the destination is gone. */
  rect(): Rect | null;
  /** Live corner radius, px. Optional. */
  radius?(): number;
}

export interface FlightOptions {
  params?: SpringParams;
  /** Viewport scroll offset. Default reads window.scrollX/Y. */
  scroll?: () => { x: number; y: number };
  /** Arrival tolerance: px and px/s. Default 0.5 px, 12 px/s. */
  restDisplacement?: number;
  restVelocity?: number;
}

/**
 * Slightly under critical damping so arrival carries a breath of overshoot.
 * `response` 0.625 s ≈ the original 1.6 Hz flight.
 */
export const FLIGHT_PARAMS: SpringParams = { response: 0.625, dampingRatio: 0.94 };

const X = 0, Y = 1, W = 2, H = 3, R = 4;

const defaultScroll = () =>
  typeof window === 'undefined' ? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };

export class Flight implements Steppable {
  /** 1 spring × 5 channels: left, top, width, height, radius. */
  readonly set: SpringSet;
  target: FlightTarget;
  pose: Rect;
  radius: number;
  /** True once every channel has settled on a LIVE target. */
  arrived = false;
  /** The last live target rect, kept when the target dies. */
  lastTarget: Rect | null = null;

  private scroll: () => { x: number; y: number };
  private sx: number;
  private sy: number;

  constructor(from: Rect, target: FlightTarget, opts: FlightOptions = {}, fromRadius = 0) {
    this.set = new SpringSet(1, 5, opts.params ?? FLIGHT_PARAMS, {
      restDisplacement: opts.restDisplacement ?? 0.5,
      restVelocity: opts.restVelocity ?? 12,
    });
    this.scroll = opts.scroll ?? defaultScroll;
    const s = this.scroll();
    this.sx = s.x;
    this.sy = s.y;
    this.target = target;
    this.pose = { ...from };
    this.radius = fromRadius;
    this.set.snap(0, from.left, from.top, from.width, from.height, fromRadius);
    this.aim();
  }

  /** Swap the destination. Springs are untouched — this is the whole interrupt story. */
  retarget(target: FlightTarget): void {
    this.target = target;
    this.arrived = false;
    this.aim();
  }

  /** Inject velocity (px/s) into position — e.g. a drag release that starts a flight. */
  addVelocity(vx: number, vy: number): void {
    this.set.addVelocity(0, X, vx);
    this.set.addVelocity(0, Y, vy);
    this.arrived = false;
  }

  private aim(): boolean {
    const r = this.target.rect();
    if (!r) return false;
    this.lastTarget = r;
    const rad = this.target.radius ? this.target.radius() : this.set.targets[R]!;
    this.set.setTargets(0, r.left, r.top, r.width, r.height, rad);
    return true;
  }

  step(dt: number): boolean {
    const s = this.scroll();
    const v = this.set.values;

    // Only a live destination rides the scroll; a dead one skips both halves,
    // which is also what keeps a mid-navigation scroll reset from teleporting
    // a held flight — the baseline still advances, so the jump is never applied.
    const live = this.aim();
    if (live) {
      v[X] = v[X]! - (s.x - this.sx);
      v[Y] = v[Y]! - (s.y - this.sy);
    }
    this.sx = s.x;
    this.sy = s.y;

    const moving = this.set.step(dt) > 0;

    this.pose.left = v[X]!;
    this.pose.top = v[Y]!;
    this.pose.width = v[W]!;
    this.pose.height = v[H]!;
    this.radius = v[R]!;

    if (!moving && live) this.arrived = true;
    return moving;
  }
}
