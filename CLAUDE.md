# lama

Jesper Landberg's front-end packages, one repo, published one at a time under
`@alpacka`. Today: `packages/split` (`@alpacka/split`), `packages/motion`
(`@alpacka/motion`, moved in from `~/Documents/web/motion` on 2026-09-05) and
`packages/sticky` (`@alpacka/sticky`; `@alpacka/smooth-stick` from 2026-09-28
until it was renamed on 2026-11-16). split and motion were `@lama/…` until
2026-09-28, see below. An umbrella (`lama.create.split()`,
`@lama/domgl`) is an idea to discuss, not built.

## Working here

- Packages are TypeScript, ES2022, `strict` + `noUncheckedIndexedAccess`, no
  dependencies, no framework. `dist/` is built with `tsc` and not committed.
- `npm run build` builds every package; `npm run release -- <pkg> [patch|minor|major|x.y.z]`
  typechecks and tests, then bumps, builds, packs, commits `release(<pkg>): x.y.z`,
  tags `<pkg>-vx.y.z` (annotated), pushes and creates the GitHub release with the
  tarball. Clean tree and `gh` signed in required. `--npm` also publishes that
  tarball to npmjs before anything is committed; it needs `npm login`, and a
  refused publish undoes the bump.
- The npm scope is `@alpacka`, the npm account `alpacka`'s own. It has 2FA on, so
  a `--npm` release stops at the publish for an approval in the browser. `@lama`
  on npm is the personal scope of someone else's account named `lama` (checked
  2026-09-24: `registry.npmjs.org/-/org/lama/user` answers `{"lama":"owner"}`), so
  split and motion were renamed from `@lama/…` to `@alpacka/…` on 2026-09-28; the
  class names (`LamaSplit`) stayed. sticky is on npm; split and motion go
  there with their next `--npm` release.
- Consumers install from npm, or from a release's tarball URL
  (`releases/download/<pkg>-vX.Y.Z/alpacka-<pkg>-X.Y.Z.tgz`) — npm cannot install
  a subfolder of a git repo. Releases from before the rename (`motion-v0.1.0`,
  `split-v0.2.0`) carry `lama-<pkg>` tarballs named `@lama/…`, and the projects on
  them (goldfront, griflan, op-26, ascension, the jesper-folio sites) keep working
  until they move to a newer release, which renames the dependency and its
  imports. Ascension (`~/Documents/web/ascension`) is split's first consumer,
  lines only, through `app/transitions/lines.ts`.
- `npm test` runs vitest in every package that has tests (motion and
  sticky do; split is verified against real pages, see below).
- Tabs for indentation, shown four wide; no semicolons, single quotes. motion's
  two spaces and semicolons came with it from its old repo.
- Comments explain the why, in prose. Read a package's `src/index.ts` header before
  changing it: it states what is handled, what is left alone and why.

## @alpacka/split — the bar

- The split must not show: every glyph on the same pixel before and after, block
  heights identical, every original node restored by identity on revert. Verified
  by splitting a block, walking its characters with a Range before and after
  (`getClientRects` per character), comparing lefts/tops, then reverting and
  comparing childNodes by identity. Do that against real pages, not fixtures —
  the bugs were in raised superscripts, `text-indent` on inline-blocks, a space
  laid out beside a box, hyphen breaks, tight leading.
- To test an unreleased build against ascension without releasing: copy
  `packages/split/dist/index.js` into ascension's `public/` and `import()` it from
  the console (Vite refuses `@fs` paths outside the project); remove it after.
- API decisions taken: `new LamaSplit(blocks, opts)` is the API — no `create()`
  alias, no queued/batched static call (would be async; add only when a caller
  shape needs it). `type` and `mask` take `'lines, words, chars'` strings or arrays;
  masks are opt-in; words/chars always sit inside line blocks.
- Open: publish to npm (`--npm`); a canvas measurer behind `Reader.run`
  (Pretext-style predicted breaks — only with a DOM-vs-canvas harness);
  `hyphens: auto`, drop caps, floats, RTL/vertical (deliberately out).

## @alpacka/motion — the bar

- A spring is state (`value`, `velocity`, `target`); an interaction only calls
  `setTarget` / `addVelocity` / `snap`. Nothing is cancelled, no tween exists.
  The step is closed-form, so one big step equals many small ones — that is a
  test, keep it one.
- Springs never know about elements. Adapters (`DomAdapter`, `applyFlipToDom`)
  are the only writers, in the ticker's write phase; layout reads happen in the
  step phase. A GL layer is another writer of the same numbers, not a port.
- Flights re-read their destination every frame; "Last" is never a snapshot.
  Scroll shifts a flight's value, not its target. The corner is the exception
  and says so: `applyFlipToDom` owns `border-radius` while an element flies, so
  a flight aims at `entry.baseRadius`, read while nothing was written. Reading
  it live sent the radius climbing to three times the destination's mid-flight.
- A writer decides by the values it wrote, never by the awake flag: `snap`
  moves a spring and leaves it asleep, and a spring can wake and settle inside
  one tick. Same rule for a GPU consumer, through `SpringSet.revision`.
- Rest is a float32 question in a batch: past ~1000 px a frame's progress
  rounds away, so a spring that cannot move any closer lands rather than
  staying awake for ever.
- A cancelled gesture is not a release: no fling, and the target returns inside
  the bounds. Every way out of a drag hands `dragParams` back.
- Numbers from a caller are checked at the setters and the params, never in the
  step — a NaN in a spring is permanent.
- Verified by `npm test -w @alpacka/motion` (50 tests: dt-independence, retarget
  continuity, a chaos storm that must still come to rest, the write rule,
  bindings, hold → claim, scroll, radius). The old playground (layouts,
  hold → claim, chaos, drag → fling, a WebGPU glass carousel) lives on in
  `~/Documents/web/motion/playground`, outside the repo. A consumer,
  `~/Documents/web/motion-demo`, still points at `file:../motion` under the old
  name `@domgl/motion`.

## @alpacka/sticky — the bar

- Renamed from `@alpacka/smooth-stick` on 2026-11-16, before 0.2.0: `smoothStick`
  is `sticky`, the types are `Sticky`, `StickyOptions`, `StickyAll`. 0.1.0 stays
  on npm under the old name with tag `smooth-stick-v0.1.0`; deprecate it there
  (`npm deprecate @alpacka/smooth-stick "renamed to @alpacka/sticky"`) once the
  new name has a release. goldfront, chiraq, griflan-ai, op-26 and alpacka are
  on the old name at 0.1.0, each with its own `useSmoothStick.ts`.

- Sticky pins; the correction only rounds its two corners, and outside its two
  windows it is exactly zero. So anything that stops it running (touch by
  default, reduced motion, a breakpoint that unsticks the element, a browser
  without scroll-driven animations on the compositor engine) leaves plain
  sticky, and nothing about the layout ever depends on it.
- A landing enters its window at exactly scroll speed: its travel is
  span / E′(0). Any other distance puts a corner of its own at the window's
  edge. Both of sticky's corners are exact keyframes; samples either side of
  one leave a sliver of the stop standing.
- The windows are `exit-crossing` offsets on the PARENT's view timeline, so a
  parent that moves needs no new measure; only resizes do. The flow position is
  read with the element set to `position: static` for one synchronous read.
- `freeze()` commits the pose inline and drops the animation, for a page whose
  scroll is reset under it while it is still on screen (a transition); a
  `destroy()` after it keeps that pose.
- `sticky.all()` finds stickies from the stylesheets' RULES (any rule that
  declares `position: sticky`, at any depth), never from computed style: a
  sticky behind a breakpoint is not sticky at the other width, and a computed
  scan would miss it for good. An element taken on that is not sticky is an
  idle stick that wakes by itself. Computed style is only the fallback for a
  page with a sheet that cannot be read. It is opt-out
  (`data-sticky-ease="off"`), which is only sound because `measure` refuses
  what it cannot round: no `top`, zero travel, and a scroll container between
  the element and the root (`scrolls`). Keep that guard as wide as the search.
- Six keyframes are exact: sticky's two corners and all four ends of the two
  windows. Without the inner two ends the hold is a straight line between the
  last sample of the landing and the first of the take-off, a fraction of a
  pixel off zero and drifting (0.075px on power1, measured). `keyframes` is
  pure and tested for it.
- `refresh` measures and rebuilds only when the engage point, travel, span or
  lead moved. The engine comes off before the read only when its offset is in
  the rect (the element inside a window), since that offset would be measured
  as layout. One build at init, one per frame of a real resize, none for a
  resize that changed nothing, and none for a resize that finds the element
  inside a window with nothing changed.
- Touch stays off by default (`media` is the pointer query), and that was
  tested, not assumed. 2026-11-16, Jesper's phone, the demo with `media: 'all'`:
  the card jumped and ran out of step with the finger. One cause was ours: a
  toolbar sliding away is a `resize`, and `refresh` took the engine off to
  measure whenever the element was inside a window, so the animation was
  dropped and rebuilt under the finger. `measure` now leaves it running and
  takes its offset out of the rect (5 rebuilds for 5 resizes -> 0). With that
  fixed it still wobbled. The engine and the browser were not noted; WebKit's
  tracker has scroll-driven animations on the main thread before iOS 26.4 and
  updated at 60Hz on iOS after. Do not flip the default without a phone in
  hand: the demo's `?touch` forces it on and reads out the engine, the
  animation builds and the resizes.
- Checked in Chrome, WebKit and Firefox before 0.2.1 (Playwright, a production
  build of the demo), which found two things Chrome alone never would. Firefox
  has scroll-driven animations and no Typed OM, so `CSS.px` threw and the
  package died on the compositor path: the range offsets are strings now
  (`'exit-crossing 120px'`), which all three take, negatives included. And a
  module script can run before its stylesheet has loaded (WebKit did), so
  `all()` found no rules and no stickies: both `all()` and a single stick look
  once more on `load`. Chrome is not a test of this package.
- The main-thread engine is on the ticker only while the parent is near the
  viewport (an IntersectionObserver, a span of margin). It starts subscribed
  and written once, so a rebuild inside a window shows no frame of plain
  sticky. A caller's `ticker` is therefore subscribed more than once.
- Verified by `npm test -w @alpacka/sticky` (the curve: windows, edge
  slopes, continuity, monotonic, mirror, shrink, lead, eases; the keyframes;
  the selector walk) and on goldfront
  (the Text1 client rail, the ideas post credits; vendored there first, on the
  npm package since 0.1.0), scrolled in steps: sticky goes from scroll
  speed to still in one step, the corrected element 0.95 → 0.49 at sticky's
  corner → 0.01 and onto the line to the pixel; the main-thread engine gives
  the same numbers. The first demo, plain sticky beside it in one layout, is
  published as a private Claude artifact, not in the repo.
