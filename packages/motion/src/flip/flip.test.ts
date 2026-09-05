import { describe, expect, it } from 'vitest';
import { Ticker } from '../core/index.js';
import { Flight, Flip, applyFlipToDom, type Rect } from './index.js';

/** A fake element with a movable layout rect and a connected flag. */
class FakeEl {
  isConnected = true;
  style: Record<string, string> = {};
  constructor(public rect: Rect, public radius = 0) {}
  getBoundingClientRect() {
    // Mimic the browser: the rect INCLUDES our applied transform.
    const t = this.style.transform;
    let tx = 0, ty = 0, sx = 1, sy = 1;
    const m = t?.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0\) scale\(([-\d.]+), ([-\d.]+)\)/);
    if (m) { tx = +m[1]!; ty = +m[2]!; sx = +m[3]!; sy = +m[4]!; }
    return { left: this.rect.left + tx, top: this.rect.top + ty, width: this.rect.width * sx, height: this.rect.height * sy };
  }
}

const R = (left: number, top: number, width: number, height: number): Rect => ({ left, top, width, height });
const measure = (el: Element) => ((el as unknown as FakeEl).isConnected ? (el as unknown as FakeEl).getBoundingClientRect() : null);
const radius = (el: Element) => (el as unknown as FakeEl).radius;

function makeFlip(extra: Partial<ConstructorParameters<typeof Flip>[0]> = {}) {
  let now = 0;
  const scroll = { x: 0, y: 0 };
  const flip = new Flip({ now: () => now, measure, radius, scroll: () => scroll, ...extra });
  const tick = (n: number, dt = 1 / 60) => { for (let i = 0; i < n; i++) { now += dt * 1000; flip.step(dt); } };
  return { flip, tick, scroll, setNow: (t: number) => { now = t; } };
}

describe('Flight', () => {
  it('flies from a rect to a live target and lands exactly', () => {
    const dest = { rect: () => R(500, 300, 200, 100) as Rect | null, radius: () => 8 };
    const f = new Flight(R(0, 0, 100, 50), dest, { scroll: () => ({ x: 0, y: 0 }) });
    let frames = 0;
    while (!f.arrived && frames < 600) { f.step(1 / 60); frames++; }
    expect(f.arrived).toBe(true);
    expect(f.pose).toEqual(R(500, 300, 200, 100));
    expect(f.radius).toBe(8);
    expect(frames).toBeGreaterThan(20);
    expect(frames).toBeLessThan(200);
  });

  it('a moving destination is absorbed, not snapshotted', () => {
    let target = R(500, 0, 100, 100);
    const f = new Flight(R(0, 0, 100, 100), { rect: () => target }, { scroll: () => ({ x: 0, y: 0 }) });
    for (let i = 0; i < 10; i++) f.step(1 / 60);
    const v = f.set.velocities[0]!;
    target = R(-300, 0, 100, 100); // reverse
    f.step(1 / 60);
    // Momentum carries: still moving right for a moment, but decelerating.
    expect(f.set.velocities[0]).toBeGreaterThan(0);
    expect(f.set.velocities[0]).toBeLessThan(v);
    while (!f.arrived) f.step(1 / 60);
    expect(f.pose.left).toBe(-300);
  });

  it('scroll shifts the value, not the gap — the flight lands on schedule', () => {
    const scroll = { x: 0, y: 0 };
    let doc = R(0, 1000, 100, 100); // document space
    const live = () => R(doc.left - scroll.x, doc.top - scroll.y, doc.width, doc.height);
    const f = new Flight(R(0, 0, 100, 100), { rect: live }, { scroll: () => scroll });
    f.step(1 / 60);
    const gap = f.set.targets[1]! - f.set.values[1]!;
    scroll.y = 400;                 // page scrolls 400 px between frames
    f.step(1 / 60);
    const gapAfter = f.set.targets[1]! - f.set.values[1]!;
    // Gap changed only by one frame of spring progress, not by the scroll.
    expect(Math.abs(gapAfter - gap)).toBeLessThan(Math.abs(gap) * 0.2);
    expect(f.pose.top).toBeLessThan(0); // the plane rode the page up
  });

  it('a dead target freezes and the flight glides to a stop there', () => {
    let alive = true;
    const f = new Flight(R(0, 0, 100, 100), { rect: () => (alive ? R(400, 0, 100, 100) : null) }, { scroll: () => ({ x: 0, y: 0 }) });
    for (let i = 0; i < 5; i++) f.step(1 / 60);
    alive = false;
    let moving = true;
    for (let i = 0; i < 600 && moving; i++) moving = f.step(1 / 60);
    expect(moving).toBe(false);
    expect(f.pose.left).toBe(400);
    expect(f.arrived).toBe(false); // never arrived on a LIVE target
  });
});

describe('Flip registry', () => {
  it('settled entries mirror their element every frame', () => {
    const { flip, tick } = makeFlip();
    const el = new FakeEl(R(10, 20, 100, 50));
    flip.register('a', el as never);
    expect(flip.pose('a')).toEqual(R(10, 20, 100, 50));
    el.rect = R(30, 20, 100, 50);
    tick(1);
    expect(flip.pose('a')).toEqual(R(30, 20, 100, 50));
    expect(flip.flying).toBe(0);
  });

  it('hold → claim flies from the frozen rect to the new element and lands', () => {
    const { flip, tick } = makeFlip();
    const card = new FakeEl(R(0, 0, 100, 100), 4);
    flip.register('hero', card as never, { offer: ['case'] });
    tick(2);

    expect(flip.candidates('case')).toEqual(['hero']);
    expect(flip.candidates('home')).toEqual([]);

    flip.hold('hero');
    card.isConnected = false;    // page torn down
    tick(3);
    expect(flip.pose('hero')).toEqual(R(0, 0, 100, 100)); // frozen, still alive

    const hero = new FakeEl(R(200, 300, 400, 250), 16);
    const e = flip.register('hero', hero as never);
    expect(e.el).toBe(hero);
    expect(e.flight).not.toBeNull();
    tick(1);
    expect(flip.pose('hero')!.left).toBeGreaterThan(0);
    expect(flip.pose('hero')!.left).toBeLessThan(200);

    tick(300);
    expect(e.flight).toBeNull();
    expect(flip.pose('hero')).toEqual(R(200, 300, 400, 250));
    expect(e.radius).toBe(16);
  });

  it('interrupting a flight with a hold then a new claim continues from the live pose with velocity', () => {
    const { flip, tick } = makeFlip();
    const a = new FakeEl(R(0, 0, 100, 100));
    flip.register('x', a as never, { offer: true });
    tick(1);
    flip.hold('x');
    a.isConnected = false;
    const b = new FakeEl(R(600, 0, 100, 100));
    const e = flip.register('x', b as never);
    tick(8);
    const midPose = { ...e.pose! };
    const vel = e.flight!.set.velocities[0];
    expect(vel).toBeGreaterThan(0);

    // Interrupt: navigate again before arrival.
    flip.hold('x');
    b.isConnected = false;
    tick(1); // frozen target: still moving, pose advanced by its own momentum
    expect(e.pose!.left).toBeGreaterThan(midPose.left);

    const c = new FakeEl(R(-200, 0, 100, 100));
    flip.register('x', c as never);
    expect(e.flight!.set.velocities[0]).toBeCloseTo(e.flight!.set.velocities[0]!); // untouched by attach
    const beforeLeft = e.pose!.left;
    tick(1);
    expect(e.pose!.left).toBeGreaterThan(beforeLeft); // still carrying rightward momentum
    tick(400);
    expect(e.flight).toBeNull();
    expect(e.pose).toEqual(R(-200, 0, 100, 100));
  });

  it('an unclaimed hold expires and the entry retires', () => {
    const retired: string[] = [];
    const { flip, tick } = makeFlip({ onRetire: (e) => retired.push(e.id) });
    const el = new FakeEl(R(0, 0, 10, 10));
    flip.register('h', el as never, { offer: true });
    tick(1);
    flip.hold('h', 500);
    el.isConnected = false;
    tick(10);
    expect(flip.get('h')).not.toBeNull();
    flip.expireHolds();
    tick(1);
    expect(flip.get('h')).toBeNull();
    expect(retired).toEqual(['h']);
  });

  it('an unheld element that leaves the document retires; a newborn gets grace', () => {
    const { flip, tick } = makeFlip();
    const el = new FakeEl(R(0, 0, 10, 10));
    flip.register('a', el as never);
    tick(1);
    el.isConnected = false;
    tick(1);
    expect(flip.get('a')).toBeNull();

    const unborn = new FakeEl(R(0, 0, 10, 10));
    unborn.isConnected = false;
    flip.register('b', unborn as never);
    tick(10);
    expect(flip.get('b')).not.toBeNull();
    unborn.isConnected = true;
    tick(1);
    expect(flip.pose('b')).toEqual(R(0, 0, 10, 10));
  });

  it('play() after a layout change flies settled entries from their previous pose', () => {
    const { flip, tick } = makeFlip();
    const els = [new FakeEl(R(0, 0, 100, 100)), new FakeEl(R(120, 0, 100, 100)), new FakeEl(R(240, 0, 100, 100))];
    els.forEach((el, i) => flip.register(`c${i}`, el as never));
    tick(2);

    const started = flip.mutate(() => {
      // "row" → "column"
      els[0]!.rect = R(0, 0, 100, 100);
      els[1]!.rect = R(0, 120, 100, 100);
      els[2]!.rect = R(0, 240, 100, 100);
    });
    expect(started).toBe(2);
    expect(flip.flying).toBe(2);
    const e2 = flip.get('c2')!;
    expect(e2.pose).toEqual(R(240, 0, 100, 100)); // still at the FIRST rect this frame
    tick(1);
    expect(e2.pose!.left).toBeLessThan(240);
    expect(e2.pose!.top).toBeGreaterThan(0);
    tick(400);
    expect(flip.flying).toBe(0);
    expect(e2.pose).toEqual(R(0, 240, 100, 100));
  });

  it('a second layout change mid-flight retargets without a discontinuity', () => {
    const { flip, tick } = makeFlip();
    const el = new FakeEl(R(0, 0, 100, 100));
    flip.register('a', el as never);
    tick(1);
    flip.mutate(() => { el.rect = R(500, 0, 100, 100); });
    tick(10);
    const e = flip.get('a')!;
    const p = { ...e.pose! };
    const v = e.flight!.set.velocities[0];
    flip.mutate(() => { el.rect = R(0, 500, 100, 100); });
    expect(e.pose).toEqual(p);
    expect(e.flight!.set.velocities[0]).toBe(v);
    tick(1);
    expect(e.pose!.left).toBeGreaterThan(p.left); // momentum carries
    tick(400);
    expect(e.pose).toEqual(R(0, 500, 100, 100));
  });
});

describe('applyFlipToDom', () => {
  it('writes an inverting transform while flying and clears it on landing', () => {
    const { flip, tick } = makeFlip();
    const ticker = new Ticker();
    ticker.add(flip);
    applyFlipToDom(flip, ticker);
    const el = new FakeEl(R(0, 0, 100, 100), 10);
    const e = flip.register('a', el as never);
    ticker.tick(1 / 60);
    expect(el.style.transform).toBeUndefined();

    flip.mutate(() => { el.rect = R(200, 0, 200, 200); });
    ticker.tick(1 / 60);
    expect(el.style.transform).toMatch(/^translate3d\(-/); // pulled back toward the old spot
    expect(el.style.transformOrigin).toBe('0 0');
    expect(el.style.zIndex).toBe('100');
    expect(e.applied).not.toBeNull();
    // The registry measured THROUGH the transform and recovered the layout rect.
    expect(e.layout).toEqual(R(200, 0, 200, 200));

    for (let i = 0; i < 400; i++) ticker.tick(1 / 60);
    expect(e.flight).toBeNull();
    expect(el.style.transform).toBe('');
    expect(el.style.zIndex).toBe('');
    expect(e.applied).toBeNull();
    void tick;
  });
});
