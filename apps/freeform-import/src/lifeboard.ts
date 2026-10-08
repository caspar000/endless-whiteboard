import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	AssetRecordType,
	DefaultColorThemePalette,
	DocumentRecordType,
	PageRecordType,
	createShapeId,
	createTLStore,
	defaultShapeUtils,
	getIndices,
	type Editor,
	type TLAnyShapeUtilConstructor,
	type TLAsset,
	type TLDefaultColorStyle,
	type TLRecord,
	type TLShape,
	type TLStoreSnapshot,
} from '@lifeboard/canvas'
import { assetSrcForHash, createBoardSchema, nodeShapeUtils } from '@lifeboard/schema'
import type { Board, FileRef, Item, LinkMeta, Paragraph, Rgb, Span } from './freeform'

/** A converted board: its snapshot, and the files it refers to by hash. */
export interface Converted {
	snapshot: TLStoreSnapshot
	files: Map<string, Uint8Array>
	/** What was left out, counted by kind ("line", "drawing"). */
	skipped: Map<string, number>
}

/** Freeform text boxes without a size are 18 pt; Lifeboard's `m` text is 24 px, scaled from there. */
const FREEFORM_TEXT_SIZE = 18
const TEXT_SIZE_M = 24

const COLORS = Object.keys(DefaultColorThemePalette.lightMode).filter(
	(key) => typeof (DefaultColorThemePalette.lightMode as unknown as Record<string, unknown>)[key] === 'object'
) as TLDefaultColorStyle[]

const hexRgb = (hex: string): Rgb => {
	const n = parseInt(hex.slice(1), 16)
	return { r: (n >> 16) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 }
}

/** The Lifeboard colour nearest `rgb`, among sticky fills or among text colours. */
function nearestColor(rgb: Rgb, use: 'noteFill' | 'solid'): TLDefaultColorStyle {
	let best: TLDefaultColorStyle = use === 'noteFill' ? 'yellow' : 'black'
	let bestDistance = Infinity
	for (const color of COLORS) {
		const c = hexRgb(DefaultColorThemePalette.lightMode[color][use])
		const distance = (c.r - rgb.r) ** 2 + (c.g - rgb.g) ** 2 + (c.b - rgb.b) ** 2
		if (distance < bestDistance) [best, bestDistance] = [color, distance]
	}
	return best
}

/* ---------------------------------------------------------------------------------- rich text */

type Mark = { type: string; attrs?: Record<string, string> }

function marksOf(span: Span): Mark[] {
	const marks: Mark[] = []
	if (span.bold) marks.push({ type: 'bold' })
	if (span.italic) marks.push({ type: 'italic' })
	if (span.underline) marks.push({ type: 'underline' })
	if (span.strike) marks.push({ type: 'strike' })
	if (span.link) marks.push({ type: 'link', attrs: { href: span.link, target: '_blank' } })
	return marks
}

/** TipTap's document: a paragraph per line, runs of bullet lines gathered into one list. */
function richText(paragraphs: Paragraph[]) {
	const paragraph = (p: Paragraph) => ({
		type: 'paragraph',
		...(p.align && p.align !== 'start' ? { attrs: { textAlign: p.align === 'middle' ? 'center' : 'right' } } : {}),
		...(p.spans.length
			? {
					content: p.spans.map((span) => {
						const marks = marksOf(span)
						return { type: 'text', text: span.text, ...(marks.length ? { marks } : {}) }
					}),
				}
			: {}),
	})
	const content: unknown[] = []
	for (const p of paragraphs) {
		if (p.list === 'bullet') {
			const last = content[content.length - 1] as { type: string; content: unknown[] } | undefined
			const item = { type: 'listItem', content: [paragraph(p)] }
			if (last?.type === 'bulletList') last.content.push(item)
			else content.push({ type: 'bulletList', content: [item] })
		} else {
			content.push(paragraph(p))
		}
	}
	return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

/** A sticky's label sizes (LABEL_FONT_SIZES), its paper's width and padding, and the line height. */
const NOTE_SIZES = [['xl', 32], ['l', 26], ['m', 22], ['s', 18]] as const
const NOTE_PAPER = 200
/** A pinned note's paper is 300 wide, and its text starts under the pin (PINNED_PAPER). */
const PINNED_PAPER = 300
const PINNED_TEXT_TOP = 30
const NOTE_PADDING = 17
const LINE_HEIGHT = 1.35
/** Average character width in ems for the sans face, erring wide. */
const CHAR_WIDTH = 0.66

/**
 * How tall `paragraphs` set at `fontSize` come out, wrapped at `width`: an estimate (there's no layout
 * engine here), wrapping word by word so a long word starts a new line as it would on screen.
 */
function textHeight(paragraphs: Paragraph[], fontSize: number, width: number): number {
	const charWidth = CHAR_WIDTH * fontSize
	let lines = 0
	for (const p of paragraphs) {
		const bold = p.spans.some((s) => s.bold)
		const words = p.spans.map((s) => s.text).join('').split(/\s+/).filter(Boolean)
		let line = 0
		let count = 1
		for (const word of words) {
			const w = word.length * charWidth * (bold ? 1.1 : 1)
			if (line && line + charWidth + w > width) {
				count += Math.max(1, Math.ceil(w / width))
				line = w % width
			} else {
				line += (line ? charWidth : 0) + w
			}
		}
		lines += count
	}
	return lines * fontSize * LINE_HEIGHT
}

/**
 * Freeform shrinks a sticky's text to fit the note; Lifeboard grows the note instead, and only when the
 * text is edited. So: the largest label size, up to the one Freeform asked for, that fits a `width` by
 * `height` label as Freeform has it; and if even the smallest doesn't, `growY` is what's missing.
 */
function fitLabel(paragraphs: Paragraph[], asked: number | undefined, width: number, height: number, canShrink: boolean) {
	const room = width - NOTE_PADDING * 2
	const fits = (px: number) => textHeight(paragraphs, px, room) + NOTE_PADDING * 2 <= height
	const wanted = NOTE_SIZES.findIndex(([, px]) => px <= (asked ?? 24) + 2)
	for (const [size, px] of NOTE_SIZES.slice(Math.max(0, wanted))) if (fits(px)) return { size, growY: 0, shrunk: 0 }
	// A note can set its text smaller than its smallest size (`fontSizeAdjustment`), as Freeform does.
	if (canShrink) for (let px = 17; px >= 9; px--) if (fits(px)) return { size: 's' as const, growY: 0, shrunk: px }
	const px = canShrink ? 9 : 18
	return { size: 's' as const, growY: Math.max(0, textHeight(paragraphs, px, room) + NOTE_PADDING * 2 - height), shrunk: canShrink ? px : 0 }
}

/** The size most of a text is set in. */
function mainFontSize(paragraphs: Paragraph[]): number | undefined {
	const weights = new Map<number, number>()
	for (const p of paragraphs) for (const s of p.spans) if (s.fontSize) weights.set(s.fontSize, (weights.get(s.fontSize) ?? 0) + s.text.length)
	return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0]
}

function mainColor(paragraphs: Paragraph[]): Rgb | undefined {
	for (const p of paragraphs) for (const s of p.spans) if (s.color) return s.color
	return undefined
}

/* ------------------------------------------------------------------------------------- files */

const MIME: Record<string, string> = {
	png: 'image/png',
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	gif: 'image/gif',
	webp: 'image/webp',
	mp4: 'video/mp4',
	mov: 'video/quicktime',
	m4v: 'video/mp4',
	pdf: 'application/pdf',
	epub: 'application/epub+zip',
}

/** What the bytes are, from their first bytes: Freeform often leaves the extension out. */
function sniff(bytes: Uint8Array): string | undefined {
	const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to))
	if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return 'png'
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg'
	if (ascii(0, 3) === 'GIF') return 'gif'
	if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp'
	if (ascii(0, 4) === '%PDF') return 'pdf'
	if (ascii(4, 8) === 'ftyp') {
		const brand = ascii(8, 12)
		if (/^(heic|heix|mif1|msf1|hevc)/.test(brand)) return 'heic'
		return brand === 'qt  ' ? 'mov' : 'mp4'
	}
	if (ascii(0, 2) === 'II' || ascii(0, 2) === 'MM') return 'tiff'
	if (ascii(0, 2) === 'PK') return 'epub'
	return undefined
}

/** Width and height from an image's header, for the formats a browser shows. */
function imageSize(bytes: Uint8Array, kind: string): { w: number; h: number } | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (kind === 'png') return { w: view.getUint32(16), h: view.getUint32(20) }
	if (kind === 'gif') return { w: view.getUint16(6, true), h: view.getUint16(8, true) }
	if (kind === 'jpeg') {
		let i = 2
		while (i + 9 < bytes.length) {
			if (bytes[i] !== 0xff) return undefined
			const marker = bytes[i + 1]!
			const length = view.getUint16(i + 2)
			if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
				return { w: view.getUint16(i + 7), h: view.getUint16(i + 5) }
			}
			i += 2 + length
		}
	}
	return undefined
}

let scratch: string | undefined

/** HEIC and TIFF don't show in a browser: macOS's `sips` turns them into JPEG. */
function toJpeg(bytes: Uint8Array, kind: string): Uint8Array {
	scratch ??= mkdtempSync(join(tmpdir(), 'freeform-import-'))
	const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
	const input = join(scratch, `${name}.${kind}`)
	const output = join(scratch, `${name}.jpeg`)
	writeFileSync(input, bytes)
	execFileSync('sips', ['-s', 'format', 'jpeg', input, '--out', output], { stdio: 'ignore' })
	return readFileSync(output)
}

/** A book's first page or cover as a picture, from macOS's Quick Look; `undefined` if it has none. */
function renderCover(bytes: Uint8Array, kind: string): Uint8Array | undefined {
	scratch ??= mkdtempSync(join(tmpdir(), 'freeform-import-'))
	const name = createHash('sha256').update(bytes).digest('hex').slice(0, 16)
	const input = join(scratch, `${name}.${kind}`)
	writeFileSync(input, bytes)
	try {
		execFileSync('qlmanage', ['-t', '-s', '600', '-o', scratch, input], { stdio: 'ignore', timeout: 60_000 })
		return new Uint8Array(readFileSync(`${input}.png`))
	} catch {
		return undefined
	}
}

/* -------------------------------------------------------------------------------------- board */

/**
 * One Freeform board as a Lifeboard board. Every record goes through a store built from the board
 * schema the app and the server use, so whatever would fail to load fails here instead.
 */
export function convertBoard(board: Board): Converted {
	const schema = createBoardSchema()
	const store = createTLStore({ schema })
	const files = new Map<string, Uint8Array>()
	const skipped = new Map<string, number>()
	const skip = (what: string) => skipped.set(what, (skipped.get(what) ?? 0) + 1)

	// A util only to ask for its defaults: none of them touch the editor for that.
	const utils = new Map<string, { getDefaultProps(): object }>()
	for (const Util of [...defaultShapeUtils, ...nodeShapeUtils()] as TLAnyShapeUtilConstructor[]) {
		utils.set(Util.type, new Util({} as Editor) as unknown as { getDefaultProps(): object })
	}
	const defaults = (type: string) => structuredClone(utils.get(type)!.getDefaultProps()) as Record<string, unknown>

	const store_ = (bytes: Uint8Array) => {
		const hash = createHash('sha256').update(bytes).digest('hex')
		files.set(hash, bytes)
		return assetSrcForHash(hash)
	}
	const read = (file: FileRef) => new Uint8Array(readFileSync(file.path))

	const page = PageRecordType.create({ name: 'Page 1', index: 'a1' as never })
	const records: TLRecord[] = [DocumentRecordType.create({ id: 'document:document' as never }), page]
	const indices = getIndices(board.items.length + 1)
	const shapes: TLShape[] = []
	const assets: TLAsset[] = []

	const shape = (item: Item, type: string, props: Record<string, unknown>, extra: Partial<TLShape> = {}) => {
		shapes.push({
			id: createShapeId(),
			typeName: 'shape',
			type,
			x: item.x,
			y: item.y,
			rotation: 0,
			index: indices[shapes.length + 1]!,
			parentId: page.id,
			isLocked: false,
			opacity: 1,
			meta: { freeformId: item.id },
			props: { ...defaults(type), ...props },
			...extra,
		} as TLShape)
	}

	for (const item of board.items) {
		switch (item.type) {
			case 'sticky': {
				const color = item.fill ? nearestColor(item.fill, 'noteFill') : 'yellow'
				const asked = mainFontSize(item.paragraphs)
				const text = { richText: richText(item.paragraphs), font: 'sans', align: 'middle', verticalAlign: 'middle' }
				// Freeform's stickies come in any proportion; Lifeboard's are at least as tall as they are
				// wide. A wide one becomes a pinned note, which takes any proportion, in the sticky's colour.
				if (item.h < item.w * 0.9) {
					const scale = item.w / PINNED_PAPER
					const paperHeight = item.h / scale
					const fit = fitLabel(item.paragraphs, asked, PINNED_PAPER, paperHeight - PINNED_TEXT_TOP, true)
					shape(item, 'pinned-note', { ...text, color, size: fit.size, scale, paperHeight, growY: fit.growY, fontSizeAdjustment: fit.shrunk })
					break
				}
				const scale = item.w / NOTE_PAPER
				const height = item.h / scale
				const { size, growY, shrunk } = fitLabel(item.paragraphs, asked, NOTE_PAPER, height, true)
				shape(item, 'note', { ...text, color, size, scale, growY: Math.max(0, height - NOTE_PAPER) + growY, fontSizeAdjustment: shrunk })
				break
			}
			case 'text': {
				const size = mainFontSize(item.paragraphs) ?? FREEFORM_TEXT_SIZE
				const scale = size / TEXT_SIZE_M
				const color = mainColor(item.paragraphs)
				shape(item, 'text', {
					richText: richText(item.paragraphs),
					size: 'm',
					font: 'sans',
					color: color ? nearestColor(color, 'solid') : 'black',
					textAlign: item.paragraphs[0]?.align ?? 'start',
					scale,
					// A text Freeform sizes to itself stays that way; a wrapped one gets a little room,
					// as Lifeboard's sans sets a touch wider than Freeform's system font.
					autoSize: item.autoSize,
					w: Math.max((item.w / scale) * 1.08, 16),
				})
				break
			}
			case 'image': {
				let bytes: Uint8Array = read(item.file)
				let kind = sniff(bytes)
				if (kind === 'heic' || kind === 'tiff') {
					bytes = toJpeg(bytes, kind)
					kind = 'jpeg'
				}
				if (!kind || !MIME[kind]) {
					skip('image of an unknown format')
					break
				}
				const natural = imageSize(bytes, kind) ?? item.full
				const asset = AssetRecordType.create({
					id: AssetRecordType.createId(),
					type: 'image',
					props: { name: `image.${kind}`, src: store_(bytes), w: natural.w, h: natural.h, mimeType: MIME[kind]!, isAnimated: kind === 'gif', fileSize: bytes.length },
					meta: {},
				} as TLAsset)
				assets.push(asset)
				const crop = item.crop && {
					topLeft: { x: item.crop.x / item.full.w, y: item.crop.y / item.full.h },
					bottomRight: { x: (item.crop.x + item.crop.w) / item.full.w, y: (item.crop.y + item.crop.h) / item.full.h },
				}
				shape(item, 'image', { w: item.w, h: item.h, assetId: asset.id, ...(crop ? { crop } : {}) })
				break
			}
			case 'video': {
				const bytes = read(item.file)
				const kind = sniff(bytes)
				// Freeform files an animated GIF as a movie; Lifeboard shows it as the image it is.
				if (kind === 'gif') {
					const natural = imageSize(bytes, kind) ?? { w: item.w, h: item.h }
					const asset = AssetRecordType.create({
						id: AssetRecordType.createId(),
						type: 'image',
						props: { name: 'animation.gif', src: store_(bytes), w: natural.w, h: natural.h, mimeType: 'image/gif', isAnimated: true, fileSize: bytes.length },
						meta: {},
					} as TLAsset)
					assets.push(asset)
					shape(item, 'image', { w: item.w, h: item.h, assetId: asset.id })
					break
				}
				if (kind !== 'mp4' && kind !== 'mov') {
					skip('video of an unknown format')
					break
				}
				const asset = AssetRecordType.create({
					id: AssetRecordType.createId(),
					type: 'video',
					props: { name: `video.${kind}`, src: store_(bytes), w: item.w, h: item.h, mimeType: MIME[kind]!, isAnimated: true, fileSize: bytes.length },
					meta: {},
				} as TLAsset)
				assets.push(asset)
				shape(item, 'video', { w: item.w, h: item.h, assetId: asset.id })
				break
			}
			case 'file': {
				const bytes = read(item.file)
				const kind = sniff(bytes) ?? item.file.ext
				if (kind !== 'pdf' && kind !== 'epub') {
					skip(`${kind || 'unknown'} file`)
					break
				}
				const name = item.name || item.meta?.title || `document.${kind}`
				const cover = item.meta?.image ?? renderCover(bytes, kind)
				const coverSrc = cover ? store_(cover) : ''
				shape(item, 'node.book', {
					fileSrc: store_(bytes),
					fileName: /\.(pdf|epub)$/i.test(name) ? name : `${name}.${kind}`,
					format: kind,
					title: name.replace(/\.(pdf|epub)$/i, ''),
					coverSrc,
					autoHeight: true,
					w: item.w,
					h: item.h,
				})
				break
			}
			case 'link': {
				const asset = bookmarkAsset(item.meta, store_)
				assets.push(asset)
				shape(item, 'bookmark', { w: item.w, h: item.h, url: item.meta.url, assetId: asset.id })
				break
			}
			case 'unsupported':
				skip(item.what)
				break
		}
	}

	store.put([...records, ...assets, ...shapes])
	return { snapshot: store.getStoreSnapshot('document'), files, skipped }
}

/** A link card's details, with the preview picture and icon kept as files rather than remote links. */
function bookmarkAsset(meta: LinkMeta, keep: (bytes: Uint8Array) => string): TLAsset {
	return AssetRecordType.create({
		id: AssetRecordType.createId(),
		type: 'bookmark',
		props: {
			src: meta.url,
			title: meta.title || meta.siteName || meta.url,
			description: meta.summary,
			image: meta.image ? keep(meta.image) : '',
			favicon: meta.icon ? keep(meta.icon) : '',
		},
		meta: {},
	} as TLAsset)
}
