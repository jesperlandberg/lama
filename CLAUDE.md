# lama

Jesper Landberg's front-end packages, one repo, published one at a time under
`@lama`. Today: `packages/split` (`@lama/split`). An umbrella (`lama.create.split()`,
`@lama/domgl`, `@lama/motion`) is an idea to discuss, not built.

## Working here

- Packages are TypeScript, ES2022, `strict` + `noUncheckedIndexedAccess`, no
  dependencies, no framework. `dist/` is built with `tsc` and not committed.
- `npm run build` builds every package; `npm run release -- <pkg> [patch|minor|major|x.y.z]`
  bumps, builds, packs, commits `release(<pkg>): x.y.z`, tags `<pkg>-vx.y.z`
  (annotated), pushes and creates the GitHub release with the tarball. Clean tree
  and `gh` signed in required.
- Consumers install from the release tarball URL
  (`releases/download/split-vX.Y.Z/lama-split-X.Y.Z.tgz`) — npm cannot install a
  subfolder of a git repo, and nothing is on npmjs yet (`@lama` scope not claimed).
  Ascension (`~/Documents/web/ascension`) is the first consumer, lines only,
  through `app/transitions/lines.ts`.
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
