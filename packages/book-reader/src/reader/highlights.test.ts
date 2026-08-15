import { optionHue } from '@lifeboard/node-kit'
import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { QUOTE_NODE_TYPE } from '../quote/definition'
import { collectHighlights } from './highlights'

const BOOK = 'shape:book' as TLShapeId

/** A quote card as it sits on the board: its props, plus any property values in meta. */
function quote(
	id: string,
	props: { sourceId?: string; location?: string; rects?: string },
	tag?: string
) {
	return {
		id,
		type: QUOTE_NODE_TYPE,
		props: { sourceId: BOOK, location: 'epubcfi(/6/4!/2)', rects: '', ...props },
		meta: tag ? { 'lifeboard:props': { highlight: tag } } : {},
	}
}

/** Just enough editor: the property registry in document meta, and the shapes on the page. */
function editorWith(registered: boolean, ...shapes: object[]): Editor {
	return {
		getDocumentSettings: () => ({
			meta: {
				'lifeboard:properties': registered
					? [{ id: 'highlight', name: 'Highlight', type: 'select', options: ['Important'] }]
					: [],
			},
		}),
		getCurrentPageShapes: () => shapes as TLShape[],
	} as unknown as Editor
}

describe('collectHighlights', () => {
	it('takes the quotes of this book, and only those', () => {
		const editor = editorWith(
			true,
			quote('shape:a', {}),
			quote('shape:b', { sourceId: 'shape:other' }),
			// A clip made before the reader could place it has nowhere to draw a mark.
			quote('shape:c', { location: '' }),
			{ id: 'shape:d', type: 'node.note', props: {}, meta: {} }
		)

		expect(collectHighlights(editor, BOOK, {}).map((h) => h.quoteId)).toEqual(['shape:a'])
	})

	/*
	 * The regression this file exists for: a tagged quote used to reach a ref declared *below* the
	 * derivation that read it, so the first tag anyone applied made the book impossible to open.
	 */
	it('colours a tagged quote from the configured palette', () => {
		const editor = editorWith(true, quote('shape:a', {}, 'Important'))

		expect(collectHighlights(editor, BOOK, { Important: 47 })[0]?.hue).toBe(47)
	})

	it('falls back to the hash for a tag with no configured colour', () => {
		const editor = editorWith(true, quote('shape:a', {}, 'Later'))

		expect(collectHighlights(editor, BOOK, { Important: 47 })[0]?.hue).toBe(optionHue('Later'))
	})

	it('leaves an untagged quote, and every quote before the property exists, uncoloured', () => {
		expect(collectHighlights(editorWith(true, quote('shape:a', {})), BOOK, {})[0]?.hue).toBe(null)
		expect(
			collectHighlights(editorWith(false, quote('shape:a', {}, 'Important')), BOOK, {})[0]?.hue
		).toBe(null)
	})
})
