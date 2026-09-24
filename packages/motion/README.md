# @lama/motion

Spring motion for the DOM and for WebGL/WebGPU, built on one idea: a spring is
**state** — `{ value, velocity, target }` — not a timeline.

An interaction never starts an animation. It writes a new `target`, or adds
velocity, and the spring carries on from wherever it is at the speed it already
has. Nothing is cancelled and nothing restarts, so hover → press → release → a
layout shift blend into one continuous motion, and a drag let go onto a spring
keeps the speed of the finger.

The step is the damped harmonic oscillator solved in closed form: given the
state and a `dt`, it returns the exact state `dt` seconds later. That is what
lets a target — or the params themselves — change between any two frames
without a jump, and what makes one big step equal to many small ones, so the
motion does not depend on the frame rate.

Springs never know about elements. Writers read their numbers once a frame: the
DOM adapter here is one, a WebGL/WebGPU layer is another, and switching between
them never touches the motion.

- **core** — `Spring`; `SpringSet`, N springs × C channels in `Float32Array`s,
  ready for a GPU buffer; `Ticker`, one loop that steps and then writes;
  `VelocityTracker` and `projectFling`. No DOM.
- **dom** — `DomAdapter` writes transform, opacity or any property, and only
  when a value changed; `bindStates` resolves hover and press to one target;
  `bindDrag` drags, and on release hands the finger's velocity to the spring.
- **flip** — `Flip`, a FLIP registry whose flights re-read their destination
  every frame, and `applyFlipToDom` to write them.

TypeScript, ES modules, no dependencies.

## Install

```sh
npm i @lama/motion
```

| import | |
| --- | --- |
| `@lama/motion` | everything below |
| `@lama/motion/core` | `Spring`, `SpringSet`, `Ticker`, `VelocityTracker`, `projectFling`, and the step functions underneath — no DOM |
| `@lama/motion/dom` | `DomAdapter`, `bindStates`, `bindHover`, `bindPress`, `bindPointer`, `bindDrag` |
| `@lama/motion/flip` | `Flip`, `applyFlipToDom`, `Flight`, and the rect helpers |

Every version is also attached as a tarball to its GitHub release, tagged
`motion-vX.Y.Z` on [jesperlandberg/lama](https://github.com/jesperlandberg/lama/releases),
so a project can depend on the tarball's URL instead:

```json
"@lama/motion": "https://github.com/jesperlandberg/lama/releases/download/motion-vX.Y.Z/lama-motion-X.Y.Z.tgz"
```

## Quick start

A card that grows on hover and gives on press:

```ts
import { Spring, Ticker } from '@lama/motion/core';
import { DomAdapter, bindStates } from '@lama/motion/dom';

const ticker = new Ticker().start();   // runs its own requestAnimationFrame loop
const dom = new DomAdapter(ticker);    // the write side

const card = document.querySelector<HTMLElement>('.card')!;
const scale = new Spring(1, { response: 0.3, dampingRatio: 0.8 });
ticker.add(scale);

dom.transform(card, { scale });
bindStates(card, scale, { rest: 1, hover: 1.04, press: 0.97 });
```

`bindStates` only ever calls `scale.setTarget(…)`. A press that lands while the
hover is still growing retargets the same spring: the card turns around from
where it is, carrying its speed, instead of starting again from 1.

## Core

### Spring

```ts
import { Spring } from '@lama/motion/core';

const x = new Spring(0, { response: 0.4, dampingRatio: 0.85 });

x.setTarget(240);                                 // retarget: value and velocity untouched
x.addVelocity(1800);                              // inject velocity, units per second
x.snap(0);                                        // jump there: no motion, velocity 0
x.setParams({ response: 0.2, dampingRatio: 1 });  // a new feel, the same state

x.value; x.velocity; x.target; x.sleeping;
```

A spring whose next step lands inside its rest thresholds is put exactly on its
target with zero velocity, and sleeps. A sleeping spring is skipped until
`setTarget` (with a different target) or `addVelocity` wakes it. `snap` leaves
it asleep: it moved, but there is nothing left to integrate.

### Params

Perceptual params are the usual choice:

| param | default | |
| --- | --- | --- |
| `response` | — | Seconds: the period of the undamped spring, `2π / ω₀`. Critically damped and from rest, a spring covers 99% of the distance in about `response` (1.06×). A tuning number, not a duration — a spring has no end time. |
| `dampingRatio` | `1` | `1` arrives without overshoot. Below 1 overshoots and settles; above 1 creeps in. `0` is undamped and never settles. |
| `bounce` | — | An alias, `dampingRatio = 1 − bounce`: `0.2` is a damping ratio of 0.8. When both are given, `dampingRatio` wins. Above 1 throws — it would be negative damping. |
| `mass` | `1` | Accepted for symmetry with the physical form. With `response` and `dampingRatio` given it cancels out of the motion. |

Or physical params, `{ stiffness, damping, mass }`. The conversion is
`stiffness = mass × (2π / response)²` and
`damping = 2 × dampingRatio × √(stiffness × mass)`; `toPhysical` does it.

Rest thresholds are the constructor's third argument, in the value's own units:

| option | default | |
| --- | --- | --- |
| `restDisplacement` | `0.001` | How close to the target counts as there. |
| `restVelocity` | `0.001` | How slow counts as stopped, units per second. |

The defaults suit values around 0–1: opacity, scale, progress. A spring in
pixels can stop far sooner — FLIP flights rest at 0.5 px and 12 px/s — and a
settled page goes quiet sooner with it:

```ts
const y = new Spring(0, { response: 0.5 }, { restDisplacement: 0.5, restVelocity: 12 });
```

Numbers from a caller are checked where they come in — targets, velocities,
snaps, params, rest thresholds, batch indices — and a bad one throws a
`RangeError` that names it; a frame's `dt` and a fling's deceleration rate are
clamped instead. A NaN that reached a spring would be permanent: it
multiplies into velocity on the next frame, and the element is gone for the
rest of the session. None of the checks run in the step, so they cost nothing
per frame.

### SpringSet

N springs × C channels, stored in `Float32Array`s. Every spring in a set shares
its params and rest thresholds; use several sets for several feels.

```ts
import { SpringSet } from '@lama/motion/core';

const cells = new SpringSet(200, 3, { response: 0.5, bounce: 0.2 }); // 200 × (x, y, scale)

cells.snap(i, x, y, 1);          // place spring i without motion — the arrays start at 0
cells.setTargets(i, x, y, 1.1);  // retarget every channel of spring i
cells.setTarget(i, 2, 1);        // or one channel
cells.addVelocity(i, 0, vx);     // hand one channel a velocity
cells.get(i, 0);                 // read one value

cells.values;    // Float32Array(count × channels): spring i, channel c at [i * channels + c]
cells.active;    // how many springs are still moving
cells.revision;  // bumped by every step that changed a value, and by a snap that did
```

`setTargets` with fewer targets than channels leaves the rest alone; `snap`
with fewer values places those channels and leaves the rest moving. Code that
writes the arrays directly calls `wake(i)` afterwards, so the set steps that
spring again.

### Ticker

One loop, two phases a frame: every steppable steps, then every writer writes.
A frame's layout reads — FLIP measures in the step phase — therefore come
before its style writes, and the two never interleave.

```ts
import { Ticker } from '@lama/motion/core';

const ticker = new Ticker();                  // { maxDt: 1/20, fixedDt }
const offStep = ticker.add(spring);           // anything with step(dt): Spring, SpringSet, Flip, your own
const offWrite = ticker.onWrite((dt) => {});  // read values, write styles or buffers
```

Both return a function that removes what they added.

## Driving the loop

`start()` runs a `requestAnimationFrame` loop of its own. When the page already
has a frame loop — gsap's ticker, a WebGL render loop, Lenis — do not add a
second one: call `tick(dt)` from inside the loop you have, so the springs step
in the same frame as everything else, in an order you chose.

- `dt` is in **seconds**.
- It is clamped into `[0, maxDt]`, `1/20` by default, so a tab coming back from
  the background takes one 50 ms step instead of jumping. A `dt` that is not a
  finite number is read as 0.
- `tick(0)` steps nothing and still runs the writers.
- `fixedDt` applies to `start()` only; with `tick`, the `dt` is what you pass.
- Where there is no `requestAnimationFrame` (Node, SSR) `start()` does nothing,
  while `tick(dt)` works anywhere — tests and offline capture step it by hand.

gsap's ticker, whose `deltaTime` is in milliseconds:

```ts
import { gsap } from 'gsap';
import { Ticker } from '@lama/motion/core';

const ticker = new Ticker();
gsap.ticker.add((_time, deltaTime) => ticker.tick(deltaTime / 1000));
```

A plain `requestAnimationFrame` loop that also draws:

```ts
const ticker = new Ticker();
let last = performance.now();

function frame(now: number) {
  ticker.tick((now - last) / 1000);  // springs step, then writers upload
  last = now;
  render();                          // draw with this frame's values
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

A Nuxt plugin that shares one ticker and one DOM adapter across the app,
stepped from gsap's ticker — the loop an app with Lenis or ScrollTrigger is
already running. It never calls `start()`:

```ts
// plugins/motion.client.ts
import { gsap } from 'gsap';
import { Ticker } from '@lama/motion/core';
import { DomAdapter } from '@lama/motion/dom';

export default defineNuxtPlugin(() => {
  const ticker = new Ticker();
  const dom = new DomAdapter(ticker);
  gsap.ticker.add((_time, deltaTime) => ticker.tick(deltaTime / 1000));
  return { provide: { ticker, dom } };
});
```

```ts
// in a component's <script setup>
import { Spring } from '@lama/motion/core';
import { bindStates } from '@lama/motion/dom';

const { $ticker, $dom } = useNuxtApp();
const card = ref<HTMLElement>();
const offs: Array<() => void> = [];

onMounted(() => {
  const scale = new Spring(1, { response: 0.3, dampingRatio: 0.8 });
  offs.push(
    $ticker.add(scale),
    $dom.transform(card.value!, { scale }),
    bindStates(card.value!, scale, { rest: 1, hover: 1.04, press: 0.97 }),
  );
});
onBeforeUnmount(() => offs.forEach((off) => off()));
```

A plain Vue plugin does the same through `app.provide`:

```ts
import type { App, InjectionKey } from 'vue';
import { gsap } from 'gsap';
import { Ticker } from '@lama/motion/core';

export const TickerKey: InjectionKey<Ticker> = Symbol('ticker');

export const motion = {
  install(app: App) {
    const ticker = new Ticker();
    gsap.ticker.add((_time, deltaTime) => ticker.tick(deltaTime / 1000));
    app.provide(TickerKey, ticker);
  },
};

// in a component: const ticker = inject(TickerKey)!
```

The `.client` suffix keeps the Nuxt plugin off the server. Importing the
package there is harmless all the same: no module touches `window` or
`document` until you call it.

## DOM

`@lama/motion/dom`

### DomAdapter

The write side. It adds one writer to the ticker and, in the write phase,
writes every binding whose springs changed value since its last write — and no
others. The test is the value itself, never the awake flag: `snap` moves a
sleeping spring, a spring can wake and settle inside one tick, and both still
reach the element. A settled page costs no style writes.

```ts
import { DomAdapter } from '@lama/motion/dom';

const dom = new DomAdapter(ticker);

// transform and opacity from any subset of springs; x, y in px, rotate in degrees
const off = dom.transform(el, { x, y, scale, rotate, opacity });
dom.transform(bar, { scaleX });

// one property or custom property; a unit string is appended, a function formats
dom.style(el, '--progress', progress);
dom.style(el, 'width', width, 'px');
dom.style(el, 'filter', blur, (v) => `blur(${v}px)`);

// one spring, as many things as the callback touches
dom.bind([hover], () => {
  card.style.transform = `scale(${1 + hover.value * 0.05})`;
  glow.style.opacity = String(hover.value);
});

// many elements from one SpringSet: element i reads spring i, channels by index
dom.setTransforms(document.querySelectorAll<HTMLElement>('.cell'), cells, { x: 0, y: 1, scale: 2 });

off();          // unbind one
dom.dispose();  // unbind all and leave the ticker
```

The transform is composed translate → rotate → scale; `opacity` goes to
`opacity`. Each binding writes once when it is made. Numbers are rounded to 3
decimals, except through a format function, which gets the raw value. The
adapter overwrites the properties it drives — a transform of your own on the
same element is not composed with.

### Hover and press

```ts
import { bindHover, bindPointer, bindPress, bindStates } from '@lama/motion/dom';

bindStates(el, scale, { rest: 1, hover: 1.05, press: 0.95 });  // press wins over hover, hover over rest
bindHover(el, lift, 0, 1);
bindPress(el, depth, 0, 1);
bindPointer(el, ({ hover, press }) => { /* your own targets */ });
```

Every change of state resolves to one target and calls `setTarget`, so states
blend rather than restart. `bindStates` aims the spring at `rest` when it
binds, and a state given no target is not tracked. Press uses pointer capture,
so a release outside the element still ends it. Touch pointers do not hover
unless `touchHover: true` is passed: on touch, a hover sticks after the finger
lifts. Each call returns an unbind function.

### Drag

```ts
import { bindDrag } from '@lama/motion/dom';

bindDrag(el, {
  x, y,
  bounds: { minX: 0, maxX: 400, minY: 0, maxY: 300 },
  rubberband: 0.5,
  dragParams: { response: 0.1, dampingRatio: 1 },  // a tighter follow while held
});
```

Once the pointer has moved past the threshold, every move sets the target to
where the spring was at `pointerdown` plus the pointer's offset — rubberbanded
past the bounds. The spring follows with its own lag, which is the weight of
the thing, and a drag that catches it mid-flight grabs it where it *is*, with
no jump.

On release, the finger's velocity over the last 100 ms is handed to the spring
— replacing the spring's own, not adding to it — and the target moves to where
a fling at that speed would come to rest (`projectFling`, UIKit's
deceleration), clamped to the bounds. The release is the same motion
continued. A finger that stopped before lifting hands over a velocity of zero.

A cancelled gesture — `pointercancel`, when the browser takes the pointer for
its own scrolling or the system interrupts — is not a release: no velocity is
handed over, nothing is flung, and the target comes back inside the bounds.
`onEnd` hears `cancelled: true`. However the gesture ends, the springs get
their own params back from `dragParams`.

| option | default | |
| --- | --- | --- |
| `x`, `y` | — | The springs to drive; at least one. |
| `bounds` | none | `{ minX, maxX, minY, maxY }`. Release targets are clamped to them. |
| `rubberband` | `0.5` | How much of the overshoot past the bounds survives while dragging: `0` is a hard stop, `1` no resistance. |
| `fling` | `true` | `true` projects the release at a deceleration rate of `0.998`; a number sets the rate; `false` releases in place — the spring still carries the velocity, so it overshoots and comes back. |
| `release` | — | `(axis, position, velocity) => target`: your own release target, such as a snap point. It replaces the projection *and* the clamp. |
| `threshold` | `3` | Pixels the pointer travels before a drag begins, so taps stay taps. |
| `accept` | — | `(event) => boolean`, asked at every `pointerdown`. |
| `lock` | `false` | `true` locks the gesture to its dominant axis once past the threshold; a function `(dx, dy) => 'x' \| 'y'` chooses. |
| `axisScale` | `{ x: 1, y: 1 }` | Multiplies the pointer's movement per axis; `-1` inverts. |
| `maxVelocity` | `6000` | Cap on the velocity handed over, px/s. |
| `dragParams` | — | Params for the springs while dragging, restored after. |
| `onStart(axis)` | — | The drag began; `axis` is the locked axis or `null`. |
| `onMove(dx, dy)` | — | The pointer's offset since `pointerdown`. |
| `onEnd(vx, vy, cancelled)` | — | The release velocity per axis; `0, 0, true` when cancelled. |
| `now` | `performance.now() / 1000` | Clock in seconds, for tests. |

`bindDrag` sets `touch-action` on the element — `none`, `pan-y` or `pan-x`,
by the axes it drives — so the browser does not scroll under the finger, and
restores it on unbind. It captures the pointer only once the movement is a
drag, so a tap still clicks the child under the finger.

Snapping to slots is a `release` that rounds the projected landing:

```ts
import { projectFling } from '@lama/motion/core';

const slot = 320;                   // px per card
const minX = -(count - 1) * slot;

bindDrag(strip, {
  x: offset,
  bounds: { minX, maxX: 0 },
  release: (_axis, position, velocity) => {
    const landing = position + projectFling(velocity);
    return Math.min(0, Math.max(minX, Math.round(landing / slot) * slot));
  },
});
```

## FLIP

`@lama/motion/flip`

A registry of elements by id. A flight is five springs — left, top, width,
height, corner radius — toward a destination **re-read from the live element
every frame**. Nothing is snapshotted and nothing is cancelled:

- A retarget is the destination reading differently: a second layout change
  mid-flight turns the flight around with its velocity intact.
- Late layout, a font swap, a resize: absorbed frame by frame.
- Scroll is not target motion. The spring *value* is shifted by the scroll
  delta, so a flight rides the page like a settled element and lands on
  schedule mid-scroll.
- A destination that dies mid-flight — a held element whose page was torn
  down — freezes where it last stood, and the flight glides to a stop there.

```ts
import { Ticker } from '@lama/motion/core';
import { Flip, applyFlipToDom } from '@lama/motion/flip';

const ticker = new Ticker().start();
const flip = new Flip();
ticker.add(flip);              // measures in the step phase
applyFlipToDom(flip, ticker);  // writes flying elements in the write phase

document.querySelectorAll<HTMLElement>('[data-flip]').forEach((el) => {
  flip.register(el.dataset.flip!, el);
});

// In-page: change the layout, then play() in the same task.
flip.mutate(() => grid.classList.toggle('is-list'));
```

`play()` flies every settled entry whose live rect no longer matches its pose
from the last frame, so it has to run in the same task as the layout change,
before a frame goes by; `mutate(fn)` is `fn()` then `play()`. Both take an
optional list of ids and return how many flights they started. An entry
already flying needs nothing — its target is live.

### Across a navigation

An element can fly from one page to the next. The old page `hold`s the ids the
new page will mount: each entry outlives its element, frozen where it stood.
The new page's `register` under the same id claims it — the entry attaches to
the new element and flies there from wherever it is, with whatever velocity it
has. Every arrow is a retarget:

```
SETTLED → HELD       hold(id): the pose freezes at the last rect, past the element's death
SETTLED → RETIRED    the element left the document unheld
HELD    → FLYING     register(id, newEl) claims the id: the handoff
HELD    → RETIRED    the hold timed out, or expireHolds() after a navigation that never claimed it
FLYING  → FLYING     any retarget: registered again, a layout shift, a resize
FLYING  → HELD       hold(id) mid-flight: a navigation that interrupts another
FLYING  → SETTLED    arrival
```

```ts
// `offer` marks what may fly across pages: true for anywhere, or the
// destination families it may fly to.
flip.register('project-7', card, { offer: ['case'] });

// Leaving for /case/7: hold the ids that page will mount.
const incoming = ['project-7'];
for (const id of flip.candidates('case')) if (incoming.includes(id)) flip.hold(id);

// The incoming page registers the same id. That is the handoff.
flip.register('project-7', hero);

// A beat after the new page has mounted: a hold nobody claimed must not squat.
flip.expireHolds();
```

A held entry whose element is gone has nothing to write to in the DOM. A
transition that needs a visible stand-in during the gap draws one from
`flip.pose(id)`; a GL plane does that natively.

### applyFlipToDom

```ts
const stop = applyFlipToDom(flip, ticker, { radius: true, zIndex: 100 });
stop();  // stop writing, and clear what was written
```

Each frame, every flying element gets `translate3d(pose − layout)
scale(pose / layout)` from a `0 0` origin. While an element flies the writer
owns its `transform`, `transform-origin`, `border-radius` — counter-scaled so
the corners stay round; `radius: false` leaves it alone — and `z-index`
(`null` leaves it alone). A transform you put on the element yourself is
overwritten, not composed with. Landed elements are cleared. The registry
measures through the transform the writer applied, so the layout underneath is
read live and nothing has to be cleared to read it. `onWrite(entry, el)` runs
after each element is written.

### Options

| `new Flip(options)` | default | |
| --- | --- | --- |
| `params` | `FLIGHT_PARAMS` | `{ response: 0.625, dampingRatio: 0.94 }`, a breath of overshoot on arrival. `flip.setParams(p)` retunes running flights too. |
| `scroll` | `window.scrollX`/`Y` | `() => ({ x, y })`. Pass your scroller's position when the page does not scroll the window. |
| `measure` | `getBoundingClientRect` | `(el) => Rect \| null`, null when the element is not in the document. |
| `radius` | computed `border-radius` | `(el) => number`. `() => 0` saves a `getComputedStyle` per element per frame when nothing animates its corners. |
| `now` | `performance.now` | Clock in **milliseconds**. |
| `holdTimeout` | `4000` | Milliseconds a hold waits to be claimed; `hold(id, ms)` overrides it per call. |
| `newbornGrace` | `4000` | Milliseconds an entry registered before its element is in the document waits for it. |
| `onRetire` | — | `(entry) => void` when an entry leaves the registry — a writer clears what it wrote. |

The registry only produces geometry. Each entry carries `pose`, the rect to
draw this frame in viewport pixels; `radius`; `layout`, the untransformed live
rect; `flight`, null when settled; `held`; and your `data`. Iterate `flip` for
every entry, `flip.get(id)` for one, `flip.flying` for the number in flight.

`Flip` measures every registered element every frame — the price of a registry
that never snapshots. Register what can move, and `unregister(id)` what no
longer can.

## WebGL / WebGPU

No GL adapter ships: the arrays are the interface. A `SpringSet`'s `values` is
one `Float32Array`, spring-major — spring `i`, channel `c` at
`i * channels + c` — which is already the layout of an instance buffer with a
stride of `channels × 4` bytes. Upload it in the write phase, on the frames its
`revision` changed:

```ts
const cells = new SpringSet(count, 3, { response: 0.5, bounce: 0.2 });  // x, y, scale
ticker.add(cells);

const instances = device.createBuffer({
  size: cells.values.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
const layout: GPUVertexBufferLayout = {
  arrayStride: cells.channels * 4,
  stepMode: 'instance',
  attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }],
};

let uploaded = -1;
ticker.onWrite(() => {
  if (cells.revision === uploaded) return;  // nothing moved, nothing to upload
  uploaded = cells.revision;
  device.queue.writeBuffer(instances, 0, cells.values.buffer);
});
```

`writeBuffer` is handed `values.buffer` — the same bytes, since the set
allocates each array on a buffer of its own — because TypeScript 5.7 and later
type the view as `Float32Array<ArrayBufferLike>`, which the WebGPU typings
refuse. In WebGL2 the upload is
`gl.bufferSubData(gl.ARRAY_BUFFER, 0, cells.values)` with the instance buffer
bound, behind the same test.

Compare `revision`, not `active`. `revision` also marks the frame a spring
lands on and a `snap` made while the set was asleep — the two frames a check on
the awake count misses. As a WGSL storage buffer, three channels are read as
`array<f32>` and indexed by hand, because `array<vec3f>` pads every element to
16 bytes; or use four channels. `velocities` has the same layout, for a shader
that wants the speed.

FLIP poses go to planes the same way. The writer changes; the numbers do not:

```ts
ticker.onWrite(() => {
  for (const entry of flip) {
    if (entry.pose) planes.get(entry.id)?.place(entry.pose, entry.radius);  // your GL layer
  }
});
```

## API

### core

| | |
| --- | --- |
| `new Spring(initial, params, rest?)` | `value`, `velocity`, `target`, `sleeping`, `config` · `setTarget(t)`, `addVelocity(dv)`, `snap(v)`, `setParams(p)`, `step(dt)` |
| `new SpringSet(count, channels, params, rest?)` | `values`, `velocities`, `targets`, `awake`, `count`, `channels`, `config`, `revision`, `active` · `setTarget(i, c, t)`, `setTargets(i, ...t)`, `addVelocity(i, c, dv)`, `snap(i, ...v)`, `get(i, c)`, `wake(i)`, `setParams(p)`, `step(dt)` |
| `new Ticker({ maxDt?, fixedDt? })` | `add(steppable)`, `onWrite(fn)`, `tick(dt)`, `start()`, `stop()` |
| `new VelocityTracker(window = 0.1, cap = 32)` | `add(value, t)`, `velocity(now?)`, `reset()` — units per second over the last `window` seconds |
| `projectFling(velocity, rate = 0.998)` | How far a fling at `velocity` units/s travels before it stops |
| `toPhysical(p)`, `isPerceptual(p)`, `resolveConfig(p, rest?)`, `computeCoefficients(p, dt)`, `stepSpring(state, config, dt)` | The step itself, for an integrator of your own |

Types: `SpringParams`, `PerceptualParams`, `PhysicalParams`, `SpringConfig`,
`SpringState`, `StepCoefficients`, `Steppable`, `TickerOptions`. Constants:
`DEFAULT_REST_VELOCITY`, `DEFAULT_REST_DISPLACEMENT`.

### dom

| | |
| --- | --- |
| `new DomAdapter(ticker)` | `transform(el, springs)`, `style(el, prop, spring, format?)`, `bind(springs, write)`, `setTransforms(els, set, channels)`, `dispose()` |
| `bindStates(el, spring, { rest, hover?, press? }, options?)` | Hover and press to one target |
| `bindHover(el, spring, rest, hover, options?)`, `bindPress(el, spring, rest, press, options?)` | One state |
| `bindPointer(el, onChange, { hover?, press?, touchHover? })` | The raw `{ hover, press }` changes |
| `bindDrag(el, options)` | Drag, fling, velocity handoff |

Every binding returns an unbind function.

### flip

| | |
| --- | --- |
| `new Flip(options?)` | `register(id, el, { offer?, data? })`, `unregister(id)`, `hold(id, ms?)`, `expireHolds()`, `candidates(family?)`, `play(ids?)`, `mutate(fn, ids?)`, `get(id)`, `pose(id)`, `flying`, `setParams(p)`, `step(dt)`; iterable over its entries |
| `applyFlipToDom(flip, ticker, { radius?, zIndex?, onWrite? })` | The DOM writer; returns a function that removes it |
| `new Flight(from, { rect, radius? }, { params?, scroll?, restDisplacement?, restVelocity? }?, fromRadius?)` | One flight on its own: `pose`, `radius`, `arrived`, `retarget(target)`, `addVelocity(vx, vy)`, `step(dt)` |
| `FLIGHT_PARAMS`, `measureElement(el)`, `measureRadius(el)`, `sameRect(a, b)` | The defaults and helpers `Flip` uses |

## Tuning

Start critically damped, `dampingRatio: 1`, and set `response` alone until the
timing is right. Then take damping out for life. From rest, toward a new
target:

| `dampingRatio` | `bounce` | overshoot |
| --- | --- | --- |
| `1` | `0` | none |
| `0.9` | `0.1` | 0.2% |
| `0.8` | `0.2` | 1.5% |
| `0.7` | `0.3` | 4.6% |
| `0.5` | `0.5` | 16% |
| `0.3` | `0.7` | 37%, and it rings |

- Feedback that answers the pointer — hover, press — wants a short response,
  around 0.3 s. Things that travel — cards, panels, flights — want longer:
  `FLIGHT_PARAMS` is 0.625 s.
- A thing held by the finger should follow it closely: `dragParams` of about
  `{ response: 0.1, dampingRatio: 1 }` while dragging, and the spring's own
  feel for the release.
- Params can change mid-motion — `setParams` keeps value and velocity — so a
  feel can depend on state: stiffer while held, softer once let go.
- One feel per `SpringSet`. Many things with the same feel belong in one set.
- Reduced motion is the caller's decision, and `snap` is instant:

  ```ts
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) panel.snap(1);
  else panel.setTarget(1);
  ```

## What is left alone

No easing curves, timelines or keyframes: a spring's params are the whole
vocabulary. No GL adapter: the arrays and the poses are the interface. The
scroll position is read, never owned. Gestures stop at hover, press and drag;
pinch and rotate are not here.

## Runtime

- ES2022 ES modules, no CommonJS build. Evergreen browsers, or a bundler that
  transpiles for older ones.
- No dependencies, and `sideEffects: false`, so what you do not import is
  dropped.
- Types ship with the package, with declaration maps into the TypeScript
  source, which ships too: go-to-definition lands in the real code.
- `core` runs anywhere. `dom` and `flip` touch the DOM when called, never on
  import, so importing under SSR is safe.
- The bindings use Pointer Events and pointer capture. `Flip` reads
  `getBoundingClientRect`, `getComputedStyle`, `performance.now` and the
  window's scroll by default; each is replaceable through its options.
- A sleeping spring and a settled binding cost almost nothing, but a ticker
  running its own loop asks for frames until `stop()`, moving or not. Stepping
  it from a loop the page already runs avoids that second loop.

## Develop

From the root of [jesperlandberg/lama](https://github.com/jesperlandberg/lama):

```sh
npm test -w @lama/motion        # vitest: the closed-form step, the bindings, the registry
npm run build -w @lama/motion   # dist/ via tsc, with declarations
```

## License

MIT © 2026 Jesper Landberg — see [LICENSE](LICENSE).
