/**
 * Estimates the velocity of a pointer (or any sampled scalar) from its recent
 * history, in units per second. Used to hand drag velocity to a spring on
 * release: the finger's speed becomes the spring's velocity, so a fling is
 * the same motion continued rather than a new one started.
 *
 * Velocity is the slope over the samples inside `window` seconds of the most
 * recent one. A single stale sample (a finger that stopped, then lifted) is
 * handled by the caller passing `now`: if the last sample is older than the
 * window, the tracker reports zero.
 */
export class VelocityTracker {
  private times: number[] = [];
  private values: number[] = [];
  private readonly window: number;
  private readonly cap: number;

  constructor(window = 0.1, cap = 32) {
    this.window = window;
    this.cap = cap;
  }

  reset(): void {
    this.times.length = 0;
    this.values.length = 0;
  }

  /** Record a sample. `t` in seconds. */
  add(value: number, t: number): void {
    this.times.push(t);
    this.values.push(value);
    if (this.times.length > this.cap) {
      this.times.shift();
      this.values.shift();
    }
  }

  /**
   * Units per second over the recent window, or 0 with too little data. The
   * span is floored at half a frame: two samples a millisecond apart (a
   * synthetic drag, a coalesced event burst) would otherwise report a slope
   * that is all noise.
   */
  velocity(now?: number): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const tLast = this.times[n - 1]!;
    if (now !== undefined && now - tLast > this.window) return 0;

    // Oldest sample still inside the window.
    let i = n - 1;
    while (i > 0 && tLast - this.times[i - 1]! <= this.window) i--;
    if (i === n - 1) i = n - 2;

    const dt = tLast - this.times[i]!;
    if (dt <= 0) return 0;
    return (this.values[n - 1]! - this.values[i]!) / Math.max(dt, 1 / 120);
  }
}

/**
 * How far a fling travels before friction stops it, from an initial velocity
 * in units per second — UIKit's projection with its default deceleration
 * rate. Adding this to the release position gives the natural resting target;
 * the spring then carries the hand's velocity into it, so the deceleration is
 * the spring's own instead of a separate friction curve.
 *
 * The rate is a fraction of speed kept per millisecond, so it has to stay
 * below 1: at 1 the fling never slows and the projection is infinite. It is
 * clamped rather than refused — a caller tuning by feel should get a very
 * long throw, not an exception.
 */
export function projectFling(velocity: number, decelerationRate = 0.998): number {
  if (!Number.isFinite(velocity)) return 0;
  const rate = Math.min(Math.max(Number.isFinite(decelerationRate) ? decelerationRate : 0.998, 0), 0.9999);
  return ((velocity / 1000) * rate) / (1 - rate);
}
