#!/usr/bin/env node
/*
 * Release one package: bump, build, pack, commit, tag, push, GitHub release
 * with the tarball attached — so a project can depend on the release URL.
 *
 *   npm run release -- split            # patch
 *   npm run release -- split minor
 *   npm run release -- split 1.0.0
 *   npm run release -- motion --npm     # and publish that same tarball to npm
 *
 * Tags are per package (`split-v0.1.1`). Needs a clean tree and `gh` signed in.
 * `--npm` also needs `npm login` and a package whose publishConfig.access is
 * "public". With 2FA on, npm asks for the one-time password when it publishes;
 * `npm_config_otp=123456 npm run release -- motion --npm` hands it over up front.
 */
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const flags = args.filter((a) => a.startsWith('--'))
const toNpm = flags.includes('--npm')
const [name, bump = 'patch'] = args.filter((a) => !a.startsWith('--'))

if (!name || flags.some((f) => f !== '--npm')) {
	console.error('usage: npm run release -- <package> [patch|minor|major|x.y.z] [--npm]')
	process.exit(1)
}

const dir = `packages/${name}`
const run = (cmd, cwd = '.', input) => execSync(cmd, { stdio: input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'], cwd, input })
const out = (cmd, cwd = '.') => execSync(cmd, { encoding: 'utf8', cwd }).trim()

if (out('git status --porcelain')) {
	console.error('release: the tree is not clean — commit or stash first')
	process.exit(1)
}

/*
 * What --npm needs is checked before anything changes, for the same reason as
 * the gate below: found out after the bump, it leaves a version behind.
 */
if (toNpm) {
	const { publishConfig } = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
	if (publishConfig?.access !== 'public') {
		console.error(`release: --npm publishes only a package with "publishConfig": { "access": "public" } — ${dir} has none`)
		process.exit(1)
	}
	try {
		out('npm whoami')
	} catch {
		console.error('release: --npm needs `npm login` first')
		process.exit(1)
	}
}

/*
 * The gate comes before the bump: from the next line on, the tree has been
 * changed, and a build that falls over then leaves a version nobody released
 * sitting in package.json.
 */
run('npm run typecheck --if-present', dir)
run('npm test --if-present', dir)

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

/*
 * npm goes first, before anything is committed or pushed: it is the step most
 * likely to be refused — the login, 2FA, who owns the scope — and the one that
 * cannot be taken back. Refused, the bump is undone and the tree is as it was.
 * What it publishes is the tarball the GitHub release carries, byte for byte.
 */
if (toNpm) {
	try {
		run(`npm publish .release/${file} --access public`)
	} catch {
		run(`git checkout -- ${dir}/package.json package-lock.json`)
		console.error(`release: npm publish failed — ${pkg.name} is back at its previous version, and nothing was committed, tagged or pushed`)
		process.exit(1)
	}
}

run(`git add ${dir}/package.json package-lock.json`)
run(`git commit -q -m "release(${name}): ${version}"`)
run(`git tag -a ${tag} -m "${pkg.name} ${version}"`)
run('git push -q --follow-tags')
const notes = `Install straight from this release:\n\n"${pkg.name}": "${url}"\n` + (toNpm ? `\nor from npm:\n\nnpm i ${pkg.name}@${version}\n` : '')
run(`gh release create ${tag} .release/${file} --title "${pkg.name} ${version}" --notes-file -`, '.', notes)

console.log(`\n${pkg.name} ${version}\n${url}` + (toNpm ? `\nhttps://www.npmjs.com/package/${pkg.name}/v/${version}` : ''))
