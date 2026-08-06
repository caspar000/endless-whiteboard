import { describe, expect, it } from 'vitest'
import type { FactsMap, ShapeFacts } from '../../facts'
import type { RateTable } from '../../properties/rates'
import type { PropertyDef, PropertyValue } from '../../properties/types'
import { moneyOutcome, queryTable, summarise, type TableRow } from './query'
import {
	LABEL_COLUMN,
	defaultTableProps,
	filterOpsForType,
	summaryOpsForType,
	type FilterOp,
	type FilterValue,
	type TableNodeProps,
} from './spec'

const REGISTRY = new Map<string, PropertyDef>([
	['price', { id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }],
	['category', { id: 'category', name: 'Category', type: 'select' }],
	['bought', { id: 'bought', name: 'Bought', type: 'checkbox' }],
	['due', { id: 'due', name: 'Due', type: 'date' }],
	['tags', { id: 'tags', name: 'Tags', type: 'multiSelect' }],
	['note', { id: 'note', name: 'Note', type: 'text' }],
])

function shape(
	id: string,
	values: Record<string, PropertyValue>,
	opts: { label?: string; type?: string; parentId?: string | null; units?: Record<string, string> } = {}
): [string, ShapeFacts] {
	return [
		id,
		{
			type: opts.type ?? 'node.markdown',
			parentId: opts.parentId ?? null,
			label: opts.label ?? id,
			values,
			units: opts.units ?? {},
		},
	]
}

/** The shopping board, as a table: three things with prices and categories. */
function board(): FactsMap {
	return new Map([
		shape(
			'desk',
			{ price: 2399, category: 'desk', tags: ['furniture'] },
			{ label: 'Standing desk' }
		),
		shape('chair', { price: 850, category: 'desk', tags: ['furniture'] }, { label: 'Desk chair' }),
		shape('lamp', { price: 120, category: 'lighting', tags: ['decor'] }, { label: 'Desk lamp' }),
	])
}

/** A spec with a Name column and a summed Price column — the common shape of a real table. */
function spec(over: Partial<TableNodeProps> = {}): TableNodeProps {
	return {
		...defaultTableProps(),
		columns: [
			{ key: LABEL_COLUMN, summary: 'count', width: 2 },
			{ key: 'price', summary: 'sum', width: 1 },
		],
		...over,
	}
}

const run = (facts: FactsMap, props: TableNodeProps = spec(), selfId = 'table') =>
	queryTable(facts, props, selfId, REGISTRY)

describe('queryTable — rows', () => {
	it('mirrors every matching shape as a row, with its label and cells', () => {
		const result = run(board())
		expect(result.matched).toBe(3)
		expect(result.groups).toHaveLength(1)
		expect(result.groups[0]!.key).toBeNull()
		expect(result.groups[0]!.rows.map((r) => r.label)).toEqual([
			'Standing desk',
			'Desk chair',
			'Desk lamp',
		])
		expect(result.groups[0]!.rows[0]!.cells).toEqual({ price: 2399 })
	})

	it('excludes a shape that carries none of the column properties', () => {
		// A board is full of shapes that have nothing to do with the table — drawings, frames, an
		// intro note. A price table listing them all as "—" rows buries the rows it is about.
		const facts = new Map([...board(), shape('gift', { category: 'desk' })])
		const result = run(facts)
		expect(result.matched).toBe(3)
		expect(result.groups[0]!.rows.some((r) => r.shapeId === 'gift')).toBe(false)
	})

	it('keeps a shape whose column property is attached but empty, as a blank cell', () => {
		// The opposite case: this shape opted into Price and just hasn't got one yet.
		const facts = new Map([...board(), shape('gift', { price: null })])
		const result = run(facts)
		expect(result.matched).toBe(4)
		const gift = result.groups[0]!.rows.find((r) => r.shapeId === 'gift')!
		expect('price' in gift.cells).toBe(true)
		expect(gift.cells.price).toBeNull()
	})

	it('keeps every match when the table has no property columns at all', () => {
		// A label-only table is a plain list; with no columns to carry, nothing can be excluded.
		const facts = new Map([...board(), shape('gift', { category: 'desk' }), shape('plain', {})])
		const labelOnly = spec({ columns: [{ key: LABEL_COLUMN, summary: 'count', width: 1 }] })
		expect(run(facts, labelOnly).matched).toBe(5)
	})

	it('produces no groups at all for an empty selection', () => {
		const result = run(new Map())
		expect(result.groups).toEqual([])
		expect(result.matched).toBe(0)
		// Zero rather than NaN — the guarantee `aggregate.ts` established.
		expect(result.summaries[LABEL_COLUMN]).toBe(0)
	})

	it('never includes itself', () => {
		const facts = new Map([...board(), shape('table', { price: 10_000 })])
		const result = run(facts, spec(), 'table')
		expect(result.matched).toBe(3)
		expect(result.summaries.price).toBe(3369)
	})

	it('reads the group property even when it is not a column', () => {
		const result = run(board(), spec({ groupBy: 'category' }))
		expect(result.groups.map((g) => g.key).sort()).toEqual(['desk', 'lighting'])
	})
})

describe('queryTable — source', () => {
	it('filters by shape type when asked, and includes everything when not', () => {
		const facts = new Map([...board(), shape('sticky', { price: 50 }, { type: 'note' })])
		expect(run(facts).matched).toBe(4)
		expect(run(facts, spec({ source: { ...spec().source, shapeTypes: ['note'] } })).matched).toBe(1)
	})

	it('scopes by frame parenting, not geometry', () => {
		const facts = new Map([
			shape('a', { price: 100 }, { parentId: 'shape:frame1' }),
			shape('b', { price: 200 }, { parentId: 'shape:frame2' }),
			shape('c', { price: 400 }),
		])
		const inFrame = spec({
			source: { ...spec().source, scope: 'frame', frameId: 'shape:frame1' },
		})
		expect(run(facts, inFrame).summaries.price).toBe(100)
	})

	it('matches nothing when a frame scope has no frame chosen', () => {
		expect(run(board(), spec({ source: { ...spec().source, scope: 'frame' } })).matched).toBe(0)
	})
})

describe('queryTable — filters', () => {
	const withFilter = (propertyId: string, op: FilterOp, value: FilterValue = null) =>
		spec({ source: { ...spec().source, filters: [{ propertyId, op, value }] } })

	it('filters numerically', () => {
		expect(run(board(), withFilter('price', 'gt', 500)).matched).toBe(2)
		expect(run(board(), withFilter('price', 'lte', 850)).matched).toBe(2)
	})

	it('compares a typed value against a filter value typed as text', () => {
		// The filter value comes from a text input, so "2399" has to match the number 2399 — otherwise
		// every numeric `is` filter silently matches nothing and the table looks broken.
		expect(run(board(), withFilter('price', 'is', '2399')).matched).toBe(1)
	})

	it('filters on list membership', () => {
		expect(run(board(), withFilter('tags', 'contains', 'furniture')).matched).toBe(2)
		expect(run(board(), withFilter('tags', 'doesNotContain', 'furniture')).matched).toBe(1)
	})

	it('filters on emptiness, which applies to every type', () => {
		const facts = new Map([...board(), shape('gift', { price: null })])
		expect(run(facts, withFilter('price', 'isEmpty')).matched).toBe(1)
		expect(run(facts, withFilter('price', 'isNotEmpty')).matched).toBe(3)
	})

	it('treats an empty cell as failing every comparison operator', () => {
		const facts = new Map([shape('gift', { price: null })])
		expect(run(facts, withFilter('price', 'gt', 0)).matched).toBe(0)
		expect(run(facts, withFilter('price', 'is', 0)).matched).toBe(0)
	})

	it('filters on dates', () => {
		const facts = new Map([shape('a', { due: '2026-01-01' }), shape('b', { due: '2026-12-31' })])
		const dueColumns = [
			{ key: LABEL_COLUMN, summary: 'count', width: 2 },
			{ key: 'due', summary: null, width: 1 },
		] as const
		const before = { ...withFilter('due', 'before', '2026-06-01'), columns: [...dueColumns] }
		const after = { ...withFilter('due', 'after', '2026-06-01'), columns: [...dueColumns] }
		expect(run(facts, before).matched).toBe(1)
		expect(run(facts, after).matched).toBe(1)
	})

	it('filters on a checkbox', () => {
		const facts = new Map([shape('a', { bought: true }), shape('b', { bought: false })])
		const boughtColumns = [
			{ key: LABEL_COLUMN, summary: 'count', width: 2 },
			{ key: 'bought', summary: null, width: 1 },
		] as const
		const props = { ...withFilter('bought', 'is', true), columns: [...boughtColumns] }
		expect(run(facts, props).matched).toBe(1)
	})

	it('ANDs multiple filters', () => {
		const both = spec({
			source: {
				...spec().source,
				filters: [
					{ propertyId: 'price', op: 'gt', value: 100 },
					{ propertyId: 'category', op: 'is', value: 'desk' },
				],
			},
		})
		expect(run(board(), both).matched).toBe(2)
	})
})

describe('queryTable — grouping', () => {
	it('buckets by a property, biggest bucket first', () => {
		const result = run(board(), spec({ groupBy: 'category' }))
		expect(result.groups.map((g) => [g.key, g.rows.length])).toEqual([
			['desk', 2],
			['lighting', 1],
		])
	})

	it('puts a shape with no group value in a — bucket, sorted last', () => {
		const facts = new Map([...board(), shape('misc', { price: 30 })])
		const result = run(facts, spec({ groupBy: 'category' }))
		expect(result.groups.at(-1)!.key).toBe('—')
	})

	it('puts a list-valued shape in every bucket it carries', () => {
		// The opposite of the old rollup, which had to pick one bucket because its rows decomposed a
		// single total. A table's rows are a view of shapes, so being under both tags is right.
		const facts = new Map([shape('a', { price: 1, tags: ['furniture', 'decor'] })])
		const result = run(facts, spec({ groupBy: 'tags' }))
		expect(result.groups.map((g) => g.key).sort()).toEqual(['decor', 'furniture'])
		expect(result.matched).toBe(1)
	})

	it('groups by a raw value, so a year is not filed under "2,026"', () => {
		const facts = new Map([shape('a', { price: 2026 }), shape('b', { price: 2026 })])
		const result = run(facts, spec({ groupBy: 'price' }))
		expect(result.groups.map((g) => g.key)).toEqual(['2026'])
	})

	it('summarises each group over its own rows', () => {
		const result = run(board(), spec({ groupBy: 'category' }))
		expect(result.groups[0]!.summaries.price).toBe(3249)
		expect(result.groups[1]!.summaries.price).toBe(120)
		// And the overall summary is still over everything.
		expect(result.summaries.price).toBe(3369)
	})
})

describe('queryTable — sorting', () => {
	it('sorts ascending and descending', () => {
		const asc = run(board(), spec({ sorts: [{ key: 'price', dir: 'asc' }] }))
		expect(asc.groups[0]!.rows.map((r) => r.cells.price)).toEqual([120, 850, 2399])
		const desc = run(board(), spec({ sorts: [{ key: 'price', dir: 'desc' }] }))
		expect(desc.groups[0]!.rows.map((r) => r.cells.price)).toEqual([2399, 850, 120])
	})

	it('sorts by the label column', () => {
		const result = run(board(), spec({ sorts: [{ key: LABEL_COLUMN, dir: 'asc' }] }))
		expect(result.groups[0]!.rows.map((r) => r.label)).toEqual([
			'Desk chair',
			'Desk lamp',
			'Standing desk',
		])
	})

	it('collates numbers inside strings, so Item 2 precedes Item 10', () => {
		const facts = new Map([
			shape('b', {}, { label: 'Item 10' }),
			shape('a', {}, { label: 'Item 2' }),
		])
		// Label-only columns: these shapes carry no properties, and this is a label test.
		const result = run(
			facts,
			spec({
				columns: [{ key: LABEL_COLUMN, summary: 'count', width: 1 }],
				sorts: [{ key: LABEL_COLUMN, dir: 'asc' }],
			})
		)
		expect(result.groups[0]!.rows.map((r) => r.label)).toEqual(['Item 2', 'Item 10'])
	})

	it('sorts empties last regardless of direction, because a blank is missing not small', () => {
		const facts = new Map([shape('a', { price: 5 }), shape('b', { price: null }), shape('c', { price: 1 })])
		for (const dir of ['asc', 'desc'] as const) {
			const result = run(facts, spec({ sorts: [{ key: 'price', dir }] }))
			expect(result.groups[0]!.rows.at(-1)!.shapeId).toBe('b')
		}
	})

	it('falls back to later sorts to break ties', () => {
		const facts = new Map([
			shape('a', { price: 10, category: 'b' }),
			shape('b', { price: 10, category: 'a' }),
		])
		const result = run(
			facts,
			spec({
				sorts: [
					{ key: 'price', dir: 'asc' },
					{ key: 'category', dir: 'asc' },
				],
			})
		)
		expect(result.groups[0]!.rows.map((r) => r.shapeId)).toEqual(['b', 'a'])
	})
})

describe('summarise', () => {
	const rows = (...values: (PropertyValue | undefined)[]): TableRow[] =>
		values.map((v, i) => ({
			shapeId: `s${i}`,
			label: `s${i}`,
			// `undefined` means the shape never carried the property; `null` means it carries it empty.
			cells: (v === undefined ? {} : { price: v }) as Record<string, PropertyValue>,
			units: {},
		}))

	const price = REGISTRY.get('price')!

	it('counts rows, values, uniques and blanks', () => {
		const set = rows(1, 1, null, undefined)
		expect(summarise('count', set, 'price', price)).toBe(4)
		expect(summarise('countNotEmpty', set, 'price', price)).toBe(2)
		expect(summarise('countEmpty', set, 'price', price)).toBe(2)
		expect(summarise('countUnique', set, 'price', price)).toBe(1)
		expect(summarise('percentEmpty', set, 'price', price)).toBe(50)
		expect(summarise('percentNotEmpty', set, 'price', price)).toBe(50)
	})

	it('counts each entry of a list value under countValues', () => {
		const tags = REGISTRY.get('tags')!
		const set: TableRow[] = [{ shapeId: 'a', label: 'a', cells: { tags: ['x', 'y'] }, units: {} }]
		expect(summarise('countValues', set, 'tags', tags)).toBe(2)
		expect(summarise('count', set, 'tags', tags)).toBe(1)
	})

	it('computes the numeric summaries', () => {
		const set = rows(1, 2, 3, 10)
		expect(summarise('sum', set, 'price', price)).toBe(16)
		expect(summarise('avg', set, 'price', price)).toBe(4)
		expect(summarise('min', set, 'price', price)).toBe(1)
		expect(summarise('max', set, 'price', price)).toBe(10)
		expect(summarise('range', set, 'price', price)).toBe(9)
		expect(summarise('median', set, 'price', price)).toBe(2.5)
		expect(summarise('median', rows(1, 2, 3), 'price', price)).toBe(2)
	})

	it('returns null rather than 0 when a numeric summary has nothing to work with', () => {
		// `—` is honest; `0` would claim the total is zero.
		expect(summarise('sum', rows(null, undefined), 'price', price)).toBeNull()
		expect(summarise('avg', [], 'price', price)).toBeNull()
	})

	it('refuses to sum a column whose registered type is not numeric', () => {
		const note = REGISTRY.get('note')!
		const set: TableRow[] = [{ shapeId: 'a', label: 'a', cells: { note: 12 }, units: {} }]
		expect(summarise('sum', set, 'note', note)).toBeNull()
		// …but counting it is still meaningful.
		expect(summarise('countNotEmpty', set, 'note', note)).toBe(1)
	})

	it('cannot summarise the label column numerically, only count it', () => {
		const set: TableRow[] = [{ shapeId: 'a', label: 'a', cells: {}, units: {} }]
		expect(summarise('count', set, LABEL_COLUMN, null)).toBe(1)
		expect(summarise('sum', set, LABEL_COLUMN, null)).toBeNull()
	})

	it('summarises dates as earliest, latest and a span in days', () => {
		const due = REGISTRY.get('due')!
		const set: TableRow[] = [
			{ shapeId: 'a', label: 'a', cells: { due: '2026-01-01' }, units: {} },
			{ shapeId: 'b', label: 'b', cells: { due: '2026-01-11' }, units: {} },
		]
		expect(summarise('earliest', set, 'due', due)).toBe(Date.parse('2026-01-01'))
		expect(summarise('latest', set, 'due', due)).toBe(Date.parse('2026-01-11'))
		// `range` on a date is a number of days, not a date — the same word, a different unit.
		expect(summarise('range', set, 'due', due)).toBe(10)
	})

	it('needs two dates for a range', () => {
		const due = REGISTRY.get('due')!
		const set: TableRow[] = [{ shapeId: 'a', label: 'a', cells: { due: '2026-01-01' }, units: {} }]
		expect(summarise('range', set, 'due', due)).toBeNull()
	})
})

describe('skipped', () => {
	it('counts matched rows that carry the summarised property with an unusable value', () => {
		// "1 without a value" — the sentence the footer shows. A shape that never had a price is not
		// counted here, because it is not a row at all.
		const facts = new Map([...board(), shape('gift', { price: null }), shape('other', {})])
		const result = run(facts)
		expect(result.matched).toBe(4)
		expect(result.skipped).toBe(1)
	})
})

describe('op gating', () => {
	it('offers only operators that can match, per property type', () => {
		expect(filterOpsForType('financial')).toContain('gt')
		expect(filterOpsForType('financial')).not.toContain('contains')
		expect(filterOpsForType('multiSelect')).toContain('contains')
		expect(filterOpsForType('multiSelect')).not.toContain('gt')
		expect(filterOpsForType('date')).toContain('before')
		expect(filterOpsForType('checkbox')).toEqual(['is'])
	})

	it('offers numeric summaries only for numeric types, and date ones only for dates', () => {
		expect(summaryOpsForType('financial')).toContain('sum')
		expect(summaryOpsForType('text')).not.toContain('sum')
		expect(summaryOpsForType('date')).toContain('earliest')
		expect(summaryOpsForType('date')).not.toContain('sum')
		// The label column has no property, so it can only be counted.
		expect(summaryOpsForType(null)).toEqual(summaryOpsForType('text'))
	})
})

describe('currency conversion in summaries', () => {
	const priceDef: PropertyDef = { id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }
	const properties = new Map([['price', priceDef]])
	// One USD buys 2.5 GEL.
	const rates: RateTable = { base: 'GEL', rates: { USD: 0.4, GEL: 1 }, asOf: 0, stale: false }

	const row = (id: string, price: number, unit?: string): TableRow => ({
		shapeId: id,
		label: id,
		cells: { price },
		units: unit ? { price: unit } : {},
	})

	it('sums across currencies once a target is chosen', () => {
		const rows = [row('a', 100, 'GEL'), row('b', 100, 'USD')]
		// 100 GEL + (100 USD → 250 GEL)
		expect(
			summarise('sum', rows, 'price', priceDef, {
				config: { to: 'GEL', include: null },
				rates,
			})
		).toBeCloseTo(350, 6)
	})

	it('leaves the total unconverted, and reports it mixed, when no target is set', () => {
		const rows = [row('a', 100, 'GEL'), row('b', 100, 'USD')]
		expect(summarise('sum', rows, 'price', priceDef, { rates })).toBe(200)
		const outcome = moneyOutcome(rows, 'price', priceDef, { rates })
		expect(outcome.mixed).toBe(true)
		expect(outcome.converted).toBe(false)
	})

	it('sums only the currencies asked for, and says how many it left out', () => {
		const rows = [row('a', 100, 'GEL'), row('b', 100, 'USD'), row('c', 50, 'USD')]
		expect(
			summarise('sum', rows, 'price', priceDef, {
				config: { to: 'USD', include: ['USD'] },
				rates,
			})
		).toBe(150)
		const outcome = moneyOutcome(rows, 'price', priceDef, {
			config: { to: 'USD', include: ['USD'] },
			rates,
		})
		expect(outcome.excluded).toBe(1)
		expect(outcome.unit).toBe('USD')
		expect(outcome.converted).toBe(true)
	})

	/**
	 * The trap this ordering exists for: reduced before conversion, `max` picks the biggest *number*
	 * regardless of currency, so 200 GEL (=80 USD) beats 100 USD and the answer is quietly wrong.
	 */
	it('converts before comparing, so max is the largest amount and not the largest number', () => {
		const rows = [row('a', 200, 'GEL'), row('b', 100, 'USD')]
		expect(
			summarise('max', rows, 'price', priceDef, { config: { to: 'USD', include: null }, rates })
		).toBeCloseTo(100, 6)
		expect(
			summarise('min', rows, 'price', priceDef, { config: { to: 'USD', include: null }, rates })
		).toBeCloseTo(80, 6)
	})

	it('leaves out what it cannot convert rather than counting it at par', () => {
		const rows = [row('a', 100, 'GEL'), row('b', 100, 'XYZ')]
		expect(
			summarise('sum', rows, 'price', priceDef, { config: { to: 'GEL', include: null }, rates })
		).toBe(100)
		expect(
			moneyOutcome(rows, 'price', priceDef, { config: { to: 'GEL', include: null }, rates })
				.excluded
		).toBe(1)
	})

	it('falls back to the definition currency for rows with no override', () => {
		const rows = [row('a', 100), row('b', 100, 'USD')]
		// 'a' is GEL by default; 100 USD is 250 GEL.
		expect(
			summarise('sum', rows, 'price', priceDef, { config: { to: 'GEL', include: null }, rates })
		).toBeCloseTo(350, 6)
	})

	it('does not touch non-money columns', () => {
		const noteDef: PropertyDef = { id: 'note', name: 'Note', type: 'number' }
		const rows: TableRow[] = [
			{ shapeId: 'a', label: 'a', cells: { note: 5 }, units: {}, },
			{ shapeId: 'b', label: 'b', cells: { note: 7 }, units: {} },
		]
		expect(summarise('sum', rows, 'note', noteDef, { config: { to: 'USD', include: null }, rates })).toBe(12)
		expect(moneyOutcome(rows, 'note', noteDef, { rates }).converted).toBe(false)
	})

	void properties
})
