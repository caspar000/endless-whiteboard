import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { FreeformRecord, findText } from './crdt'
import { readBoards, type Item } from './freeform'
import { convertBoard } from './lifeboard'

/*
 * Freeform's records, written the way Freeform writes them (see crdt.ts for the encoding), so the
 * converter is tested against the format rather than against anyone's boards.
 */

const varint = (n: number): number[] => {
	const out: number[] = []
	while (n >= 128) {
		out.push((n % 128) | 128)
		n = Math.floor(n / 128)
	}
	out.push(n)
	return out
}
const bytes = (value: string) => [...new TextEncoder().encode(value)]
const field = (f: number, value: number | number[]) =>
	typeof value === 'number' ? [...varint(f * 8), ...varint(value)] : [...varint(f * 8 + 2), ...varint(value.length), ...value]
const float = (f: number, x: number) => {
	const b = new Uint8Array(4)
	new DataView(b.buffer).setFloat32(0, x, true)
	return [...varint(f * 8 + 5), ...b]
}

const num = (x: number) => float(15, x)
const enumOf = (n: number) => field(5, n)
const ref = (n: number) => field(3, n)
/** As Freeform stores one: a zero is left out, so (0, 0) is empty. */
const point = (x: number, y: number) => field(4, [...(x ? float(1, x) : []), ...(y ? float(2, y) : [])])
const list = (...items: number[][]) => field(14, items.flatMap((item) => field(2, item)))
const register = (value: number[]) => field(1, [...field(1, [...field(1, 1), ...field(2, 1)]), ...field(2, value)])
const map = (keys: number[], values: number[][]) => field(4, [...field(1, keys), ...values.flatMap((v) => field(2, register(v)))])

/** A run of `length` characters with `attrs` (string-table index → value). */
const run = (length: number, attrs: Array<[number, number[]]>) =>
	field(6, [...field(1, length), ...attrs.flatMap(([key, value]) => field(2, [...field(1, key), ...field(2, value)]))])
const text = (string: string, ...runs: number[][]) => field(5, [...field(1, bytes(string)), ...runs.flat()])

function record(root: number[], strings: string[], uuids: Uint8Array[] = []): Uint8Array {
	const table = [...field(1, uuids.flatMap((u) => [...u])), ...strings.flatMap((s) => field(2, bytes(s)))]
	return new Uint8Array([...bytes('crdt'), 6, 0, 0, 0, ...field(1, root), ...field(6, table)])
}

/** `common_data`: position and size, as every item has them. */
const place = (x: number, y: number, w: number, h: number) =>
	record(map([0, 1], [field(6, 1), list(field(6, 3), list(point(x, y), point(w, h), num(0)))]), ['a', 'b'])

const uuid = (n: number) => {
	const id = new Uint8Array(16)
	id[15] = n
	return id
}

const PNG = new Uint8Array([
	...[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
	...[0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 64, 0, 0, 0, 32, 8, 6, 0, 0, 0],
])

/** A Freeform data folder with one board: a sticky, a wide sticky, a styled text and a picture. */
function freeformFolder(): string {
	const dir = mkdtempSync(join(tmpdir(), 'freeform-test-'))
	mkdirSync(join(dir, 'Boards', 'Assets'), { recursive: true })
	const db = new DatabaseSync(join(dir, 'Boards', 'boards.db'))
	db.exec(`
		CREATE TABLE boards (board_identifier BLOB, container_uuid BLOB, tombstoned INTEGER);
		CREATE TABLE board_items (item_uuid BLOB, board_identifier BLOB, item_type INTEGER, common_data BLOB, specific_data BLOB, tombstoned INTEGER);
		CREATE TABLE assets (asset_uuid BLOB, extension TEXT);
		CREATE TABLE asset_references (referrer_identifier BLOB, asset_uuid BLOB, referrer_asset_name TEXT);
	`)
	const board = uuid(100)
	const container = uuid(99)
	db.prepare('INSERT INTO boards VALUES (?, ?, 0)').run(board, container)
	const item = db.prepare('INSERT INTO board_items VALUES (?, ?, ?, ?, ?, 0)')
	// The container lists its items in the order they were added.
	item.run(container, board, 2, null, record(field(6, 1), [], [uuid(1), uuid(2), uuid(3), uuid(4)]))

	// Strings: 0 a, 1 b, 2 fontSize, 3 bold, 4 hyperlink, 5 the link's target.
	const strings = ['a', 'b', 'fontSize', 'bold', 'hyperlink', 'https://example.com']
	// The fill sits behind an optional, as Freeform writes it.
	const sticky = (words: string, [r, g, b]: number[]) =>
		record(map([0, 1], [map([0], [field(9, field(1, list(enumOf(0), list(list(enumOf(0), num(r!), num(g!), num(b!))))))]), map([0], [text(words)])]), strings)
	item.run(uuid(1), board, 12, place(0, 0, 200, 200), sticky('Square', [0.6, 0.8, 1]))
	// Freeform's own yellow.
	item.run(uuid(2), board, 12, place(0, 300, 600, 100), sticky('Wide', [1, 0.88, 0.42]))
	item.run(
		uuid(3),
		board,
		3,
		place(400, 0, 300, 60),
		record(map([1], [map([0], [text('Bold link', run(4, [[3, enumOf(2)], [2, num(36)]]), run(5, [[4, list(ref(5))]]))])]), strings)
	)
	// The whole picture is 64 × 32; its window starts at (0, 16) and is 32 × 16, behind an optional.
	const crop = field(9, field(1, list(point(0, 16), point(32, 16), num(0))))
	item.run(uuid(4), board, 5, place(800, 0, 64, 32), record(map([2], [crop]), ['a', 'b', 'c']))
	db.prepare('INSERT INTO assets VALUES (?, ?)').run(uuid(50), 'png')
	db.prepare('INSERT INTO asset_references VALUES (?, ?, ?)').run(uuid(4), uuid(50), 'image')
	writeFileSync(join(dir, 'Boards', 'Assets', '00000000-0000-0000-0000-000000000032.png'), PNG)
	db.close()

	writeFileSync(
		join(dir, 'Snapshot.plist'),
		`<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>rootNodes</key><array><dict><key>viewModel</key><dict>
		<key>title</key><string>Test board</string><key>creationTime</key><date>2025-12-17T06:02:37Z</date>
		<key>boardIdentifier</key><dict><key>storage</key><dict><key>boardUUID</key><string>00000000-0000-0000-0000-000000000064</string></dict></dict>
		</dict></dict></array></dict></plist>`
	)
	return dir
}

describe('Freeform records', () => {
	it('decode: registers, maps by name, points, and text with its runs', () => {
		const decoded = new FreeformRecord(record(map([0], [text('Hi', run(2, [[1, num(24)]]))]), ['a', 'fontSize']))
		expect(findText(decoded.root)).toEqual({ string: 'Hi', runs: [{ length: 2, attrs: { fontSize: 24 } }] })
	})
})

describe.runIf(process.platform === 'darwin')('a Freeform board', () => {
	const [board] = readBoards(freeformFolder())
	const byId = (n: number) => board!.items.find((i) => i.id.endsWith(n.toString(16).toUpperCase().padStart(2, '0')))!

	it('is read with its title, items in order, places, text and styles', () => {
		expect(board).toMatchObject({ title: 'Test board', createdAt: Date.UTC(2025, 11, 17, 6, 2, 37) })
		expect(board!.items.map((i) => i.type)).toEqual(['sticky', 'sticky', 'text', 'image'])
		expect(byId(1)).toMatchObject({ x: 0, y: 0, w: 200, h: 200 })
		expect(byId(2)).toMatchObject({ x: 0, y: 300, w: 600, h: 100 })
		const styled = byId(3) as Extract<Item, { type: 'text' }>
		expect(styled.paragraphs[0]!.spans).toEqual([
			{ text: 'Bold', bold: true, fontSize: 36 },
			{ text: ' link', link: 'https://example.com' },
		])
	})

	it('becomes a Lifeboard board: notes, a wide pinned note, styled text and a stored picture', () => {
		const { snapshot, files } = convertBoard(board!)
		const shapes = Object.values(snapshot.store).filter((r) => r.typeName === 'shape') as unknown as Array<{ type: string; x: number; y: number; props: Record<string, unknown> }>
		expect(shapes.map((s) => s.type)).toEqual(['note', 'pinned-note', 'text', 'image'])

		const [note, pinned, label] = shapes
		expect(note!.props).toMatchObject({ color: 'light-blue', scale: 1 })
		expect(pinned!.props).toMatchObject({ color: 'yellow', scale: 2, paperHeight: 50 })
		expect(label!.props.scale).toBe(1.5)
		expect(JSON.stringify(label!.props.richText)).toContain('"type":"bold"')
		expect(JSON.stringify(label!.props.richText)).toContain('"href":"https://example.com"')

		const picture = shapes[3]!
		expect(picture).toMatchObject({ x: 800, y: 16, props: { w: 32, h: 16, crop: { topLeft: { x: 0, y: 0.5 }, bottomRight: { x: 0.5, y: 1 } } } })

		const image = Object.values(snapshot.store).find((r) => r.typeName === 'asset') as { props: { src: string; w: number; h: number } }
		expect(image.props).toMatchObject({ w: 64, h: 32 })
		expect(files.has(image.props.src.slice('asset:'.length))).toBe(true)
	})
})
