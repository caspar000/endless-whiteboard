import { afterEach, describe, expect, it } from 'vitest'
import { buildEdgeIndex } from '../edges'
import type { FactsMap, ShapeFacts } from '../facts'
import type { PropertyDef, PropertyValue } from '../properties/types'
import { clearQueryRegistry, registerQuery } from './namedQueries'
import {
	expressionForBoard,
	isAggregateExpression,
	renderExpressions,
	type ExpressionContext,
} from './expressions'

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

describe('expressionForBoard', () => {
	it('spells out the board when an op left the place to look implicit', () => {
		expect(expressionForBoard('sum price')).toBe('sum price page')
		// `{count}` on its own means "how many things point at me" in a note; from the palette it can
		// only sensibly mean the board.
		expect(expressionForBoard('count')).toBe('count page')
		expect(expressionForBoard('  sum   price  ')).toBe('sum price page')
	})

	it('leaves a question that already says where alone', () => {
		for (const body of ['sum price page', 'sum price in', 'count either', 'avg rating frame']) {
			expect(expressionForBoard(body)).toBe(body)
		}
	})

	it('leaves the bare-property form alone — it reads the selected shape, not the board', () => {
		expect(expressionForBoard('price')).toBe('price')
		expect(expressionForBoard('unit price')).toBe('unit price')
		expect(expressionForBoard('')).toBe('')
	})

	it('tells a question about a set apart from one about a shape', () => {
		// Which decides whether the expression has a *subject*: a query never includes its own shape,
		// so asking `count page` on behalf of the selection would silently exclude the selection.
		expect(isAggregateExpression('sum price')).toBe(true)
		expect(isAggregateExpression('COUNT')).toBe(true)
		// Aliases the parser accepts count too — one vocabulary, not two.
		expect(isAggregateExpression('total price')).toBe(true)
		expect(isAggregateExpression('price')).toBe(false)
		expect(isAggregateExpression('unit price')).toBe(false)
		expect(isAggregateExpression('   ')).toBe(false)
	})

	it('produces a body the evaluator agrees with, which is the point', () => {
		// The rewritten string is what gets previewed *and* what is written into a dropped shape, so
		// the two cannot disagree: this asserts the rewrite is something `evaluate` actually accepts.
		expect(render(`{${expressionForBoard('sum price')}}`)).toBe(render('{sum price page}'))
	})
})

describe('named questions', () => {
	afterEach(() => clearQueryRegistry())

	it('stands for the expression it was given, wherever expressions are read', () => {
		registerQuery({ name: 'committed', body: 'sum price in' })
		expect(render('Committed **{committed}** so far')).toBe(render('Committed **{sum price in}** so far'))
	})

	it('follows a name that stands for another name', () => {
		registerQuery({ name: 'committed', body: 'sum price in' })
		registerQuery({ name: 'spend', body: 'committed' })
		expect(render('{spend}')).toBe(render('{sum price in}'))
	})

	it('gives up on a cycle instead of hanging', () => {
		// Two names pointing at each other is a typo someone will make. It must cost them a dash.
		registerQuery({ name: 'a', body: 'b' })
		registerQuery({ name: 'b', body: 'a' })
		expect(render('{a}')).toBe('{a}')
	})

	it('never takes a name a property already has', () => {
		// The rule that makes the whole feature unable to change what an existing note reports: a
		// board with a "Price" property keeps meaning its own price, and the query does not apply.
		registerQuery({ name: 'Price', body: 'sum price page' })
		expect(render('{price}')).toBe('₾ 500.00')
		expect(render('{Price}')).toBe('₾ 500.00')
	})

	it('only resolves as a whole question, never as a word inside one', () => {
		registerQuery({ name: 'committed', body: 'sum price in' })
		// `{sum committed}` would have to mean "sum of the committed query", and a query is a
		// question, not a column. Left as typed, which is what an unrecognised expression always does.
		expect(render('{sum committed}')).toBe('{sum committed}')
	})

	it('is seen through when deciding whether a question has a subject', () => {
		registerQuery({ name: 'everything', body: 'count page' })
		// Otherwise the palette would lend `= everything` the selected shape as a subject, and a query
		// never includes its own shape — so the answer would quietly be one short.
		expect(isAggregateExpression('everything')).toBe(true)
		expect(isAggregateExpression('unknown name')).toBe(false)
	})

	it('leaves a named question alone when spelling out a scope', () => {
		registerQuery({ name: 'everything', body: 'count page' })
		// The name is written to the board rather than its expansion, so redefining the question
		// updates every shape that asked it. Appending `page` here would have frozen the expansion in.
		expect(expressionForBoard('everything')).toBe('everything')
	})
})
