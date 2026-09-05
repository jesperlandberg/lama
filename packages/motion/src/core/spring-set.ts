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

  private coefDt = -1;
  private coef: StepCoefficients | null = null;
  private activeCount = 0;

  constructor(count: number, channels: number, params: SpringParams, rest?: Partial<Pick<SpringConfig, 'restVelocity' | 'restDisplacement'>>) {
    this.count = count;
    this.channels = channels;
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

  private wake(i: number): void {
    if (this.awake[i] === 0) {
      this.awake[i] = 1;
      this.activeCount++;
    }
  }

  /** Retarget one channel of one spring. Value and velocity are untouched. */
  setTarget(i: number, channel: number, target: number): void {
    const idx = i * this.channels + channel;
    if (this.targets[idx] !== target) {
      this.targets[idx] = target;
      this.wake(i);
    }
  }

  /** Retarget all channels of one spring. */
  setTargets(i: number, ...targets: number[]): void {
    const base = i * this.channels;
    let changed = false;
    for (let c = 0; c < this.channels; c++) {
      const t = targets[c];
      // a channel not given keeps its target — and never becomes NaN
      if (t === undefined || this.targets[base + c] === t) continue;
      this.targets[base + c] = t;
      changed = true;
    }
    if (changed) this.wake(i);
  }

  addVelocity(i: number, channel: number, dv: number): void {
    const idx = i * this.channels + channel;
    this.velocities[idx] = this.velocities[idx]! + dv;
    this.wake(i);
  }

  /** Jump instantly to a value with no motion. */
  snap(i: number, ...values: number[]): void {
    const base = i * this.channels;
    for (let c = 0; c < this.channels; c++) {
      const v = values[c];
      if (v === undefined) continue;
      this.values[base + c] = v;
      this.targets[base + c] = v;
      this.velocities[base + c] = 0;
    }
    if (this.awake[i] === 1) {
      this.awake[i] = 0;
      this.activeCount--;
    }
  }

  /** Read a single channel value. */
  get(i: number, channel: number): number {
    return this.values[i * this.channels + channel]!;
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

    for (let i = 0; i < this.count; i++) {
      if (awake[i] === 0) continue;
      const base = i * C;
      let moving = false;
      for (let ch = 0; ch < C; ch++) {
        const idx = base + ch;
        const t = tg[idx]!;
        const x = vals[idx]! - t;
        const v = vels[idx]!;
        const nx = a * x + b * v;
        const nv = c * x + d * v;
        if (Math.abs(nx) < restDisplacement && Math.abs(nv) < restVelocity) {
          vals[idx] = t;
          vels[idx] = 0;
        } else {
          vals[idx] = t + nx;
          vels[idx] = nv;
          moving = true;
        }
      }
      if (!moving) {
        awake[i] = 0;
        this.activeCount--;
      }
    }
    return this.activeCount;
  }
}
