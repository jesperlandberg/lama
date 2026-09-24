/**
 * Guards for the few places a caller hands numbers in. None of them run
 * inside the step, so they cost nothing per frame.
 *
 * They exist because a NaN never washes out of a spring. It lands in `value`,
 * multiplies through the next step into `velocity`, and every frame after is
 * NaN — the element vanishes, and nothing in the state says where it came
 * from. A zero mass or a negative damping ratio is the same story one step
 * earlier: the coefficients come out NaN, or the spring feeds itself energy
 * and runs away. Better a stack trace at the call site than a frozen page.
 *
 * Not exported from the package: these are the package's own bouncers.
 */

export function finite(value: number, what: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`@lama/motion: ${what} must be a finite number (got ${value})`);
  return value;
}

export function positive(value: number, what: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`@lama/motion: ${what} must be a finite number above 0 (got ${value})`);
  return value;
}

export function nonNegative(value: number, what: string): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`@lama/motion: ${what} must be a finite number of 0 or more (got ${value})`);
  return value;
}

export function positiveInt(value: number, what: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`@lama/motion: ${what} must be a whole number above 0 (got ${value})`);
  return value;
}

/** An index into a batch. Out of range would silently address another spring's channel. */
export function index(value: number, count: number, what: string): number {
  if (!Number.isInteger(value) || value < 0 || value >= count) {
    throw new RangeError(`@lama/motion: ${what} must be an integer in [0, ${count}) (got ${value})`);
  }
  return value;
}
