// Writes src/app/boardLook/tablerIcons.json: every Tabler outline icon a board can wear, with the words
// to search it by. Run after upgrading @tabler/icons:
//
//   node scripts/build-board-icons.mjs
//
// Read from the package's own files: its exports map only exposes the SVGs, so the app cannot import
// these JSON files itself, and the catalogue is trimmed to what the picker needs (no unicode points,
// versions or filled variants).
import { readFileSync, writeFileSync } from 'node:fs'

const pkg = new URL('../node_modules/@tabler/icons/', import.meta.url)
const read = (file) => JSON.parse(readFileSync(new URL(file, pkg), 'utf8'))

const { version } = read('package.json')
const meta = read('icons.json')
const nodes = read('tabler-nodes-outline.json')

const icons = Object.entries(nodes)
	// The crossed-out variants ("bike-off") say "not this", which is rarely what a board is about, and
	// they are a fifth of the set: in a category they crowd out the icons someone is looking for.
	.filter(([name]) => !name.endsWith('-off'))
	.sort(([a], [b]) => a.localeCompare(b))
	.map(([name, elements]) => {
		const { category = '', tags = [] } = meta[name] ?? {}
		// Every element is a path. Most need only `d`; a few also set fill, stroke or opacity.
		const paths = elements.map(([, { d, ...rest }]) => (Object.keys(rest).length ? [d, rest] : d))
		return [name, category, tags.join(' ').toLowerCase(), paths]
	})

const out = new URL('../src/app/boardLook/tablerIcons.json', import.meta.url)
writeFileSync(out, JSON.stringify({ version, icons }))
console.log(`Wrote ${icons.length} icons from @tabler/icons ${version}.`)
