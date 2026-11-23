import { TLShape, TLShapeId, createShapeId, toRichText } from '@lifeboard/canvas-editor'
import { compressToBase64 } from 'lz-string'
import {
	clipboardPayloadIn,
	handleNativeOrMenuCopy,
	handlePasteFromEventClipboardData,
} from '../lib/ui/hooks/useClipboardEvents'
import { TestEditor } from './TestEditor'

/**
 * Sticky and pinned notes copy and paste (DARK-16).
 *
 * Firefox 127+ sanitizes the html a page writes to the clipboard and drops elements it doesn't know.
 * Copied shapes were written inside a made-up `<tldraw>` element, so a note's paste found no shapes
 * and fell through to its plain text, a blank: nothing was pasted.
 */

let editor: TestEditor
let written: Record<string, Blob>[] = []

beforeAll(() => jest.useRealTimers())
beforeEach(() => {
	written = []
	Object.defineProperty(navigator, 'clipboard', {
		configurable: true,
		value: { write: async (items: Record<string, Blob>[]) => void written.push(...items) },
	})
	// The test editor's ClipboardItem drops what it is given; this one keeps it to read back.
	;(globalThis as { ClipboardItem: unknown }).ClipboardItem = class {
		constructor(items: Record<string, Blob>) {
			return items
		}
	}
	editor = new TestEditor()
})
afterEach(() => editor?.dispose())

const settle = () => new Promise((resolve) => setTimeout(resolve, 20))

/** What a browser that sanitizes clipboard html leaves: unknown elements gone, their text kept. */
function sanitized(html: string): string {
	const doc = new DOMParser().parseFromString(html, 'text/html')
	for (const element of [...doc.body.querySelectorAll('*')]) {
		if (element instanceof HTMLUnknownElement) element.replaceWith(...element.childNodes)
	}
	return `<html><head><meta charset="utf-8"></head><body>${doc.body.innerHTML}</body></html>`
}

/** A paste event's clipboard, with text kinds only. */
function clipboard(data: Record<string, string>): DataTransfer {
	const entries = Object.entries(data)
	return {
		types: entries.map(([type]) => type),
		files: [] as unknown as FileList,
		getData: (type: string) => data[type] ?? '',
		items: entries.map(([type, value]) => ({
			kind: 'string',
			type,
			getAsString: (callback: (value: string) => void) => setTimeout(() => callback(value)),
		})),
	} as unknown as DataTransfer
}

/** Copies the shapes as ⌘C would, and returns the clipboard a sanitizing browser hands to the paste. */
async function copy(...ids: TLShapeId[]): Promise<DataTransfer> {
	editor.select(...ids)
	expect(handleNativeOrMenuCopy(editor, 'copy')).toBe(true)
	expect(written).toHaveLength(1)
	const item = written[0]!
	return clipboard({
		'text/html': sanitized(await item['text/html']!.text()),
		'text/plain': await item['text/plain']!.text(),
	})
}

/** The record as a paste should reproduce it: everything but where it lives in the store. */
function content(shape: TLShape) {
	const { id: _id, index: _index, ...rest } = shape
	return rest
}

const sticky = createShapeId('sticky')
const pinned = createShapeId('pinned')

describe('Copying and pasting notes (DARK-16)', () => {
	beforeEach(() => {
		editor.createShapes([
			{
				id: sticky,
				type: 'note',
				x: 100,
				y: 100,
				props: { richText: toRichText('Buy milk'), color: 'blue', size: 'l' },
				meta: { lifeboard: 'kept' },
			},
			{
				id: pinned,
				type: 'pinned-note',
				x: 400,
				y: 100,
				props: { richText: toRichText('Call the plumber'), color: 'green', pinColor: 'violet' },
			},
		])
	})

	it.each([
		['sticky note', sticky],
		['pinned note', pinned],
	])('pastes a %s with its text, colours and size', async (_name, id) => {
		const original = editor.getShape(id)!
		const data = await copy(id)
		await handlePasteFromEventClipboardData(editor, data)
		await settle()

		const copies = editor.getCurrentPageShapes().filter((shape) => shape.type === original.type && shape.id !== id)
		expect(copies).toHaveLength(1)
		expect(content(copies[0]!)).toEqual(content(original))
		expect(editor.getSelectedShapeIds()).toEqual([copies[0]!.id])
	})

	it('pastes both together', async () => {
		const data = await copy(sticky, pinned)
		await handlePasteFromEventClipboardData(editor, data)
		await settle()
		expect(editor.getCurrentPageShapes().map((shape) => shape.type).sort()).toEqual([
			'note',
			'note',
			'pinned-note',
			'pinned-note',
		])
	})

	it('writes the shapes inside an element a sanitizer keeps', async () => {
		editor.select(sticky)
		handleNativeOrMenuCopy(editor, 'copy')
		const html = await written[0]!['text/html']!.text()
		expect(html).toMatch(/^<div data-tldraw>[^<]+<\/div>$/)
		expect(clipboardPayloadIn(sanitized(html))).toBe(clipboardPayloadIn(html))
	})

	it('still pastes the old <tldraw> form', async () => {
		const shapes = editor.getContentFromCurrentPage([sticky])!
		const payload = compressToBase64(JSON.stringify({ type: 'application/tldraw', kind: 'content', data: shapes }))
		await handlePasteFromEventClipboardData(editor, clipboard({ 'text/html': `<tldraw>${payload}</tldraw>`, 'text/plain': ' ' }))
		await settle()
		expect(editor.getCurrentPageShapes().filter((shape) => shape.type === 'note')).toHaveLength(2)
	})
})
