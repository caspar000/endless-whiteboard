import { isHiddenRelation, setAssetBridge } from '@lifeboard/node-kit'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { beforeEach, describe, expect, it } from 'vitest'
import { addQuoteToBoard } from './createQuote'

/**
 * Enough of an editor for a quote to land on: shapes in a map, bindings in a list, `run` running.
 *
 * Hand-rolled rather than reaching for node-kit's `fakeBoard`, which is internal to that package's
 * own operation tests. What this has to observe is small and specific — what shapes were created and
 * with what meta — and a stub that shows exactly that reads better than a general fake.
 */
function stubEditor() {
	const shapes = new Map<string, TLShape>()
	const bindings: { fromId: string; toId: string; terminal: string }[] = []
	shapes.set('shape:book', { id: 'shape:book', type: 'node.book', meta: {}, props: {} } as TLShape)

	const editor = {
		run: (fn: () => void) => fn(),
		getShape: (id: TLShapeId) => shapes.get(id as string),
		getCurrentPageShapes: () => [...shapes.values()],
		getShapePageBounds: () => ({ x: 0, y: 0, w: 200, h: 300, maxX: 200, maxY: 300 }),
		createShape: (partial: { id: string; type: string; meta?: Record<string, unknown> }) => {
			shapes.set(partial.id, { meta: {}, props: {}, ...partial } as unknown as TLShape)
		},
		createBindings: (list: { toId: string; fromId: string; props: { terminal: string } }[]) => {
			for (const b of list) bindings.push({ fromId: b.fromId, toId: b.toId, terminal: b.props.terminal })
		},
	}
	return { editor: editor as unknown as Editor, shapes, bindings }
}

const arrows = (shapes: Map<string, TLShape>) => [...shapes.values()].filter((s) => s.type === 'arrow')

describe('addQuoteToBoard', () => {
	beforeEach(() => {
		setAssetBridge({
			store: async () => 'asset:stub',
			url: async () => null,
			delete: async () => {},
		} as never)
	})

	it('relates the quote to its book with exactly one relation', async () => {
		// The count is the assertion: one gesture, one edge. A crop that fired twice used to leave two
		// arrows carrying the same image (see `PdfPage`'s marquee).
		const { editor, shapes, bindings } = stubEditor()
		await addQuoteToBoard(editor, 'shape:book' as TLShapeId, {
			text: 'A passage.',
			location: '12',
			locationLabel: 'Page 12',
		})

		expect(arrows(shapes)).toHaveLength(1)
		// Bound at both ends, which is what makes it an edge rather than a drawing.
		expect(bindings.map((b) => [b.toId, b.terminal])).toEqual([
			['shape:book', 'start'],
			[[...shapes.values()].find((s) => s.type === 'node.quote')!.id, 'end'],
		])
	})

	it('hides the relation, so a reading session does not fan lines across the board', async () => {
		const { editor, shapes } = stubEditor()
		await addQuoteToBoard(editor, 'shape:book' as TLShapeId, {
			text: 'A passage.',
			location: '12',
			locationLabel: 'Page 12',
		})

		// Hidden is a meta bit on the arrow, not a different kind of shape: every table and rollup
		// counts it exactly as it counts a drawn one.
		expect(isHiddenRelation(arrows(shapes)[0])).toBe(true)
	})

	it('leaves the card unrelated when the reader setting is off', async () => {
		const { editor, shapes } = stubEditor()
		await addQuoteToBoard(
			editor,
			'shape:book' as TLShapeId,
			{ text: 'A passage.', location: '12', locationLabel: 'Page 12' },
			false
		)

		expect(arrows(shapes)).toHaveLength(0)
	})
})
