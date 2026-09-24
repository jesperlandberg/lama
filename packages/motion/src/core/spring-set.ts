import { finite, index, positiveInt } from './guard.js';
import {
  computeCoefficients,
  resolveConfig,
  toPhysical,
  type SpringConfig,
  type SpringParams,
  type StepCoefficients,
} from './spring.js';

/**
 * A batch of N springs, each with C channels (e.g. C=2 for xy, C=3 for rgb),
 * stored structure-of-arrays in Float32Arrays. `values` can be handed directly
 * to a GPU buffer write or read in a DOM adapter loop.
 *
 * All springs in a set share params. Use several sets for different feels.
 */
export class SpringSet {
  readonly count: number;
  readonly channels: number;
  readonly values: Float32Array;
  readonly velocities: Float32Array;
  readonly targets: Float32Array;
  /** 1 = awake, 0 = sleeping. */
  readonly awake: Uint8Array;
  config: SpringConfig;
  /**
   * Bumped on every frame that changed a value, and by `snap`. A consumer
   * that uploads `values` somewhere expensive — a GPU buffer, a worker —
   * compares it with the number it last uploaded, which also covers the frame
   * a spring settles on and a `snap` made while the set is asleep.
   */
  revision = 0;

  private coefDt = -1;
  private coef: StepCoefficients | null = null;
  private activeCount = 0;

  constructor(count: number, channels: number, params: SpringParams, rest?: Partial<Pick<SpringConfig, 'restVelocity' | 'restDisplacement'>>) {
    this.count = positiveInt(count, 'count');
    this.channels = positiveInt(channels, 'channels');
    const n = count * channels;
    this.values = new Float32Array(n);
    this.velocities = new Float32Array(n);
    this.targets = new Float32Array(n);
    this.awake = new Uint8Array(count);
    this.config = resolveConfig(params, rest);
  }

  /** Number of springs currently in motion. */
  get active(): number {
    return this.activeCount;
  }

  setParams(params: SpringParams): this {
    this.config = { ...this.config, ...toPhysical(params) };
    this.coefDt = -1;
    return this;
  }

  /**
   * Mark spring `i` as moving. Only needed after writing `values` or
   * `velocities` through the arrays directly; every method here wakes what
   * it touches.
   */
  wake(i: number): void {
    if (this.awake[index(i, this.count, 'spring index')] === 0) {
      this.awake[i] = 1;
      this.activeCount++;
    }
  }

  /** Retarget one channel of one spring. Value and velocity are untouched. */
  setTarget(i: number, channel: number, target: number): void {
    const idx = index(i, this.count, 'spring index') * this.channels + index(channel, this.channels, 'channel');
    if (this.targets[idx] !== finite(target, 'target')) {
      this.targets[idx] = target;
      this.wake(i);
    }
  }

  /** Retarget all channels of one spring. */
  setTargets(i: number, ...targets: number[]): void {
    const base = index(i, this.count, 'spring index') * this.channels;
    let changed = false;
    for (let c = 0; c < this.channels; c++) {
      const t = targets[c];
      // a channel not given keeps its target — and never becomes NaN
      if (t === undefined || this.targets[base + c] === finite(t, 'target')) continue;
      this.targets[base + c] = t;
      changed = true;
    }
    if (changed) this.wake(i);
  }

  addVelocity(i: number, channel: number, dv: number): void {
    const idx = index(i, this.count, 'spring index') * this.channels + index(channel, this.channels, 'channel');
    this.velocities[idx] = this.velocities[idx]! + finite(dv, 'velocity');
    this.wake(i);
  }

  /**
   * Jump instantly to a value with no motion. Channels left out keep moving:
   * a partial snap places the channels it was given and leaves the rest of
   * the spring's motion alone.
   */
  snap(i: number, ...values: number[]): void {
    const base = index(i, this.count, 'spring index') * this.channels;
    let changed = false;
    for (let c = 0; c < this.channels; c++) {
      const v = values[c];
      if (v === undefined) continue;
      if (this.values[base + c] !== finite(v, 'value')) changed = true;
      this.values[base + c] = v;
      this.targets[base + c] = v;
      this.velocities[base + c] = 0;
    }
    if (changed) this.revision++;
    if (this.awake[i] === 1 && !this.moving(i)) {
      this.awake[i] = 0;
      this.activeCount--;
    }
  }

  /** Read a single channel value. */
  get(i: number, channel: number): number {
    return this.values[index(i, this.count, 'spring index') * this.channels + index(channel, this.channels, 'channel')]!;
  }

  /** Is any channel of spring `i` still away from its target, or still carrying speed? */
  private moving(i: number): boolean {
    const base = i * this.channels;
    const { restDisplacement, restVelocity } = this.config;
    for (let c = 0; c < this.channels; c++) {
      const idx = base + c;
      if (Math.abs(this.values[idx]! - this.targets[idx]!) >= restDisplacement) return true;
      if (Math.abs(this.velocities[idx]!) >= restVelocity) return true;
    }
    return false;
  }

  /** Advance every awake spring by dt seconds. Returns number still moving. */
  step(dt: number): number {
    if (this.activeCount === 0) return 0;

    if (dt !== this.coefDt || this.coef === null) {
      this.coef = computeCoefficients(this.config, dt);
      this.coefDt = dt;
    }
    const { a, b, c, d } = this.coef;
    const { restDisplacement, restVelocity } = this.config;
    const C = this.channels;
    const vals = this.values, vels = this.velocities, tg = this.targets, awake = this.awake;
    let dirty = false;

    for (let i = 0; i < this.count; i++) {
      if (awake[i] === 0) continue;
      const base = i * C;
      let moving = false;
      for (let ch = 0; ch < C; ch++) {
        const idx = base + ch;
        const t = tg[idx]!;
        const prev = vals[idx]!;
        const x = prev - t;
        const v = vels[idx]!;
        const nx = a * x + b * v;
        const nv = c * x + d * v;
        if (Math.abs(nx) < restDisplacement && Math.abs(nv) < restVelocity) {
          vals[idx] = t;
          vels[idx] = 0;
          if (prev !== t) dirty = true;
          continue;
        }
        vals[idx] = t + nx;
        // Float32 steps get coarser the further from zero a value sits: about
        // a thousandth of a pixel at 10000, which is the rest threshold
        // itself. Past that point a frame's progress rounds away, the stored
        // value stops changing, and the absolute thresholds are never met —
        // the spring would stay awake for ever, writing a value that cannot
        // move. Land it when the step asked for progress (`nx !== x` — with a
        // dt of 0 it asks for none), the store could not give any, and what
        // is left is inside a few of those steps anyway.
        if (nx !== x && vals[idx] === prev && Math.abs(nx) <= restDisplacement + Math.abs(t) * 4.8e-7) {
          vals[idx] = t;
          vels[idx] = 0;
          if (prev !== t) dirty = true;
          continue;
        }
        vels[idx] = nv;
        if (vals[idx] !== prev) dirty = true;
        moving = true;
      }
      if (!moving) {
        awake[i] = 0;
        this.activeCount--;
      }
    }
    if (dirty) this.revision++;
    return this.activeCount;
  }
}
