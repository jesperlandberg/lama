import { describe, expect, it } from 'vitest';
import { Spring, SpringSet, computeCoefficients, stepSpring, toPhysical, resolveConfig } from './index.js';

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
});
