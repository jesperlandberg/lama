#!/usr/bin/env node
/*
 * A package's skill carries the package's own source, as one file an agent
 * copies into a project. This writes that copy:
 *
 *   node scripts/skill.mjs sticky     packages/sticky/src/index.ts
 *                                     -> skills/sticky/sticky.ts
 *
 * with a first line naming the version, so a copy found in a project can be
 * told from a newer one. The release runs it after the bump, and the package's
 * tests fail when the copy and the source differ, so the two cannot drift.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [name] = process.argv.slice(2)

if (!name) {
	console.error('usage: node scripts/skill.mjs <package>')
	process.exit(1)
}

const pkg = JSON.parse(readFileSync(`packages/${name}/package.json`, 'utf8'))
const source = readFileSync(`packages/${name}/src/index.ts`, 'utf8')
const banner = `/* ${pkg.name} ${pkg.version} · one file, no dependencies · from the ${name} skill, github.com/jesperlandberg/alpacka */`

writeFileSync(`skills/${name}/${name}.ts`, `${banner}\n${source}`)
console.log(`skills/${name}/${name}.ts  ${pkg.name} ${pkg.version}`)
