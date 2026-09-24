# lama

Jesper Landberg's front-end packages, one repo, published one at a time under
`@lama`. Today: `packages/split` (`@lama/split`) and `packages/motion` (`@lama/motion`,
moved in from `~/Documents/web/motion` on 2026-09-05, unreleased). An umbrella
(`lama.create.split()`, `@lama/domgl`) is an idea to discuss, not built.

## Working here

- Packages are TypeScript, ES2022, `strict` + `noUncheckedIndexedAccess`, no
  dependencies, no framework. `dist/` is built with `tsc` and not committed.
- `npm run build` builds every package; `npm run release -- <pkg> [patch|minor|major|x.y.z]`
  typechecks and tests, then bumps, builds, packs, commits `release(<pkg>): x.y.z`,
  tags `<pkg>-vx.y.z` (annotated), pushes and creates the GitHub release with the
  tarball. Clean tree and `gh` signed in required. `--npm` also publishes that
  tarball to npmjs before anything is committed; it needs `npm login`, and a
  refused publish undoes the bump.
- Consumers install from the release tarball URL
  (`releases/download/split-vX.Y.Z/lama-split-X.Y.Z.tgz`) — npm cannot install a
  subfolder of a git repo, and nothing is on npmjs yet. `@lama` there is not free:
  it is the personal scope of an existing npm account named `lama` (checked
  2026-09-24: `registry.npmjs.org/-/org/lama/user` answers `{"lama":"owner"}`, no
  packages), so publishing under it needs that account, or another scope.
  Ascension (`~/Documents/web/ascension`) is the first consumer, lines only,
  through `app/transitions/lines.ts`.
- `npm test` runs vitest in every package that has tests (motion does; split is
  verified against real pages, see below).
- Comments explain the why, in prose. Read a package's `src/index.ts` header before
  changing it: it states what is handled, what is left alone and why.

## @lama/split — the bar

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
- Open: publish to npmjs under `@lama`; a canvas measurer behind `Reader.run`
  (Pretext-style predicted breaks — only with a DOM-vs-canvas harness);
  `hyphens: auto`, drop caps, floats, RTL/vertical (deliberately out).

## @lama/motion — the bar

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
- Verified by `npm test -w @lama/motion` (50 tests: dt-independence, retarget
  continuity, a chaos storm that must still come to rest, the write rule,
  bindings, hold → claim, scroll, radius). The old playground (layouts,
  hold → claim, chaos, drag → fling, a WebGPU glass carousel) lives on in
  `~/Documents/web/motion/playground`, outside the repo. A consumer,
  `~/Documents/web/motion-demo`, still points at `file:../motion` under the old
  name `@domgl/motion`.
