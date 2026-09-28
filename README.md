# lama

Front-end packages by [Jesper Landberg](https://github.com/jesperlandberg): one
repo, each package versioned and released on its own, and published on npm under
`@alpacka`.

| package | what |
| --- | --- |
| [`@alpacka/split`](packages/split) | splits blocks of text into the lines the browser painted — every block measured before any is cut, every original node put back on revert |
| [`@alpacka/motion`](packages/motion) | retargetable, velocity-preserving spring motion — a spring is state, interactions only set targets; a DOM adapter, hover/press/drag bindings, and a FLIP registry whose flights re-read their destination every frame |
| [`@alpacka/smooth-stick`](packages/smooth-stick) | `position: sticky` with its corners rounded off — the element slows into its line and eases away from it, as a scroll-driven animation beside sticky |

## Install

```sh
npm i @alpacka/smooth-stick
```

smooth-stick is on npm today; split and motion follow with their next release.
Every release is also tagged per package (`smooth-stick-v0.1.0`) and carries the
package tarball, so a project can depend on one straight from GitHub:

```json
"@alpacka/smooth-stick": "https://github.com/jesperlandberg/lama/releases/download/smooth-stick-v0.1.0/alpacka-smooth-stick-0.1.0.tgz"
```

Releases from before the move to `@alpacka` (`motion-v0.1.0`, `split-v0.2.0`)
carry `@lama/…` tarballs. Projects on them keep working, and take the new name
when they move to a newer release.

## Develop

```sh
npm install
npm run build     # every package's dist/
npm test          # vitest, where a package has tests
```

Each package builds with `tsc` to its own `dist/` (declarations included) and
packs itself on `npm pack` / release.

## Release

```sh
npm run release -- split            # patch bump, or: minor | major | 1.2.3
npm run release -- motion --npm     # the same, and the tarball goes to npm too
```

Typechecks and tests the package, then bumps it, builds, packs, commits
`release(split): x.y.z`, tags `split-vx.y.z`, pushes, and creates the GitHub
release with the tarball. Then point the consuming project at the new URL the
script prints.

`--npm` publishes that same tarball to npm right after it is packed, before
anything is committed or pushed, so a refused publish undoes the bump and
leaves the tree as it was. It needs `npm login` and
`"publishConfig": { "access": "public" }` in the package; with 2FA on, npm asks
for the one-time password as it publishes.
