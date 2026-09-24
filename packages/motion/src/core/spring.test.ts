import { describe, expect, it } from 'vitest';
import { Spring, SpringSet, Ticker, computeCoefficients, stepSpring, toPhysical, resolveConfig } from './index.js';

const params = { response: 0.4, dampingRatio: 0.7 };

function run(s: Spring, seconds: number, dt: number) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s.step(dt);
}

describe('closed-form step', () => {
  it('is dt-independent: one big step equals many small steps', () => {
    for (const zeta of [0.5, 1, 1.5]) {
      const cfg = resolveConfig({ response: 0.5, dampingRatio: zeta });
      const a = { value: 100, velocity: -40, target: 0 };
      const b = { value: 100, velocity: -40, target: 0 };
      stepSpring(a, cfg, 0.2);
      for (let i = 0; i < 20; i++) stepSpring(b, cfg, 0.01);
      expect(a.value).toBeCloseTo(b.value, 6);
      expect(a.velocity).toBeCloseTo(b.velocity, 6);
    }
  });

  it('coefficients are continuous across the critically damped boundary', () => {
    const p = toPhysical({ response: 0.5, dampingRatio: 1 });
    const under = computeCoefficients({ ...p, damping: p.damping * 0.9999 }, 1 / 60);
    const crit = computeCoefficients(p, 1 / 60);
    const over = computeCoefficients({ ...p, damping: p.damping * 1.0001 }, 1 / 60);
    for (const k of ['a', 'b', 'c', 'd'] as const) {
      expect(under[k]).toBeCloseTo(crit[k], 4);
      expect(over[k]).toBeCloseTo(crit[k], 4);
    }
  });
});

describe('Spring', () => {
  it('settles at target and sleeps', () => {
    const s = new Spring(0, params);
    s.setTarget(1);
    run(s, 3, 1 / 60);
    expect(s.value).toBe(1);
    expect(s.velocity).toBe(0);
    expect(s.sleeping).toBe(true);
  });

  it('retargeting mid-flight preserves value and velocity (no discontinuity)', () => {
    const s = new Spring(0, params);
    s.setTarget(1);
    run(s, 0.1, 1 / 60);
    const v = s.value, vel = s.velocity;
    expect(Math.abs(vel)).toBeGreaterThan(0);

    s.setTarget(-1); // reverse direction while moving
    expect(s.value).toBe(v);
    expect(s.velocity).toBe(vel);

    // Next frame continues in the old direction: velocity carries through.
    const dt = 1 / 60;
    s.step(dt);
    expect(s.value).toBeGreaterThan(v);            // still moving toward old target
    expect(s.value - v).toBeLessThan(vel * dt);    // but decelerating toward the new one
    expect(s.velocity).toBeLessThan(vel);
  });

  it('addVelocity wakes a sleeping spring and produces motion away from target', () => {
    const s = new Spring(0, params);
    expect(s.sleeping).toBe(true);
    s.addVelocity(5);
    expect(s.sleeping).toBe(false);
    s.step(1 / 60);
    expect(s.value).toBeGreaterThan(0);
    run(s, 3, 1 / 60);
    expect(s.value).toBe(0);
    expect(s.sleeping).toBe(true);
  });

  it('underdamped overshoots, critically damped does not', () => {
    const bouncy = new Spring(0, { response: 0.4, dampingRatio: 0.3 }).setTarget(1);
    const crit = new Spring(0, { response: 0.4, dampingRatio: 1 }).setTarget(1);
    let maxB = 0, maxC = 0;
    for (let i = 0; i < 180; i++) {
      bouncy.step(1 / 60); crit.step(1 / 60);
      maxB = Math.max(maxB, bouncy.value);
      maxC = Math.max(maxC, crit.value);
    }
    expect(maxB).toBeGreaterThan(1.05);
    expect(maxC).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('snap jumps with no motion', () => {
    const s = new Spring(0, params).setTarget(1);
    run(s, 0.1, 1 / 60);
    s.snap(5);
    expect(s.value).toBe(5);
    expect(s.velocity).toBe(0);
    expect(s.sleeping).toBe(true);
  });
});

describe('SpringSet', () => {
  it('matches scalar Spring results channel-for-channel', () => {
    const set = new SpringSet(3, 2, params);
    const scalars = Array.from({ length: 6 }, () => new Spring(0, params));
    set.setTargets(1, 10, -4);
    scalars[2]!.setTarget(10);
    scalars[3]!.setTarget(-4);
    for (let f = 0; f < 60; f++) {
      set.step(1 / 60);
      for (const s of scalars) s.step(1 / 60);
    }
    expect(set.get(1, 0)).toBeCloseTo(scalars[2]!.value, 4);
    expect(set.get(1, 1)).toBeCloseTo(scalars[3]!.value, 4);
    expect(set.get(0, 0)).toBe(0);
  });

  it('tracks active count and sleeps settled springs', () => {
    const set = new SpringSet(100, 3, params);
    expect(set.active).toBe(0);
    set.setTargets(7, 1, 2, 3);
    set.setTargets(42, 1, 1, 1);
    expect(set.active).toBe(2);
    for (let f = 0; f < 300; f++) set.step(1 / 60);
    expect(set.active).toBe(0);
    expect(set.awake[7]).toBe(0);
    expect(set.get(7, 2)).toBe(3);
  });

  it('retarget only writes targets, never values', () => {
    const set = new SpringSet(1, 1, params);
    set.setTarget(0, 0, 1);
    for (let f = 0; f < 5; f++) set.step(1 / 60);
    const v = set.values[0], vel = set.velocities[0];
    set.setTarget(0, 0, -3);
    expect(set.values[0]).toBe(v);
    expect(set.velocities[0]).toBe(vel);
  });

  it('settles at large coordinates, where a float32 step is wider than the rest threshold', () => {
    // 1500 px is enough: the gap between neighbouring float32 values there is
    // 0.00012, so the last fraction of a pixel rounds away and an absolute
    // 0.001 threshold is never met. It used to stay awake for ever.
    for (const target of [1500, 10000, 65536]) {
      const set = new SpringSet(1, 1, { response: 0.5 });
      set.setTarget(0, 0, target);
      let frames = 0;
      while (set.active > 0 && frames < 3600) { set.step(1 / 60); frames++; }
      expect(set.active).toBe(0);
      expect(set.get(0, 0)).toBe(target);
      expect(frames).toBeLessThan(200);
    }
  });

  it('a partial snap places the channels it was given and leaves the rest moving', () => {
    const set = new SpringSet(1, 2, params);
    set.setTargets(0, 10, 20);
    set.step(1 / 60);
    set.snap(0, 5);
    expect(set.get(0, 0)).toBe(5);
    expect(set.active).toBe(1);
    for (let f = 0; f < 600; f++) set.step(1 / 60);
    expect(set.get(0, 1)).toBe(20);
    expect(set.get(0, 0)).toBe(5);
  });

  it('revision marks the frames that changed a value', () => {
    const set = new SpringSet(1, 1, params);
    const asleep = set.revision;
    set.step(1 / 60);
    expect(set.revision).toBe(asleep);   // nothing awake, nothing written
    set.setTarget(0, 0, 1);
    expect(set.revision).toBe(asleep);   // a target is not a value
    set.step(1 / 60);
    expect(set.revision).toBeGreaterThan(asleep);
    let frames = 0;
    while (set.active > 0 && frames < 600) { set.step(1 / 60); frames++; }
    const landed = set.revision;
    set.step(1 / 60);
    expect(set.revision).toBe(landed);   // settled: no upload to do
    set.snap(0, 5);
    expect(set.revision).toBeGreaterThan(landed); // a snap while asleep still moved it
  });

  it('survives a storm of retargets, injections and jittery dt, and still comes to rest', () => {
    // The whole contract in one test: whatever order interactions arrive in,
    // a spring is only ever state, so nothing can be left NaN, adrift, or
    // awake with nowhere to go.
    const set = new SpringSet(50, 3, { response: 0.4, bounce: 0.3 });
    let seed = 1;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let f = 0; f < 600; f++) {
      for (let k = 0; k < 5; k++) {
        const i = Math.floor(rnd() * 50);
        if (rnd() < 0.5) set.setTargets(i, (rnd() - 0.5) * 4000, (rnd() - 0.5) * 4000, rnd() * 2);
        else set.addVelocity(i, Math.floor(rnd() * 3), (rnd() - 0.5) * 5000);
      }
      set.step(1 / 60 + (rnd() - 0.5) / 500); // rAF never hands over the same dt twice
    }
    let frames = 0;
    while (set.active > 0 && frames < 3600) { set.step(1 / 60); frames++; }
    expect(set.active).toBe(0);
    expect(frames).toBeLessThan(600);
    for (let i = 0; i < set.values.length; i++) {
      expect(Number.isFinite(set.values[i]!)).toBe(true);
      expect(set.values[i]).toBe(set.targets[i]);
      expect(set.velocities[i]).toBe(0);
    }
  });

  it('wake() lets a consumer that wrote the arrays itself rejoin the loop', () => {
    const set = new SpringSet(1, 1, params);
    set.velocities[0] = 100;
    expect(set.active).toBe(0);
    set.wake(0);
    expect(set.active).toBe(1);
    set.step(1 / 60);
    expect(set.get(0, 0)).toBeGreaterThan(0);
  });
});

describe('guards', () => {
  it('refuse the numbers that would poison a spring for good', () => {
    const s = new Spring(0, params);
    expect(() => s.setTarget(NaN)).toThrow(RangeError);
    expect(() => s.addVelocity(Infinity)).toThrow(RangeError);
    expect(() => s.snap(NaN)).toThrow(RangeError);
    expect(s.value).toBe(0);
    expect(s.target).toBe(0);
  });

  it('refuse params with no physics in them', () => {
    expect(() => new Spring(0, { response: 0 })).toThrow(RangeError);
    expect(() => new Spring(0, { response: 0.4, bounce: 1.5 })).toThrow(RangeError);   // negative damping
    expect(() => new Spring(0, { stiffness: 100, damping: 10, mass: 0 })).toThrow(RangeError);
    expect(() => new SpringSet(4, 2, { response: NaN })).toThrow(RangeError);
  });

  it('refuse a batch index that would address another spring', () => {
    const set = new SpringSet(2, 2, params);
    expect(() => set.setTarget(2, 0, 1)).toThrow(RangeError);
    expect(() => set.setTarget(0, 2, 1)).toThrow(RangeError);
    expect(() => set.addVelocity(-1, 0, 1)).toThrow(RangeError);
    expect(() => set.setTargets(0, NaN, 1)).toThrow(RangeError);
    expect(() => set.get(0, 5)).toThrow(RangeError);
  });

  it('a non-finite dt never reaches the springs', () => {
    const ticker = new Ticker();
    const s = new Spring(0, params).setTarget(1);
    ticker.add(s);
    ticker.tick(NaN);
    expect(s.value).toBe(0);          // a dt of nothing moves nothing
    ticker.tick(1 / 60);
    expect(s.value).toBeGreaterThan(0);
  });
});
