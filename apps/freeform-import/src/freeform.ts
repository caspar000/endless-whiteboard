import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { FreeformRecord, findColor, findText, isMap, isPoint, num, walk, type FreeformText, type Value } from './crdt'
import { isBytes, parseMessage } from './protobuf'
import { parseBinaryPlist, unarchive, type PlistValue } from './plist'

/**
 * Freeform's boards, read from a copy of its data folder (`Boards/` beside `Snapshot.plist`) into a
 * plain model the converter maps onto Lifeboard. Item kinds are `board_items.item_type`:
 * 2 container, 3 text, 4 line, 5 image, 6 video (or animated GIF), 7 file, 8 link, 10 drawing, 12 sticky
 * note. A drawing item only orders its strokes; the strokes are in `freehand_drawing_buckets`.
 *
 * Positions are the top-left corner in board points. What isn't decoded (lines, drawings)
 * comes back as `unsupported`, so the report can say what was left behind.
 */

export interface Rgb {
	r: number
	g: number
	b: number
}

export interface Span {
	text: string
	bold?: boolean
	italic?: boolean
	underline?: boolean
	strike?: boolean
	link?: string
	fontSize?: number
	color?: Rgb
}

export interface Paragraph {
	spans: Span[]
	list?: 'bullet'
	align?: 'start' | 'middle' | 'end'
}

export interface FileRef {
	path: string
	/** The extension Freeform recorded, lower case; often empty. */
	ext: string
}

export interface LinkMeta {
	url: string
	title: string
	summary: string
	siteName: string
	image?: Uint8Array
	icon?: Uint8Array
}

interface Base {
	id: string
	x: number
	y: number
	w: number
	h: number
}

export type Item =
	| (Base & { type: 'sticky'; paragraphs: Paragraph[]; fill?: Rgb })
	/** `autoSize`: Freeform sizes it to its text, rather than wrapping it at a width. */
	| (Base & { type: 'text'; paragraphs: Paragraph[]; autoSize: boolean })
	| (Base & { type: 'image'; file: FileRef; full: { w: number; h: number }; crop?: { x: number; y: number; w: number; h: number } })
	| (Base & { type: 'video'; file: FileRef; poster?: FileRef })
	| (Base & { type: 'file'; file: FileRef; name?: string; meta?: LinkMeta })
	| (Base & { type: 'link'; meta: LinkMeta })
	| (Base & { type: 'unsupported'; what: string })

export interface Board {
	uuid: string
	title: string
	createdAt?: number
	updatedAt?: number
	items: Item[]
}

const KINDS: Record<number, string> = { 3: 'text', 4: 'line', 5: 'image', 6: 'video', 7: 'file', 8: 'link', 10: 'drawing', 12: 'sticky' }

const uuidString = (bytes: Uint8Array) => {
	const hex = Buffer.from(bytes).toString('hex').toUpperCase()
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

export function readBoards(dataDir: string): Board[] {
	const db = new DatabaseSync(join(dataDir, 'Boards', 'boards.db'), { readOnly: true })
	try {
		const titles = readTitles(join(dataDir, 'Snapshot.plist'))
		const assets = new Map<string, FileRef>()
		for (const row of db.prepare('SELECT asset_uuid, extension FROM assets').all() as Array<{ asset_uuid: Uint8Array; extension: string | null }>) {
			const name = uuidString(row.asset_uuid)
			const ext = (row.extension ?? '').toLowerCase()
			const path = join(dataDir, 'Boards', 'Assets', ext ? `${name}.${ext}` : name)
			assets.set(Buffer.from(row.asset_uuid).toString('hex'), { path, ext })
		}
		const refsOf = (itemId: Uint8Array) => {
			const refs = new Map<string, FileRef>()
			for (const row of db
				.prepare('SELECT referrer_asset_name, asset_uuid FROM asset_references WHERE referrer_identifier = ?')
				.all(itemId) as Array<{ referrer_asset_name: string; asset_uuid: Uint8Array }>) {
				const file = assets.get(Buffer.from(row.asset_uuid).toString('hex'))
				if (file && existsSync(file.path)) refs.set(row.referrer_asset_name, file)
			}
			return refs
		}
		const boards: Board[] = []
		const rows = db
			.prepare('SELECT board_identifier, container_uuid FROM boards WHERE tombstoned = 0')
			.all() as Array<{ board_identifier: Uint8Array; container_uuid: Uint8Array }>
		for (const row of rows) {
			const uuid = uuidString(row.board_identifier.subarray(0, 16))
			const meta = titles.get(uuid)
			const order = containerOrder(db, row.board_identifier, row.container_uuid)
			const items: Item[] = []
			const itemRows = db
				.prepare(
					'SELECT item_uuid, item_type, common_data, specific_data FROM board_items WHERE board_identifier = ? AND tombstoned = 0 AND item_type != 2'
				)
				.all(row.board_identifier) as Array<{ item_uuid: Uint8Array; item_type: number; common_data: Uint8Array | null; specific_data: Uint8Array | null }>
			for (const item of itemRows) {
				const converted = readItem(item, refsOf(item.item_uuid))
				if (converted) items.push(converted)
			}
			items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
			boards.push({
				uuid,
				title: meta?.title ?? 'Untitled',
				...(meta?.createdAt ? { createdAt: meta.createdAt } : {}),
				...(meta?.updatedAt ? { updatedAt: meta.updatedAt } : {}),
				items,
			})
		}
		return boards
	} finally {
		db.close()
	}
}

/** Board titles and dates live in the app's snapshot of its board list, not in the database. */
function readTitles(path: string): Map<string, { title: string; createdAt?: number; updatedAt?: number }> {
	const titles = new Map<string, { title: string; createdAt?: number; updatedAt?: number }>()
	if (!existsSync(path)) return titles
	const visit = (value: PlistValue) => {
		if (Array.isArray(value)) return value.forEach(visit)
		if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array) return
		const model = (value as { viewModel?: PlistValue }).viewModel as
			| { title?: string; creationTime?: Date; activityTime?: Date; boardIdentifier?: { storage?: { boardUUID?: string } } }
			| undefined
		const uuid = model?.boardIdentifier?.storage?.boardUUID
		if (uuid && typeof model?.title === 'string') {
			titles.set(uuid.toUpperCase(), {
				title: model.title,
				...(model.creationTime instanceof Date ? { createdAt: model.creationTime.getTime() } : {}),
				...(model.activityTime instanceof Date ? { updatedAt: model.activityTime.getTime() } : {}),
			})
		}
		Object.values(value).forEach(visit)
	}
	// Written as XML; `plutil` hands it over in the binary form the parser reads.
	visit(parseBinaryPlist(execFileSync('plutil', ['-convert', 'binary1', '-o', '-', path])))
	return titles
}

/**
 * Stacking order. The board's container lists the UUIDs it mentions in the order it met them, which
 * is the order the items were added to the board; that is close to Freeform's stacking, and exact
 * for boards nobody reordered by hand.
 */
function containerOrder(db: DatabaseSync, board: Uint8Array, container: Uint8Array): Map<string, number> {
	const row = db.prepare('SELECT specific_data FROM board_items WHERE board_identifier = ? AND item_uuid = ?').get(board, container) as
		| { specific_data: Uint8Array | null }
		| undefined
	const order = new Map<string, number>()
	if (!row?.specific_data) return order
	new FreeformRecord(row.specific_data).uuids.forEach((id, i) => {
		const key = uuidString(id)
		if (!order.has(key)) order.set(key, i)
	})
	return order
}

/** `[point, point | {}, float, …]`: position, size (absent for a text that sizes itself), rotation. */
function geometry(common: Value): { x: number; y: number; w?: number; h?: number } | undefined {
	for (const node of walk(common)) {
		if (Array.isArray(node) && node.length >= 3 && isPoint(node[0]) && typeof node[2] === 'number') {
			const size = isPoint(node[1]) ? node[1] : undefined
			return { x: node[0].x, y: node[0].y, ...(size ? { w: size.x, h: size.y } : {}) }
		}
	}
	return undefined
}

/** A self-sizing text's measured size: `[{}, point]`. */
function measuredSize(common: Value): { w: number; h: number } | undefined {
	for (const node of walk(common)) {
		if (Array.isArray(node) && node.length === 2 && isPoint(node[1]) && node[0] && typeof node[0] === 'object' && !Array.isArray(node[0]) && node[0].kind === 'raw') {
			return { w: node[1].x, h: node[1].y }
		}
	}
	return undefined
}

function readItem(
	row: { item_uuid: Uint8Array; item_type: number; common_data: Uint8Array | null; specific_data: Uint8Array | null },
	refs: Map<string, FileRef>
): Item | undefined {
	const place = row.common_data ? geometry(new FreeformRecord(row.common_data).root) : undefined
	if (!place) return { id: uuidString(row.item_uuid), x: 0, y: 0, w: 0, h: 0, type: 'unsupported', what: `${KINDS[row.item_type] ?? 'item'} without a position` }
	const common = new FreeformRecord(row.common_data!)
	const size = place.w !== undefined && place.h !== undefined ? { w: place.w, h: place.h } : measuredSize(common.root)
	const base = { id: uuidString(row.item_uuid), x: place.x, y: place.y, w: size?.w ?? 200, h: size?.h ?? 40 }
	const specific = row.specific_data ? new FreeformRecord(row.specific_data) : undefined

	switch (row.item_type) {
		case 12:
		case 3: {
			const text = specific && findText(specific.root)
			const paragraphs = text ? toParagraphs(text, specific) : []
			if (row.item_type === 3) return { ...base, type: 'text', paragraphs, autoSize: place.w === undefined }
			// The note's colour is the first colour in its record; its text colours live in the runs.
			const fill = specific && isMap(specific.root) ? findColor(specific.root.entries.a ?? null) : undefined
			return { ...base, type: 'sticky', paragraphs, ...(fill ? { fill } : {}) }
		}
		case 5: {
			const file = refs.get('image')
			if (!file) return { ...base, type: 'unsupported', what: 'image whose file is missing' }
			const crop = specific && readCrop(specific.root, base)
			if (crop) {
				return { ...base, x: base.x + crop.x, y: base.y + crop.y, w: crop.w, h: crop.h, type: 'image', file, full: { w: base.w, h: base.h }, crop }
			}
			return { ...base, type: 'image', file, full: { w: base.w, h: base.h } }
		}
		case 6: {
			const file = refs.get('movie')
			if (!file) return { ...base, type: 'unsupported', what: 'video whose file is missing' }
			const poster = refs.get('posterImage')
			return { ...base, type: 'video', file, ...(poster ? { poster } : {}) }
		}
		case 7: {
			const file = refs.get('file')
			if (!file) return { ...base, type: 'unsupported', what: 'file that is missing' }
			const meta = readLinkMeta(refs.get('linkMetadata'))
			const name = row.specific_data ? fileName(row.specific_data) : undefined
			return { ...base, type: 'file', file, ...(name ? { name } : {}), ...(meta ? { meta } : {}) }
		}
		case 8: {
			const meta = readLinkMeta(refs.get('linkMetadata'))
			return meta ? { ...base, type: 'link', meta } : { ...base, type: 'unsupported', what: 'link without its details' }
		}
		default:
			return { ...base, type: 'unsupported', what: KINDS[row.item_type] ?? `kind ${row.item_type}` }
	}
}

/**
 * A cropped image's record keeps the whole picture's size as the item's, and the visible window as an
 * offset and a size inside it: `[point(offset), point(size), rotation, …]` under the record's `c`.
 */
function readCrop(root: Value, full: { w: number; h: number }) {
	if (!isMap(root)) return undefined
	for (const node of walk(root.entries.c ?? null)) {
		if (Array.isArray(node) && node.length >= 3 && isPoint(node[0]) && isPoint(node[1]) && typeof node[2] === 'number') {
			const [offset, size] = [node[0], node[1]]
			const isWhole = Math.abs(size.x - full.w) < 0.5 && Math.abs(size.y - full.h) < 0.5
			if (isWhole || size.x <= 0 || size.y <= 0) return undefined
			return { x: offset.x, y: offset.y, w: size.x, h: size.y }
		}
	}
	return undefined
}

/** A file item's original name: the one string in its record that ends like a file name. */
function fileName(blob: Uint8Array): string | undefined {
	const found: string[] = []
	const visit = (bytes: Uint8Array, depth: number) => {
		const fields = depth < 30 ? parseMessage(bytes) : null
		if (!fields) return
		for (const f of fields) {
			if (!isBytes(f.value) || !f.value.length) continue
			const text = new TextDecoder('utf-8', { fatal: false }).decode(f.value)
			if (/^[^\u0000-\u001f]{1,200}\.[A-Za-z0-9]{2,5}$/.test(text)) found.push(text)
			else visit(f.value, depth + 1)
		}
	}
	visit(blob.subarray(8), 0)
	return found[0]
}

/** A link's details: Apple's LPLinkMetadata, archived. The preview image and icon come embedded. */
function readLinkMeta(file: FileRef | undefined): LinkMeta | undefined {
	if (!file) return undefined
	try {
		const meta = unarchive(readFileSync(file.path)) as Record<string, PlistValue>
		const url = (meta.URL ?? meta.originalURL) as string | undefined
		if (!url) return undefined
		const dataOf = (value: PlistValue | undefined) => {
			const data = (value as { data?: PlistValue } | null)?.data
			return data instanceof Uint8Array ? data : undefined
		}
		const image = dataOf(meta.image)
		const icon = dataOf(meta.icon)
		return {
			url,
			title: typeof meta.title === 'string' ? meta.title : '',
			summary: typeof meta.summary === 'string' ? meta.summary : '',
			siteName: typeof meta.siteName === 'string' ? meta.siteName : '',
			...(image ? { image } : {}),
			...(icon ? { icon } : {}),
		}
	} catch {
		return undefined
	}
}

/* ---------------------------------------------------------------------------------------- text */

const isOn = (v: Value | undefined) => (num(v) ?? 0) !== 0

/**
 * Text as paragraphs of styled spans. Paragraph attributes (list, alignment) sit on the runs that
 * cover a paragraph, so a paragraph takes them from the run its first character is in.
 * `paragraphAlignment` is Apple's text alignment doubled: 0 left, 2 centre, 4 right, 8 natural.
 */
function toParagraphs(text: FreeformText, record: FreeformRecord): Paragraph[] {
	const paragraphs: Paragraph[] = [{ spans: [] }]
	let at = 0
	const runs = text.runs.length ? text.runs : [{ length: text.string.length, attrs: {} }]
	for (const run of runs) {
		const chunk = text.string.slice(at, at + run.length)
		at += run.length
		const { attrs } = run
		const link = attrs.hyperlink && linkTarget(attrs.hyperlink, record)
		const color = attrs.characterFill ? findColor(attrs.characterFill) : undefined
		const style: Omit<Span, 'text'> = {
			...(isOn(attrs.bold) ? { bold: true } : {}),
			...(isOn(attrs.italic) ? { italic: true } : {}),
			...(isOn(attrs.underline) ? { underline: true } : {}),
			...(isOn(attrs.strikethrough) ? { strike: true } : {}),
			...(link ? { link } : {}),
			...(typeof attrs.fontSize === 'number' ? { fontSize: attrs.fontSize } : {}),
			...(color ? { color } : {}),
		}
		const lines = chunk.split('\n')
		lines.forEach((line, i) => {
			const paragraph = paragraphs[paragraphs.length - 1]!
			if (!paragraph.spans.length && paragraph.list === undefined) {
				if ((num(attrs.listStyle) ?? 0) > 0) paragraph.list = 'bullet'
				const align = num(attrs.paragraphAlignment)
				if (align === 2) paragraph.align = 'middle'
				else if (align === 4) paragraph.align = 'end'
			}
			if (line) paragraph.spans.push({ text: line, ...style })
			if (i < lines.length - 1) paragraphs.push({ spans: [] })
		})
	}
	// Freeform ends most texts with a newline; an empty last paragraph would add a blank line.
	while (paragraphs.length > 1 && !paragraphs[paragraphs.length - 1]!.spans.length) paragraphs.pop()
	return paragraphs
}

/** A hyperlink attribute points at its URL in the record's string table. */
function linkTarget(value: Value, record: FreeformRecord): string | undefined {
	for (const node of walk(value)) {
		if (node && typeof node === 'object' && !Array.isArray(node) && node.kind === 'ref') {
			const target = record.string(node.value)
			if (target && /^(https?|mailto):/i.test(target)) return target
		}
	}
	return undefined
}
