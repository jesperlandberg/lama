/*
 * @lama/motion — retargetable, velocity-preserving spring motion for the
 * DOM and for WebGL/WebGPU.
 *
 * A spring here is state, not a timeline: `{ value, velocity, target }`. An
 * interaction only ever writes a new target or injects velocity; nothing is
 * cancelled and nothing restarts, so hover → press → release → layout shift
 * blend into one continuous motion. The step is the damped harmonic
 * oscillator solved in closed form — given the current state and a dt it
 * returns the exact state dt later — which is what lets a target, or the
 * params themselves, change between any two frames without a jump, and
 * makes one big step equal many small ones.
 *
 * ── Three layers ──
 *
 * `core` is the model. `Spring` is one scalar; `SpringSet` is N springs × C
 * channels in Float32Arrays, structure-of-arrays, so `values` can go to a
 * GPU buffer write as it is; `Ticker` is one loop with two phases — every
 * steppable steps, then every writer writes, so a frame's layout reads come
 * before its style writes; `VelocityTracker` and `projectFling` are a
 * pointer's speed and how far a fling carries at UIKit's deceleration.
 *
 * `dom` is a write side and some bindings. `DomAdapter` reads springs in the
 * write phase and writes transform, opacity, or any property — only on
 * frames where a spring moved and once more after it settles, so a settled
 * page costs no style writes. `bindStates` resolves hover and press to one
 * target (press wins over hover, hover over rest). `bindDrag` makes the
 * pointer's offset the target every move and, on release, hands the
 * finger's velocity to the spring and aims at the projected fling, clamped
 * to bounds: the release is the same motion continued.
 *
 * `flip` is a registry of elements by id. A flight is five springs (x, y,
 * w, h, radius) toward a destination RE-READ from the live element every
 * frame: a retarget is the target reading differently, late layout and
 * resize are absorbed frame by frame, scroll shifts the value rather than
 * the target so a flight lands on schedule mid-scroll, and a destination
 * that dies freezes where it stood. `hold` keeps an entry alive past its
 * element's death and `register` under the same id claims it — the handoff
 * across a page transition. `applyFlipToDom` is one writer of the poses; a
 * GL layer reads the same `entry.pose`.
 *
 * ── What is left alone ──
 *
 * No easing curves, timelines or keyframes: a spring's params are the whole
 * vocabulary. No GL adapter ships — the `SpringSet` arrays and the flip
 * poses are the interface, and the consumer's layer does the drawing. The
 * scroll position is read, never owned. Reduced motion is the caller's
 * decision (`snap` is instant). Gestures stop at hover, press and drag;
 * pinch and rotate are not here. `applyFlipToDom` owns `transform`,
 * `transform-origin`, `border-radius` and `z-index` while an element flies,
 * and a transform the author put there is not composed with.
 */

export * from './core/index.js';
export * from './dom/index.js';
export * from './flip/index.js';
