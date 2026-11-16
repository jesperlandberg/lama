# alpacka

Front-end packages by [Jesper Landberg](https://github.com/jesperlandberg): one
repo, each package versioned and released on its own, and published on npm under
`@alpacka`.

| package | what |
| --- | --- |
| [`@alpacka/split`](packages/split) | splits blocks of text into the lines the browser painted — every block measured before any is cut, every original node put back on revert |
| [`@alpacka/motion`](packages/motion) | retargetable, velocity-preserving spring motion — a spring is state, interactions only set targets; a DOM adapter, hover/press/drag bindings, and a FLIP registry whose flights re-read their destination every frame |
| [`@alpacka/sticky`](packages/sticky) | `position: sticky` that eases in and out. The browser still pins the element; this adds one offset on top, as a scroll-driven animation |

## Skills

A package here can also come as a skill: instructions for a coding agent, with
the package's own source inside as one file to copy into a project.

```sh
npx skills add jesperlandberg/alpacka@sticky
```

| skill | what |
| --- | --- |
| [`sticky`](skills/sticky) | eases `position: sticky` in and out. Which elements suit it, how to wire it into Vue, React or a smooth scroll, what breaks it, and how to check it works |

## Install

```sh
npm i @alpacka/sticky
```

sticky is on npm today; split and motion follow with their next release.
Every release is also tagged per package (`sticky-v0.2.0`) and carries the
package tarball, so a project can depend on one straight from GitHub:

```json
"@alpacka/sticky": "https://github.com/jesperlandberg/alpacka/releases/download/sticky-v0.2.0/alpacka-sticky-0.2.0.tgz"
```

sticky was `@alpacka/smooth-stick` up to 0.1.0, and that release keeps its old
name and tag (`smooth-stick-v0.1.0`).

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
