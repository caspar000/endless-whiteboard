import { describe, expect, it } from 'vitest'
import { buildEdgeIndex } from '../edges'
import type { FactsMap, ShapeFacts } from '../facts'
import type { PropertyDef, PropertyValue } from '../properties/types'
import { renderExpressions, type ExpressionContext } from './expressions'

const REGISTRY = new Map<string, PropertyDef>([
	['price', { id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }],
	['unit_price', { id: 'unit_price', name: 'Unit price', type: 'number' }],
	['rating', { id: 'rating', name: 'Quality', type: 'rating' }],
])

function shape(
	id: string,
	values: Record<string, PropertyValue>,
	opts: { label?: string; type?: string } = {}
): [string, ShapeFacts] {
	return [
		id,
		{ type: opts.type ?? 'note', parentId: null, label: opts.label ?? id, values, units: {} },
	]
}

const FACTS: FactsMap = new Map([
	shape('me', { price: 500 }, { label: 'October' }),
	shape('a', { price: 1200, rating: 4 }, { label: 'Rent' }),
	shape('b', { price: 340, rating: 2 }, { label: 'Food' }),
	shape('c', { price: 89 }, { label: 'Bus' }),
	shape('e1', {}, { type: 'arrow' }),
	shape('e2', {}, { type: 'arrow' }),
	shape('e3', {}, { type: 'arrow' }),
])

const EDGES = buildEdgeIndex([
	{ id: 'e1', from: 'a', to: 'me' },
	{ id: 'e2', from: 'b', to: 'me' },
	{ id: 'e3', from: 'me', to: 'c' },
])

const CONTEXT: ExpressionContext = {
	facts: FACTS,
	edges: EDGES,
	properties: REGISTRY,
	rates: null,
	selfId: 'me',
	values: { price: 500 },
	units: {},
}

const render = (md: string) => renderExpressions(md, CONTEXT)

describe('inline expressions', () => {
	it('puts a total in the middle of a sentence', () => {
		// The whole point: the number lives in the words that explain it, not in a widget beside them.
		expect(render('Committed **{sum price}** so far')).toBe('Committed **₾ 1,540.00** so far')
	})

	it('counts what points at the note', () => {
		expect(render('{count} bills')).toBe('2 bills')
	})

	it('reads both directions as a balance', () => {
		// 1200 + 340 − 89, matching the arrows as drawn.
		expect(render('{sum price either}')).toBe('₾ 1,451.00')
	})

	it('reaches the whole board when asked', () => {
		// Everything except the note itself: 1200 + 340 + 89.
		expect(render('{sum price page}')).toBe('₾ 1,629.00')
	})

	it("shows the note's own value when there is no op", () => {
		expect(render('This one costs {price}.')).toBe('This one costs ₾ 500.00.')
	})

	it('finds a property by name as well as by id', () => {
		expect(render('{avg Quality}')).toBe('3')
		expect(render('{sum Unit price}')).toBe('—')
	})

	it('leaves anything it does not understand exactly as typed', () => {
		/*
		 * Braces are ordinary punctuation. A feature that swallowed them would quietly damage every
		 * note written before it existed, so an unresolved expression has to look like what you typed.
		 */
		expect(render('use {braces} freely')).toBe('use {braces} freely')
		expect(render('{sum nonsense}')).toBe('{sum nonsense}')
		expect(render('CSS: a { color: red }')).toBe('CSS: a { color: red }')
		expect(render('{}')).toBe('{}')
	})

	it('leaves fenced code alone', () => {
		const md = ['Total: {count}', '```js', 'const x = {count}', '```', 'After: {count}'].join('\n')
		expect(render(md)).toBe(
			['Total: 2', '```js', 'const x = {count}', '```', 'After: 2'].join('\n')
		)
	})

	it('leaves inline code alone, on both sides of it', () => {
		expect(render('{count} then `{count}` then {count}')).toBe('2 then `{count}` then 2')
	})

	it('handles a tilde fence and one that is never closed', () => {
		expect(render(['~~~', '{count}', '~~~', '{count}'].join('\n'))).toBe(
			['~~~', '{count}', '~~~', '2'].join('\n')
		)
		expect(render(['```', '{count}'].join('\n'))).toBe(['```', '{count}'].join('\n'))
	})

	it('never changes the line count, so task indices stay aligned with the source', () => {
		// `MarkdownView` derives checkbox indices from the rendered text while `toggleTaskAt` edits the
		// original. They only agree while substitution is strictly within a line.
		const md = ['- [ ] one {count}', '- [ ] two {sum price}', '- [ ] three'].join('\n')
		expect(render(md).split('\n')).toHaveLength(3)
	})

	it('says nothing rather than zero when there is nothing to total', () => {
		const lonely = { ...CONTEXT, edges: buildEdgeIndex([]) }
		expect(renderExpressions('{sum price}', lonely)).toBe('—')
	})

	it('skips the work entirely when a note has no braces at all', () => {
		const md = '# Just prose\n\nNothing to evaluate here.'
		expect(render(md)).toBe(md)
	})
})
