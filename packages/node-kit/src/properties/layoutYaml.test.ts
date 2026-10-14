import { describe, expect, it } from 'vitest'
import { formatLayoutValue, layoutFromAuto, parseStoredLayout, visibleLayoutRows } from './layout'
import { layoutFromYaml, layoutToYaml } from './layoutYaml'
import type { PropertyDef } from './types'

const defs: PropertyDef[] = [
	{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
	{ id: 'link', name: 'Link', type: 'link' },
	{ id: 'description', name: 'Description', type: 'text' },
	{ id: 'type', name: 'Type', type: 'select' },
	{ id: 'status', name: 'Status', type: 'status' },
	{ id: 'weight', name: 'Weight', type: 'number', unit: 'kg' },
	{ id: 'when', name: 'When', type: 'date' },
]

const PLAN_EXAMPLE = `width: 260
rows:
  - center: { property: Price, size: xl, weight: bold }
    right:  { property: Link, as: icon }
  - left:   { property: Description, size: s }
  - separator
  - left:
      - { property: Type, as: badge }
      - { property: Status, as: badge }
  - table: [Weight, When]
`

describe('layout YAML', () => {
	it('reads the plan’s example, names to ids', () => {
		const result = layoutFromYaml(PLAN_EXAMPLE, defs)
		expect(result).toEqual({
			ok: true,
			layout: {
				width: 260,
				rows: [
					{
						center: [{ kind: 'property', property: 'price', size: 'xl', weight: 'bold' }],
						right: [{ kind: 'property', property: 'link', as: 'icon' }],
					},
					{ left: [{ kind: 'property', property: 'description', size: 's' }] },
					{ left: [{ kind: 'separator' }] },
					{
						left: [
							{ kind: 'property', property: 'type', as: 'badge' },
							{ kind: 'property', property: 'status', as: 'badge' },
						],
					},
					{ left: [{ kind: 'table', properties: ['weight', 'when'] }] },
				],
			},
		})
	})

	it('writes a layout back out that reads the same, with shorthands and one-line elements', () => {
		const first = layoutFromYaml(PLAN_EXAMPLE, defs)
		if (!first.ok) throw new Error('example should parse')
		const text = layoutToYaml(first.layout, defs)
		expect(text).toContain('- separator')
		expect(text).toContain('- table: [ Weight, When ]')
		expect(text).toContain('center: { property: Price, size: xl, weight: bold }')
		expect(layoutFromYaml(text, defs)).toEqual(first)
	})

	it('matches names loosely and takes a bare element as a left slot', () => {
		const result = layoutFromYaml('rows:\n  - { property: " price ", decimals: 0, symbol: false }\n', defs)
		expect(result).toEqual({
			ok: true,
			layout: { rows: [{ left: [{ kind: 'property', property: 'price', format: { decimals: 0, symbol: false } }] }] },
		})
	})

	it('reports each mistake with its line, and returns no layout', () => {
		const result = layoutFromYaml(
			['rows:', '  - left: { property: Prise }', '  - left: { property: Price, as: stars }', '  - colour: red'].join(
				'\n'
			),
			defs
		)
		expect(result.ok).toBe(false)
		if (result.ok) return
		expect(result.errors.map((e) => e.line)).toEqual([2, 3, 4])
		expect(result.errors[0]!.message).toContain('No property called “Prise”')
		expect(result.errors[1]!.message).toContain('Price can be shown as text, badge')
		expect(result.errors[2]!.message).toContain('Unknown key “colour”')
	})

	it('reports YAML syntax errors by line too', () => {
		const result = layoutFromYaml('rows:\n  - left: { property: Price\n', defs)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors[0]!.line).toBeGreaterThanOrEqual(2)
	})

	it('rejects a width out of range and a format on the wrong type', () => {
		const result = layoutFromYaml('width: 5\nrows:\n  - { property: Description, decimals: 2 }\n', defs)
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.errors.map((e) => e.line)).toEqual([1, 3])
	})
})

describe('stored layouts', () => {
	it('drops what it cannot read rather than throwing', () => {
		expect(parseStoredLayout(null)).toBeNull()
		expect(parseStoredLayout({ rows: 'nope' })).toBeNull()
		expect(
			parseStoredLayout({
				width: 99999,
				rows: [{ left: [{ kind: 'property', property: 'price', as: 'sparkles' }, { kind: 'mystery' }], align: 'up' }],
			})
		).toEqual({ rows: [{ left: [{ kind: 'property', property: 'price' }] }] })
	})
})

describe('the automatic layout written out', () => {
	it('gives one row per role, in panel order', () => {
		const layout = layoutFromAuto([defs[0]!, defs[3]!, defs[5]!])
		expect(layout.rows.map((r) => r.left!.map((e) => (e.kind === 'property' ? e.property : e.kind)))).toEqual([
			['price', 'weight'],
			['type'],
		])
	})
})

describe('formatting', () => {
	it('applies decimals, drops the symbol and picks a date style', () => {
		expect(formatLayoutValue(defs[0]!, 2399, 'GEL', { decimals: 0 })).toBe('₾ 2,399')
		expect(formatLayoutValue(defs[0]!, 2399, 'GEL', { symbol: false })).toBe('2,399.00')
		expect(formatLayoutValue(defs[5]!, 3.25, 'kg', { decimals: 1 })).toBe('3.3 kg')
		expect(formatLayoutValue(defs[6]!, '2026-10-14', undefined, { date: 'short' })).toBe('14 Oct')
	})
})

describe('what of a layout is drawn', () => {
	const prop = (id: string) => ({ kind: 'property' as const, property: id })
	const rule = { left: [{ kind: 'separator' as const }] }

	it('hides empty elements, then rows, then stray separators, then the card', () => {
		const layout = {
			rows: [
				rule,
				{ left: [{ kind: 'text' as const, text: 'Price' }, prop('price')] },
				rule,
				rule,
				{ left: [prop('a')], right: [prop('b')] },
				{ left: [{ kind: 'text' as const, text: 'Notes' }] },
				rule,
			],
		}
		const filled = new Set(['a'])
		const rows = visibleLayoutRows(layout, (id) => filled.has(id))
		expect(rows).toEqual([{ left: [prop('a')] }, { left: [{ kind: 'text', text: 'Notes' }] }])
		expect(visibleLayoutRows(layout, () => false)).toBeNull()
	})

	it('keeps one separator between two filled rows', () => {
		const rows = visibleLayoutRows({ rows: [{ left: [prop('a')] }, rule, rule, { left: [prop('b')] }] }, () => true)
		expect(rows).toEqual([{ left: [prop('a')] }, rule, { left: [prop('b')] }])
	})
})
