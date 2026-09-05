# @lama/motion

Retargetable, velocity-preserving spring motion for the DOM and WebGL/WebGPU.

A spring is **state**, not a timeline: `{ value, velocity, target }`. Interactions
only ever write a new `target` (or inject velocity). Nothing is cancelled or
restarted, so hover → press → release → layout shift blend into one continuous motion.

## Install

Releases are tagged `motion-vX.Y.Z` on [jesperlandberg/lama](https://github.com/jesperlandberg/lama)
with the package tarball attached, so a project depends on the URL:

```json
"@lama/motion": "https://github.com/jesperlandberg/lama/releases/download/motion-vX.Y.Z/lama-motion-X.Y.Z.tgz"
```

## Status

- [x] Phase 1 — core spring (closed-form, dt-independent), `SpringSet` (SoA batch), `Ticker`
- [x] Phase 2 — DOM adapter + hover/press bindings (`@lama/motion/dom`)
- [ ] Phase 3 — GL/WebGPU adapter (write `SpringSet.values` into instance buffers)
- [x] Phase 4 — FLIP port (measure → retarget, velocity preserved across reflow) (`@lama/motion/flip`)
- [x] Phase 5 — drag → fling velocity handoff (`bindDrag`, landed with phase 2)
- [ ] Phase 6 — docs, tuning presets

## Usage

```ts
import { Spring, SpringSet, Ticker } from '@lama/motion';

const ticker = new Ticker().start();          // or drive it: ticker.tick(dt) from your render loop

// Scalar spring
const scale = new Spring(1, { response: 0.35, dampingRatio: 0.7 });
ticker.add(scale);
el.addEventListener('pointerenter', () => scale.setTarget(1.05));
el.addEventListener('pointerdown',  () => scale.setTarget(0.95));
el.addEventListener('pointerup',    () => scale.setTarget(1.05));
ticker.onWrite(() => { el.style.transform = `scale(${scale.value})`; });

// Batched: 200 grid cells × (x, y, scale)
const cells = new SpringSet(200, 3, { response: 0.5, bounce: 0.2 });
ticker.add(cells);
cells.setTargets(i, x, y, 1);                  // retarget cell i
cells.addVelocity(i, 0, flingVx);              // hand off drag velocity
ticker.onWrite(() => device.queue.writeBuffer(instanceBuf, 0, cells.values));
```

## DOM (`@lama/motion/dom`)

The adapter is the write side: springs never know about elements. Bindings only
ever call `setTarget` / `addVelocity`.

```ts
import { DomAdapter, bindStates, bindDrag } from '@lama/motion/dom';

const dom = new DomAdapter(ticker);            // writes in the ticker's write phase

// transform / opacity / any property or --custom-prop, written only while moving
dom.transform(el, { x, y, scale, rotate, opacity });
dom.style(el, '--progress', p);
dom.setTransforms(cells, cellSet, { x: 0, y: 1, scale: 2 });   // one SpringSet → many elements

// hover / press resolve to ONE target; press wins over hover, hover over rest
bindStates(el, scale, { rest: 1, hover: 1.05, press: 0.95 });

// drag: pointer offset → setTarget every move; on release the finger's velocity
// is handed to the spring and the target is the projected fling, clamped to bounds
bindDrag(el, { x, y, bounds: { minX: 0, maxX: 400 }, rubberband: 0.5 });
```

## FLIP (`@lama/motion/flip`)

Port of the domgl-webgpu flight system. A flight is five springs (x, y, w, h,
radius) toward a target **re-read from the live element every frame**. Nothing
is snapshotted and nothing is cancelled:

- retarget = the target reads differently; velocity carries through
- late layout, font swap, resize: absorbed frame by frame
- scroll is not target motion: the spring *value* is shifted by the scroll
  delta, so the flight lands on schedule mid-scroll
- a destination that dies freezes where it stood; the springs glide to a stop

```ts
import { Flip, applyFlipToDom } from '@lama/motion/flip';

const flip = new Flip();                       // Steppable
ticker.add(flip);
applyFlipToDom(flip, ticker);                  // writes translate/scale (+ radius) to flying elements

// register everything that may move; `offer` marks what may fly ACROSS pages
flip.register('hero-1', el, { offer: ['case'] });

// in-page layout change: mutate, then play() in the same task
flip.mutate(() => { grid.dataset.layout = 'row'; });

// across a navigation (the state machine from FLIP.md):
//   SETTLED → HELD → FLYING → SETTLED, every arrow is "set the target"
const pairs = flip.candidates(family(to)).filter((id) => expected(to).includes(id));
for (const id of pairs) flip.hold(id);         // survives the old page's teardown
// ... new page mounts and calls flip.register(id, newEl) — the handoff, it flies
setTimeout(() => flip.expireHolds(), 700);     // an unclaimed hold must not squat
```

The registry only produces geometry (`entry.pose`, `entry.layout`, `entry.radius`).
`applyFlipToDom` is one writer; a GL adapter reads the same poses. A held entry
whose element is gone has nothing to write to in the DOM — a page transition that
needs a visible stand-in during the gap renders one from `flip.pose(id)` (a GL
plane does this natively).

## Playground

```sh
npm run dev -w @lama/motion     # from the repo root
```

Image field with six layouts (grid, row, masonry, featured, list, stack), shuffle,
add/drop, a card → detail "navigation" that runs hold → claim, chaos mode that
retargets every 400 ms, live tuning sliders, and a drag → fling knob.

`/carousel.html` — the engine demo. A draggable strip of landscape cards that
opens into a case study. One `offset` spring (drag, fling, snap), one `focus`
spring per card (grows it in place and pushes the others out by half its extra
width, symmetric), and one `view` spring (0 = strip, 1 = case study): every card
has a rect in both layouts and shows `mix(strip, case, view)`. The clicked card
grows, then travels to the top as the hero; the others land in a strip at the
bottom (the hero's slot stays empty — that is where it came from); a column of
planes rises in between; the page becomes scrollable. Click the hero or press
Escape to fold it back; click a bottom card to swap heroes, and a `scroll`
spring carries the page back to the top (the wheel interrupts it). Everything
is a transform; interactions only ever call `setTarget` / `addVelocity`.

The toggle at the top switches the WRITER, never the model: **HTML** writes
transforms to the card boxes; **WebGPU** writes the same numbers, plus the
springs' velocities, into 256-byte uniform slices and draws liquid glass planes
on one canvas over the page (`playground/glass.ts`, in the shape of the
domgl-sync-webgpu layer). Each plane is a real glass slab: the fragment
raymarches a 3D SDF (rounded rect, extruded, rounded edges), refracts into it at
three refractive indices and reads the picture off the back face, so the rim
bends and disperses the image like thick glass, with specular and Fresnel from a
fixed key light. A `tilt` spring leans the cards into a drag or fling (its
target is a readout of the strip's velocity) and springs them upright; HTML
applies it as `rotateY`, WebGPU turns the slab in 3D. The crop window slides
with each card's place on screen (parallax) in both writers. Every other card is
a short clip from `playground/public/vid` (kept out of git — drop any four
mp4s named `bunny`, `jellyfish`, `sintel`, `bunny720` there; a clip that is
missing falls back to a still): the card's own `<video>` is what the HTML
writer shows and what the GL writer imports as an external texture each
frame, so a clip decodes once. Edges are supersampled 2×2 in the shader — they
are shader-made, so MSAA cannot help. Flip the toggle mid-fling and the motion
carries on.

## Params

Perceptual: `{ response, dampingRatio | bounce, mass? }` — `response` ≈ seconds to settle
when critically damped; `dampingRatio` 1 = no overshoot, lower = bouncier.
Physical: `{ stiffness, damping, mass }`.

## Dev

```sh
npm test -w @lama/motion        # vitest: the closed-form step, the bindings, the registry
npm run build -w @lama/motion   # dist/ via tsc, with declarations
```
