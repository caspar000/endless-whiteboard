import { describe, expect, it } from 'vitest'
import { quoteNodeDefinition, quoteTitle } from './definition'

describe('quoteTitle', () => {
	it('collapses whitespace so a wrapped excerpt reads as one line', () => {
		expect(quoteTitle('Call me\n  Ishmael.  ')).toBe('Call me Ishmael.')
	})

	it('truncates long excerpts, because this names a row in a table', () => {
		const title = quoteTitle('word '.repeat(40))
		expect(title.length).toBeLessThanOrEqual(60)
		expect(title.endsWith('…')).toBe(true)
	})

	it('is empty for a quote with no text — a page clip', () => {
		expect(quoteTitle('')).toBe('')
		expect(quoteTitle('   \n ')).toBe('')
	})
})

describe('quoteNodeDefinition', () => {
	it('defaults to an unsourced, empty quote', () => {
		expect(quoteNodeDefinition.defaultProps()).toEqual({
			text: '',
			imageSrc: '',
			sourceId: '',
			location: '',
			locationLabel: '',
			rects: '',
			autoHeight: true,
		})
	})

	it('opens its source on double-click rather than an editor', () => {
		expect(quoteNodeDefinition.canEdit).toBe(true)
	})

	it('names itself from its excerpt, for tables and rollup groups', () => {
		const shape = { props: { text: 'A passage worth keeping.' } }
		expect(quoteNodeDefinition.getLabel?.(shape as never)).toBe('A passage worth keeping.')
	})
})
