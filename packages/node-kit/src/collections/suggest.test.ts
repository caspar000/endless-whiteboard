import { describe, expect, it } from 'vitest'
import type { PropertyDef } from '../properties/types'
import { expressionBodyAt, expressionSuggestions } from './suggest'

const PROPERTIES: PropertyDef[] = [
	{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
	{ id: 'unit_price', name: 'Unit price', type: 'number' },
	{ id: 'quality', name: 'Quality', type: 'rating' },
]

const labels = (body: string) =>
	expressionSuggestions(body, PROPERTIES)?.items.map((item) => item.label) ?? null

describe('expression suggestions', () => {
	it('finds the body of an unclosed brace before the caret', () => {
		expect(expressionBodyAt('Total: {sum pri', 15)).toEqual({ start: 8, body: 'sum pri' })
	})

	it('ignores a brace that has already been closed', () => {
		// Finished business. Completing it again would fight someone editing the words after it.
		expect(expressionBodyAt('Total: {sum price} and more', 27)).toBeNull()
		expect(expressionBodyAt('no braces here', 8)).toBeNull()
	})

	it('offers the verbs first, then this shape\'s own properties', () => {
		expect(labels('')).toEqual([
			'sum',
			'count',
			'avg',
			'min',
			'max',
			'median',
			'Price',
			'Unit price',
			'Quality',
		])
	})

	it('offers the property before the places, once a verb is settled', () => {
		expect(labels('sum ')).toEqual([
			'Price',
			'Unit price',
			'Quality',
			'in',
			'out',
			'either',
			'frame',
			'page',
		])
	})

	it('offers only the places once a property is settled', () => {
		expect(labels('sum Price ')).toEqual(['in', 'out', 'either', 'frame', 'page'])
	})

	it('has nothing to add after a bare property — that expression is already complete', () => {
		expect(labels('Price ')).toBeNull()
	})

	it('narrows on what is typed, matching anywhere in the name', () => {
		// Property names are phrases: someone reaching for "Unit price" types `price` as often as
		// `unit`, and a prefix match would offer them nothing for it.
		expect(labels('sum price')).toEqual(['Price', 'Unit price'])
		expect(labels('su')).toEqual(['sum'])
	})

	it('is case-insensitive about what has been typed', () => {
		expect(labels('SUM ')).toEqual(labels('sum '))
		expect(labels('sum QUAL')).toEqual(['Quality'])
	})

	it('marks the last step terminal and the rest chaining', () => {
		const first = expressionSuggestions('', PROPERTIES)!.items
		expect(first.find((i) => i.label === 'sum')).toMatchObject({ insert: 'sum ', terminal: false })
		// A bare property *is* the whole expression, so it closes.
		expect(first.find((i) => i.label === 'Price')).toMatchObject({
			insert: 'Price',
			terminal: true,
		})
		const places = expressionSuggestions('sum Price ', PROPERTIES)!.items
		expect(places[0]).toMatchObject({ label: 'in', insert: 'in', terminal: true })
	})

	it('reports where the word being typed starts, so an adapter can replace just that', () => {
		expect(expressionSuggestions('sum pri', PROPERTIES)!.from).toBe(4)
		expect(expressionSuggestions('', PROPERTIES)!.from).toBe(0)
	})
})
