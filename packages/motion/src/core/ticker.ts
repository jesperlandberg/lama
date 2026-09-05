/**
 * Anything that can be advanced by dt seconds. Return true while still moving.
 * Spring, SpringSet (via adapter), and custom drivers all satisfy this.
 */
export interface Steppable {
  step(dt: number): boolean | number;
}

export type TickPhase = 'step' | 'write';

export interface TickerOptions {
  /** Clamp dt so a backgrounded tab doesn't produce a huge jump. Seconds. */
  maxDt?: number;
  /** Fixed dt in seconds. If set, the ticker ignores wall-clock time (useful for tests / deterministic capture). */
  fixedDt?: number;
}

/**
 * One loop for everything. Two phases per frame:
 *   1. step  — all springs integrate
 *   2. write — adapters read values and write to DOM styles / GPU buffers
 *
 * Can run its own rAF, or be driven by an external loop via `tick(dt)`.
 */
export class Ticker {
  private steppables = new Set<Steppable>();
  private writers = new Set<(dt: number) => void>();
  private raf = 0;
  private last = 0;
  private running = false;
  private maxDt: number;
  private fixedDt: number | undefined;

  constructor(opts: TickerOptions = {}) {
    this.maxDt = opts.maxDt ?? 1 / 20;
    this.fixedDt = opts.fixedDt;
  }

  add(s: Steppable): () => void {
    this.steppables.add(s);
    return () => this.steppables.delete(s);
  }

  /** Register a write-phase callback (DOM/GL adapters). */
  onWrite(fn: (dt: number) => void): () => void {
    this.writers.add(fn);
    return () => this.writers.delete(fn);
  }

  /** Advance everything by dt seconds. Call this from an external render loop. */
  tick(dt: number): void {
    const d = Math.min(dt, this.maxDt);
    for (const s of this.steppables) s.step(d);
    for (const w of this.writers) w(d);
  }

  /** Start a self-driven requestAnimationFrame loop. */
  start(): this {
    if (this.running || typeof requestAnimationFrame === 'undefined') return this;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = this.fixedDt ?? (now - this.last) / 1000;
      this.last = now;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
    return this;
  }

  stop(): this {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    return this;
  }
}
