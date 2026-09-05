#!/usr/bin/env node
/*
 * Release one package: bump, build, pack, commit, tag, push, GitHub release
 * with the tarball attached — so a project can depend on the release URL.
 *
 *   npm run release -- split            # patch
 *   npm run release -- split minor
 *   npm run release -- split 1.0.0
 *
 * Tags are per package (`split-v0.1.1`). Needs a clean tree and `gh` signed in.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const [name, bump = 'patch'] = process.argv.slice(2)

if (!name) {
	console.error('usage: npm run release -- <package> [patch|minor|major|x.y.z]')
	process.exit(1)
}

const dir = `packages/${name}`
const run = (cmd, cwd = '.', input) => execSync(cmd, { stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], cwd, input })
const out = (cmd, cwd = '.') => execSync(cmd, { encoding: 'utf8', cwd }).trim()

if (out('git status --porcelain')) {
	console.error('release: the tree is not clean — commit or stash first')
	process.exit(1)
}

run(`npm version ${bump} --no-git-tag-version`, dir)

const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
const { version } = pkg
const tag = `${name}-v${version}`
/* npm pack's own name for a scoped package: @lama/split → lama-split-0.1.1.tgz */
const file = `${pkg.name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`
const url = `https://github.com/jesperlandberg/lama/releases/download/${tag}/${file}`

mkdirSync('.release', { recursive: true })
run('npm run build', dir)
run(`npm pack --pack-destination ${process.cwd()}/.release`, dir)

run(`git add ${dir}/package.json package-lock.json`)
run(`git commit -q -m "release(${name}): ${version}"`)
run(`git tag -a ${tag} -m "${pkg.name} ${version}"`)
run('git push -q --follow-tags')
run(`gh release create ${tag} .release/${file} --title "${pkg.name} ${version}" --notes-file -`, '.', `Install straight from this release:\n\n"${pkg.name}": "${url}"\n`)

console.log(`\n${pkg.name} ${version}\n${url}`)
