# lama

Front-end packages by [Jesper Landberg](https://github.com/jesperlandberg): one
repo, independent packages, each published on its own under `@lama`.

| package | what |
| --- | --- |
| [`@lama/split`](packages/split) | splits blocks of text into the lines the browser painted — every block measured before any is cut, every original node put back on revert |
| [`@lama/motion`](packages/motion) | retargetable, velocity-preserving spring motion — a spring is state, interactions only set targets; a DOM adapter, hover/press/drag bindings, and a FLIP registry whose flights re-read their destination every frame |

## Install

Releases are tagged per package (`split-v0.1.0`) and carry the package tarball,
so a project can depend on one straight from GitHub without an npm publish:

```json
"@lama/split": "https://github.com/jesperlandberg/lama/releases/download/split-v0.1.0/lama-split-0.1.0.tgz"
```

## Develop

```sh
npm install
npm run build     # every package's dist/
npm test          # vitest, where a package has tests
npm run dev -w @lama/motion   # the motion playground
```

Each package builds with `tsc` to its own `dist/` (declarations included) and
packs itself on `npm pack` / release.

## Release

```sh
npm run release -- split            # patch bump, or: minor | major | 1.2.3
```

Bumps the package, builds, packs, commits `release(split): x.y.z`, tags
`split-vx.y.z`, pushes, and creates the GitHub release with the tarball. Then
point the consuming project at the new URL the script prints.
