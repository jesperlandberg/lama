import { describe, expect, it } from 'vitest';
import { Spring, SpringSet, Ticker } from '../core/index.js';
import { DomAdapter, bindDrag, bindPointer, bindStates } from './index.js';

/** Minimal element stand-in: an EventTarget with a style bag. */
class FakeEl extends EventTarget {
  style: Record<string, string> = {};
  captured: number[] = [];
  setPointerCapture(id: number) { this.captured.push(id); }
}

function fire(el: EventTarget, type: string, props: Record<string, unknown> = {}) {
  const e = new Event(type);
  Object.assign(e, { pointerId: 1, pointerType: 'mouse', clientX: 0, clientY: 0 }, props);
  el.dispatchEvent(e);
}

const params = { response: 0.3, dampingRatio: 0.8 };

describe('DomAdapter', () => {
  it('writes a composed transform and stops writing once settled', () => {
    const ticker = new Ticker({ fixedDt: 1 / 60 });
    const dom = new DomAdapter(ticker);
    const el = new FakeEl();
    const x = new Spring(0, params), scale = new Spring(1, params);
    ticker.add(x); ticker.add(scale);
    dom.transform(el as never, { x, scale });

    expect(el.style.transform).toBe('translate3d(0px, 0px, 0) scale(1, 1)');

    x.setTarget(100); scale.setTarget(1.2);
    for (let i = 0; i < 300; i++) ticker.tick(1 / 60);
    expect(el.style.transform).toBe('translate3d(100px, 0px, 0) scale(1.2, 1.2)');

    // Settled: a foreign write survives because the adapter no longer touches it.
    el.style.transform = 'marker';
    ticker.tick(1 / 60);
    expect(el.style.transform).toBe('marker');
  });

  it('drives many elements from one SpringSet', () => {
    const ticker = new Ticker();
    const dom = new DomAdapter(ticker);
    const els = [new FakeEl(), new FakeEl(), new FakeEl()];
    const set = new SpringSet(3, 3, params);
    for (let i = 0; i < 3; i++) set.snap(i, 0, 0, 1);
    ticker.add(set);
    dom.setTransforms(els as never, set, { x: 0, y: 1, scale: 2 });
    set.setTargets(1, 50, -20, 0.5);
    for (let i = 0; i < 300; i++) ticker.tick(1 / 60);
    expect(els[1]!.style.transform).toBe('translate3d(50px, -20px, 0) scale(0.5, 0.5)');
    expect(els[0]!.style.transform).toBe('translate3d(0px, 0px, 0) scale(1, 1)');
  });

  it('writes custom properties via setProperty when available', () => {
    const ticker = new Ticker();
    const dom = new DomAdapter(ticker);
    const props: Record<string, string> = {};
    const el = { style: { setProperty: (k: string, v: string) => { props[k] = v; } } };
    const s = new Spring(0.5, params);
    dom.style(el as never, '--p', s);
    expect(props['--p']).toBe('0.5');
  });
});

describe('pointer bindings', () => {
  it('bindStates: press wins over hover, hover over rest, and only retargets', () => {
    const el = new FakeEl();
    const s = new Spring(1, params);
    bindStates(el, s, { rest: 1, hover: 1.1, press: 0.9 });
    expect(s.target).toBe(1);

    fire(el, 'pointerenter');
    expect(s.target).toBe(1.1);
    s.step(1 / 60);
    const v = s.value, vel = s.velocity;

    fire(el, 'pointerdown');
    expect(s.target).toBe(0.9);
    expect(s.value).toBe(v);       // no snap
    expect(s.velocity).toBe(vel);  // no reset
    expect(el.captured).toEqual([1]);

    fire(el, 'pointerup');
    expect(s.target).toBe(1.1);   // still hovering
    fire(el, 'pointerleave');
    expect(s.target).toBe(1);
  });

  it('ignores touch hover by default', () => {
    const el = new FakeEl();
    const states: boolean[] = [];
    bindPointer(el, (s) => states.push(s.hover));
    fire(el, 'pointerenter', { pointerType: 'touch' });
    expect(states).toEqual([]);
    fire(el, 'pointerenter', { pointerType: 'mouse' });
    expect(states).toEqual([true]);
  });

  it('unbind removes listeners', () => {
    const el = new FakeEl();
    const s = new Spring(1, params);
    const off = bindStates(el, s, { rest: 1, hover: 2 });
    off();
    fire(el, 'pointerenter');
    expect(s.target).toBe(1);
  });
});

describe('bindDrag', () => {
  it('follows the pointer via setTarget, then hands off velocity on release', () => {
    let t = 0;
    const el = new FakeEl();
    const x = new Spring(0, params);
    bindDrag(el, { x, now: () => t, threshold: 0 });
    expect(el.style.touchAction).toBe('pan-y');

    fire(el, 'pointerdown', { clientX: 10 });
    // 500 px/s to the right over 100 ms
    for (let i = 1; i <= 6; i++) {
      t = i * (1 / 60);
      fire(el, 'pointermove', { clientX: 10 + 500 * t });
      x.step(1 / 60);
    }
    expect(x.target).toBeCloseTo(500 * t, 6);
    expect(x.value).toBeGreaterThan(0);
    expect(x.value).toBeLessThan(x.target); // spring lags — that's the weight

    const before = x.target;
    fire(el, 'pointerup', { clientX: 10 + 500 * t });
    expect(x.velocity).toBeCloseTo(500, 0);            // exact pointer velocity
    expect(x.target).toBeGreaterThan(before);          // fling projected past the drop
    expect(x.target).toBeCloseTo(before + 500 * 0.499, 0);
  });

  it('clamps the release target to bounds and rubberbands during the drag', () => {
    let t = 0;
    const el = new FakeEl();
    const x = new Spring(0, params);
    bindDrag(el, { x, now: () => t, threshold: 0, bounds: { minX: 0, maxX: 100 }, rubberband: 0.5, fling: false });
    fire(el, 'pointerdown', { clientX: 0 });
    t = 0.05;
    fire(el, 'pointermove', { clientX: 200 });
    expect(x.target).toBe(150); // 100 + (200-100)*0.5
    fire(el, 'pointerup', { clientX: 200 });
    expect(x.target).toBe(100);
  });

  it('accept() can refuse a gesture at pointerdown', () => {
    const el = new FakeEl();
    const x = new Spring(0, params);
    bindDrag(el, { x, now: () => 0, threshold: 0, accept: (e) => e.clientY > 100 });
    fire(el, 'pointerdown', { clientX: 0, clientY: 10 });
    fire(el, 'pointermove', { clientX: 50, clientY: 10 });
    fire(el, 'pointerup', { clientX: 50, clientY: 10 });
    expect(x.target).toBe(0);
    fire(el, 'pointerdown', { clientX: 0, clientY: 200 });
    fire(el, 'pointermove', { clientX: 50, clientY: 200 });
    expect(x.target).toBe(50);
  });

  it('axis lock moves only the dominant axis, and axisScale inverts', () => {
    const el = new FakeEl();
    const x = new Spring(0, params), y = new Spring(0, params);
    const axes: (string | null)[] = [];
    bindDrag(el, { x, y, lock: true, axisScale: { y: -1 }, now: () => 0, threshold: 0, onStart: (a) => axes.push(a) });
    // mostly vertical: only y moves, inverted
    fire(el, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(el, 'pointermove', { clientX: 5, clientY: 40 });
    expect(x.target).toBe(0);
    expect(y.target).toBe(-40);
    fire(el, 'pointerup', { clientX: 5, clientY: 40 });
    // mostly horizontal: only x moves
    fire(el, 'pointerdown', { clientX: 0, clientY: 0 });
    fire(el, 'pointermove', { clientX: 50, clientY: 3 });
    expect(x.target).toBe(50);
    fire(el, 'pointerup', { clientX: 50, clientY: 3 });
    expect(axes).toEqual(['y', 'x']);
  });

  it('a tap under the threshold does nothing', () => {
    const el = new FakeEl();
    const x = new Spring(0, params);
    bindDrag(el, { x, now: () => 0 });
    fire(el, 'pointerdown', { clientX: 0 });
    fire(el, 'pointermove', { clientX: 1 });
    fire(el, 'pointerup', { clientX: 1 });
    expect(x.target).toBe(0);
    expect(x.velocity).toBe(0);
  });
});
