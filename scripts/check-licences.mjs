#!/usr/bin/env node
/**
 * Lists every package in the lockfile that is under the tldraw licence, which forbids production use
 * without a key (docs/canvas-engine-options.md). Lifeboard is moving to an Apache-2.0 fork, and this is
 * what keeps licensed code from coming back once it has gone.
 *
 *   pnpm check:licences            report only
 *   pnpm check:licences --strict   exit 1 if anything is found (from the cutover phase on)
 *
 * The licence is read from each installed package, not assumed from its name: tldraw's data packages
 * (`@tldraw/store`, `tlschema`, `state`, `utils`, `validate`) are MIT, and the 2023 releases the fork
 * comes from are Apache-2.0. Anything else declared as "SEE LICENSE IN …" or "UNLICENSED" is reported
 * too, as a warning, because that is how non-open-source packages usually say so.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const strict = process.argv.includes('--strict')
const OPEN = /^(MIT|ISC|BSD-[23]-Clause|Apache-2\.0|MPL-2\.0|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Unlicense|Python-2\.0|Zlib|OFL-1\.1|CC-BY-4\.0|\(MIT OR [^)]+\)|\([^)]+ OR MIT\))$/

/** `name@version` for every package the lockfile resolves. */
function lockedPackages() {
	const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
	const section = lock.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0] ?? ''
	const found = new Set()
	for (const match of section.matchAll(/^ {2}'?((?:@[^/\s]+\/)?[^@\s']+)@([^:'(\s]+)/gm)) {
		found.add(`${match[1]}@${match[2]}`)
	}
	return [...found]
}

/** The `license` field of the installed copy, or null if it isn't installed. */
function licenceOf(name, version) {
	const store = join(root, 'node_modules/.pnpm')
	const prefix = `${name.replace('/', '+')}@${version}`
	const dir = readdirSync(store).find((entry) => entry === prefix || entry.startsWith(`${prefix}_`))
	if (!dir) return null
	const manifest = join(store, dir, 'node_modules', name, 'package.json')
	if (!existsSync(manifest)) return null
	const { license } = JSON.parse(readFileSync(manifest, 'utf8'))
	return typeof license === 'string' ? license : (license?.type ?? 'none')
}

const licensed = []
const unclear = []
for (const id of lockedPackages()) {
	const at = id.lastIndexOf('@')
	const name = id.slice(0, at)
	const version = id.slice(at + 1)
	const licence = licenceOf(name, version)
	if (licence === null || OPEN.test(licence)) continue
	if (name === 'tldraw' || name.startsWith('@tldraw/')) licensed.push(`${id}  (${licence})`)
	else unclear.push(`${id}  (${licence})`)
}

if (licensed.length) {
	console.log(`Under the tldraw licence (${licensed.length}):`)
	for (const line of licensed.sort()) console.log(`  ${line}`)
} else {
	console.log('No packages under the tldraw licence.')
}
if (unclear.length) {
	console.log(`\nNot declared as open source — check these by hand (${unclear.length}):`)
	for (const line of unclear.sort()) console.log(`  ${line}`)
}

if (strict && licensed.length) process.exit(1)
