/**
 * Damped harmonic oscillator, solved in closed form.
 *
 * The step function is pure: given (value, velocity, target, params, dt) it
 * returns the exact state dt seconds later. Because it re-derives from the
 * *current* state every frame, changing `target` (or injecting velocity)
 * between frames never produces a discontinuity — that is what makes the
 * system retargetable and velocity-preserving.
 */

export interface PhysicalParams {
  stiffness: number; // k
  damping: number;   // c
  mass: number;      // m
}

/**
 * Perceptual params. `response` is roughly the time (s) the spring takes to
 * reach its target when critically damped. `dampingRatio` 1 = no overshoot,
 * < 1 = bouncy, > 1 = sluggish. `bounce` (0..1) is an alias for 1 - dampingRatio.
 */
export interface PerceptualParams {
  response: number;
  dampingRatio?: number;
  bounce?: number;
  mass?: number;
}

export type SpringParams = PhysicalParams | PerceptualParams;

export interface SpringConfig extends PhysicalParams {
  /** Below this |velocity| and |displacement| the spring is considered at rest. */
  restVelocity: number;
  restDisplacement: number;
}

export const DEFAULT_REST_VELOCITY = 0.001;
export const DEFAULT_REST_DISPLACEMENT = 0.001;

export function isPerceptual(p: SpringParams): p is PerceptualParams {
  return (p as PerceptualParams).response !== undefined;
}

/** Convert perceptual (response, dampingRatio) to physical (k, c, m). */
export function toPhysical(p: SpringParams): PhysicalParams {
  if (!isPerceptual(p)) return { stiffness: p.stiffness, damping: p.damping, mass: p.mass };
  const mass = p.mass ?? 1;
  const zeta = p.dampingRatio ?? (p.bounce !== undefined ? 1 - p.bounce : 1);
  const omega0 = (2 * Math.PI) / Math.max(p.response, 1e-4);
  const stiffness = mass * omega0 * omega0;
  const damping = 2 * zeta * Math.sqrt(stiffness * mass);
  return { stiffness, damping, mass };
}

export function resolveConfig(p: SpringParams, rest?: Partial<Pick<SpringConfig, 'restVelocity' | 'restDisplacement'>>): SpringConfig {
  return {
    ...toPhysical(p),
    restVelocity: rest?.restVelocity ?? DEFAULT_REST_VELOCITY,
    restDisplacement: rest?.restDisplacement ?? DEFAULT_REST_DISPLACEMENT,
  };
}

/**
 * Precomputed coefficients for a given (params, dt). Cache these when many
 * springs share params and the ticker runs at a steady dt.
 */
export interface StepCoefficients {
  /** x_new = a*x + b*v ; v_new = c*x + d*v  (x = displacement from target) */
  a: number;
  b: number;
  c: number;
  d: number;
}

export function computeCoefficients(p: PhysicalParams, dt: number): StepCoefficients {
  const { stiffness: k, damping: c, mass: m } = p;
  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));
  const t = dt;

  if (zeta < 1) {
    // Underdamped
    const omegaD = omega0 * Math.sqrt(1 - zeta * zeta);
    const e = Math.exp(-zeta * omega0 * t);
    const cos = Math.cos(omegaD * t);
    const sin = Math.sin(omegaD * t);
    // x(t) = e (A cos + B sin), A = x0, B = (v0 + ζω0 x0) / ωd
    const za = zeta * omega0;
    const a = e * (cos + (za / omegaD) * sin);
    const b = e * (sin / omegaD);
    // v(t) = dx/dt
    const cCoef = e * (-(za * za) / omegaD - omegaD) * sin;
    const d = e * (cos - (za / omegaD) * sin);
    return { a, b, c: cCoef, d };
  }

  if (zeta === 1) {
    // Critically damped: x(t) = (A + B t) e^{-ω0 t}, A = x0, B = v0 + ω0 x0
    const e = Math.exp(-omega0 * t);
    const a = e * (1 + omega0 * t);
    const b = e * t;
    const cCoef = e * (-omega0 * omega0 * t);
    const d = e * (1 - omega0 * t);
    return { a, b, c: cCoef, d };
  }

  // Overdamped: x = A e^{r1 t} + B e^{r2 t}
  const s = Math.sqrt(zeta * zeta - 1);
  const r1 = -omega0 * (zeta - s);
  const r2 = -omega0 * (zeta + s);
  const e1 = Math.exp(r1 * t);
  const e2 = Math.exp(r2 * t);
  const inv = 1 / (r1 - r2);
  // A = (v0 - r2 x0) / (r1 - r2), B = x0 - A
  const a = (-r2 * e1 + r1 * e2) * inv;
  const b = (e1 - e2) * inv;
  const cCoef = (-r1 * r2 * e1 + r1 * r2 * e2) * inv;
  const d = (r1 * e1 - r2 * e2) * inv;
  return { a, b, c: cCoef, d };
}

export interface SpringState {
  value: number;
  velocity: number;
  target: number;
}

/** Advance a scalar spring by dt (seconds) in place. Returns true if still moving. */
export function stepSpring(s: SpringState, cfg: SpringConfig, dt: number, coef?: StepCoefficients): boolean {
  const k = coef ?? computeCoefficients(cfg, dt);
  const x = s.value - s.target;
  const v = s.velocity;
  const nx = k.a * x + k.b * v;
  const nv = k.c * x + k.d * v;
  if (Math.abs(nx) < cfg.restDisplacement && Math.abs(nv) < cfg.restVelocity) {
    s.value = s.target;
    s.velocity = 0;
    return false;
  }
  s.value = s.target + nx;
  s.velocity = nv;
  return true;
}

/** Convenience object wrapper around a single scalar spring. */
export class Spring implements SpringState {
  value: number;
  velocity = 0;
  target: number;
  config: SpringConfig;
  /** Sleeping springs are skipped by the ticker until retargeted or nudged. */
  sleeping = true;

  constructor(initial: number, params: SpringParams, rest?: Partial<Pick<SpringConfig, 'restVelocity' | 'restDisplacement'>>) {
    this.value = initial;
    this.target = initial;
    this.config = resolveConfig(params, rest);
  }

  setParams(params: SpringParams): this {
    this.config = { ...this.config, ...toPhysical(params) };
    return this;
  }

  /** Retarget. Never touches value or velocity — motion stays continuous. */
  setTarget(target: number): this {
    if (target !== this.target) {
      this.target = target;
      this.sleeping = false;
    }
    return this;
  }

  /** Inject velocity (fling, drag release). */
  addVelocity(dv: number): this {
    this.velocity += dv;
    this.sleeping = false;
    return this;
  }

  /** Jump instantly, no motion. */
  snap(value: number): this {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.sleeping = true;
    return this;
  }

  step(dt: number, coef?: StepCoefficients): boolean {
    if (this.sleeping) return false;
    const moving = stepSpring(this, this.config, dt, coef);
    this.sleeping = !moving;
    return moving;
  }
}
