import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { zipSync, type Zippable } from 'fflate'
import { readBoards } from './freeform'
import { convertBoard } from './lifeboard'

/**
 * Turns Freeform's boards into a Lifeboard backup, to import in Settings → Storage. It reads a copy
 * of Freeform's database (the live one is never opened) and Freeform's files where they are, without
 * changing anything. Reading Freeform's folder needs Full Disk Access for the terminal running this.
 *
 *   pnpm --filter @lifeboard/freeform-import convert -- --out ~/Desktop/freeform.zip
 *   … --board Moodboard --board "Books & Blogs"     only these boards
 *   … --list                                        list the boards and what they hold
 */
const FREEFORM = join(homedir(), 'Library/Group Containers/group.com.apple.freeform')

const { values } = parseArgs({
	options: {
		source: { type: 'string', default: FREEFORM },
		out: { type: 'string', default: join(homedir(), 'Desktop', 'freeform-boards.zip') },
		board: { type: 'string', multiple: true },
		list: { type: 'boolean', default: false },
	},
})

const source = resolve(values.source!)
if (!existsSync(join(source, 'Boards', 'boards.db'))) {
	console.error(`No Freeform boards in ${source}. If Freeform keeps them there, give this terminal Full Disk Access.`)
	process.exit(1)
}
try {
	execFileSync('pgrep', ['-x', 'Freeform'], { stdio: 'ignore' })
	console.warn('Freeform is open: quit it first, or the newest changes may be missing.')
} catch {
	// Not running.
}

// A consistent copy: the database with its write-ahead log, and the snapshot that names the boards.
const copy = mkdtempSync(join(tmpdir(), 'freeform-copy-'))
mkdirSync(join(copy, 'Boards'))
for (const name of ['boards.db', 'boards.db-wal', 'boards.db-shm']) {
	const from = join(source, 'Boards', name)
	if (existsSync(from)) copyFileSync(from, join(copy, 'Boards', name))
}
if (existsSync(join(source, 'Snapshot.plist'))) copyFileSync(join(source, 'Snapshot.plist'), join(copy, 'Snapshot.plist'))
symlinkSync(join(source, 'Boards', 'Assets'), join(copy, 'Boards', 'Assets'))

const wanted = values.board?.map((name) => name.toLowerCase())
const boards = readBoards(copy).filter((board) => !wanted || wanted.includes(board.title.toLowerCase()))
if (wanted && boards.length < wanted.length) {
	const found = new Set(boards.map((b) => b.title.toLowerCase()))
	console.warn(`Not found: ${wanted.filter((name) => !found.has(name)).join(', ')}`)
}

if (values.list) {
	for (const board of boards.sort((a, b) => b.items.length - a.items.length)) {
		const kinds = new Map<string, number>()
		for (const item of board.items) {
			const kind = item.type === 'unsupported' ? item.what : item.type
			kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
		}
		const summary = [...kinds].map(([kind, n]) => `${n} ${kind}`).join(', ')
		console.log(`${board.title.padEnd(28)} ${summary}`)
	}
	process.exit(0)
}

const files: Zippable = {}
const manifest = { formatVersion: 1, appVersion: 'freeform-import', exportedAt: Date.now(), boards: [] as object[] }
const skippedTotal = new Map<string, number>()
for (const board of boards) {
	const { snapshot, files: blobs, skipped } = convertBoard(board)
	const id = crypto.randomUUID()
	files[`boards/${id}.json`] = new TextEncoder().encode(JSON.stringify(snapshot))
	// Pictures and files are compressed already; zipping them again only costs time.
	for (const [hash, bytes] of blobs) files[`assets/${hash}`] = [bytes, { level: 0 }]
	const now = Date.now()
	manifest.boards.push({ id, name: board.title, createdAt: board.createdAt ?? now, updatedAt: board.updatedAt ?? now })
	const left = [...skipped].map(([what, n]) => `${n} ${what}`).join(', ')
	console.log(`${board.title}: ${board.items.length - [...skipped.values()].reduce((a, b) => a + b, 0)} items${left ? ` (left out: ${left})` : ''}`)
	for (const [what, n] of skipped) skippedTotal.set(what, (skippedTotal.get(what) ?? 0) + n)
}
files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2))

const out = resolve(values.out!)
writeFileSync(out, zipSync(files))
console.log(`\nWrote ${boards.length} boards to ${out}. Import it in Lifeboard: Settings → Storage → Import backup.`)

// Something the canvas package starts keeps a timer alive; the work is done.
process.exit(0)
