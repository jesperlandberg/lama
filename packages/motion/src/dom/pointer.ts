import type { Spring } from '../core/spring.js';

/**
 * Hover / press bindings. They own no motion: every interaction resolves to a
 * single target and calls `setTarget`. Because the spring is state, a press
 * that lands mid-hover-flight or a release that comes before the press
 * settled just retargets — the motions blend instead of restarting.
 */

export interface PointerState {
  hover: boolean;
  press: boolean;
}

export interface PointerOptions {
  /** Track hover (pointerenter/leave). Default true. */
  hover?: boolean;
  /** Track press (pointerdown/up/cancel). Default true. */
  press?: boolean;
  /** Treat touch pointers as hover-capable. Default false — touch hover sticks. */
  touchHover?: boolean;
}

/** The subset of HTMLElement the bindings use — lets tests pass a stub. */
export type PointerTarget = EventTarget & {
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
};

type PE = Event & { pointerId?: number; pointerType?: string };

/**
 * Low-level: report hover/press state changes. Press is tracked with pointer
 * capture, so a release outside the element still ends the press.
 */
export function bindPointer(el: PointerTarget, onChange: (state: PointerState) => void, opts: PointerOptions = {}): () => void {
  const trackHover = opts.hover ?? true;
  const trackPress = opts.press ?? true;
  const state: PointerState = { hover: false, press: false };
  let pressId = -1;

  const emit = () => onChange({ hover: state.hover, press: state.press });

  const enter = (e: Event) => {
    if (!opts.touchHover && (e as PE).pointerType === 'touch') return;
    if (state.hover) return;
    state.hover = true;
    emit();
  };
  const leave = () => {
    if (!state.hover) return;
    state.hover = false;
    emit();
  };
  const down = (e: Event) => {
    if (state.press) return;
    const id = (e as PE).pointerId ?? 0;
    pressId = id;
    try { el.setPointerCapture?.(id); } catch { /* not capturable */ }
    state.press = true;
    emit();
  };
  const up = (e: Event) => {
    if (!state.press) return;
    const id = (e as PE).pointerId ?? 0;
    if (id !== pressId) return;
    pressId = -1;
    state.press = false;
    emit();
  };

  if (trackHover) {
    el.addEventListener('pointerenter', enter);
    el.addEventListener('pointerleave', leave);
  }
  if (trackPress) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  return () => {
    el.removeEventListener('pointerenter', enter);
    el.removeEventListener('pointerleave', leave);
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
    el.removeEventListener('pointercancel', up);
  };
}

export interface StateTargets {
  rest: number;
  hover?: number;
  press?: number;
}

/**
 * Retarget one spring from pointer state: press wins over hover, hover over
 * rest. Omit `hover` or `press` to ignore that state.
 *
 *   bindStates(el, scale, { rest: 1, hover: 1.05, press: 0.95 })
 */
export function bindStates(el: PointerTarget, spring: Spring, targets: StateTargets, opts: PointerOptions = {}): () => void {
  spring.setTarget(targets.rest);
  return bindPointer(
    el,
    (s) => {
      if (s.press && targets.press !== undefined) spring.setTarget(targets.press);
      else if (s.hover && targets.hover !== undefined) spring.setTarget(targets.hover);
      else spring.setTarget(targets.rest);
    },
    { hover: targets.hover !== undefined, press: targets.press !== undefined, ...opts },
  );
}

/** Hover only. */
export function bindHover(el: PointerTarget, spring: Spring, rest: number, hover: number, opts?: PointerOptions): () => void {
  return bindStates(el, spring, { rest, hover }, opts);
}

/** Press only. */
export function bindPress(el: PointerTarget, spring: Spring, rest: number, press: number, opts?: PointerOptions): () => void {
  return bindStates(el, spring, { rest, press }, opts);
}
