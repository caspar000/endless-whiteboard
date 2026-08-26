import { describe, expect, it } from 'vitest'
import { buildEdgeIndex } from '../edges'
import type { FactsMap, ShapeFacts } from '../facts'
import type { PropertyDef, PropertyValue } from '../properties/types'
import { runCollection } from './engine'
import { defaultCollection, type Collection } from './spec'

const REGISTRY = new Map<string, PropertyDef>([
	['price', { id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }],
	['due', { id: 'due', name: 'Due', type: 'date' }],
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

/** Three priced stickies, all pointing at a fourth that carries nothing of its own. */
function board(): FactsMap {
	return new Map([
		shape('total', {}, { label: 'October' }),
		shape('rent', { price: 1200 }, { label: 'Rent' }),
		shape('food', { price: 340 }, { label: 'Food' }),
		shape('bus', { price: 89 }, { label: 'Bus' }),
		shape('a1', {}, { type: 'arrow', label: '' }),
		shape('a2', {}, { type: 'arrow', label: '' }),
		shape('a3', {}, { type: 'arrow', label: '' }),
	])
}

const EDGES = buildEdgeIndex([
	{ id: 'a1', from: 'rent', to: 'total' },
	{ id: 'a2', from: 'food', to: 'total' },
	{ id: 'a3', from: 'bus', to: 'total' },
])

const collection = (patch: Partial<Collection> = {}): Collection => ({
	...defaultCollection(),
	...patch,
})

describe('collections', () => {
	it('totals what points at the shape, without the shape being a table', () => {
		// The whole point of the reframe: a plain sticky carrying no properties of its own reports a
		// number about the things wired to it.
		const result = runCollection(
			board(),
			collection({ op: 'sum', property: 'price' }),
			'total',
			REGISTRY,
			null,
			EDGES
		)
		expect(result.value).toBe(1629)
		expect(result.matched).toBe(3)
	})

	it('keeps the currency, so the number can be rendered as money', () => {
		const result = runCollection(
			board(),
			collection({ op: 'sum', property: 'price' }),
			'total',
			REGISTRY,
			null,
			EDGES
		)
		expect(result.unit).toBe('GEL')
	})

	it('counts without a property, and reports no unit for the count', () => {
		// A count of three things is three, not ₾3. Stamping the property's currency on a count is the
		// kind of confident nonsense that makes someone stop trusting every other figure on the board.
		const result = runCollection(board(), collection(), 'total', REGISTRY, null, EDGES)
		expect(result.value).toBe(3)
		expect(result.unit).toBeUndefined()
	})

	it('counts the shapes wired to it even when they carry no properties at all', () => {
		const bare = new Map([
			shape('total', {}, { label: 'Inbox' }),
			shape('a', {}, { label: 'One' }),
			shape('b', {}, { label: 'Two' }),
			shape('e1', {}, { type: 'arrow', label: '' }),
			shape('e2', {}, { type: 'arrow', label: '' }),
		])
		const edges = buildEdgeIndex([
			{ id: 'e1', from: 'a', to: 'total' },
			{ id: 'e2', from: 'b', to: 'total' },
		])
		expect(runCollection(bare, collection(), 'total', REGISTRY, null, edges).value).toBe(2)
	})

	it('respects the arrow direction, so in and out are different questions', () => {
		const out = collection({
			op: 'sum',
			property: 'price',
			source: { ...defaultCollection().source, direction: 'out' },
		})
		// Every arrow here points *at* the collector, so asking about outgoing ones finds nothing.
		expect(runCollection(board(), out, 'total', REGISTRY, null, EDGES).matched).toBe(0)
	})

	it('never counts itself, whatever the scope', () => {
		const page = collection({
			op: 'count',
			source: { ...defaultCollection().source, scope: 'page' },
		})
		// Six other shapes exist, three of them arrows — the collector is not among its own results.
		const result = runCollection(board(), page, 'total', REGISTRY, null, EDGES)
		expect(result.rows.some((row) => row.shapeId === 'total')).toBe(false)
	})

	it('returns formatted rows for the list view, labelled and in the row\'s own unit', () => {
		const result = runCollection(
			board(),
			collection({ view: 'list', op: 'sum', property: 'price' }),
			'total',
			REGISTRY,
			null,
			EDGES
		)
		expect(result.rows.map((row) => [row.label, row.text])).toEqual([
			['Rent', '₾ 1,200.00'],
			['Food', '₾ 340.00'],
			['Bus', '₾ 89.00'],
		])
	})

	it('reads both directions as a balance, not a pile', () => {
		/*
		 * Two shapes feeding a collector and one draining it is a flow, and the arrows already say which
		 * way each one goes. Adding all three together would report a number matching nothing anyone
		 * drew: 1200 + 340 − 89, not 1629.
		 */
		const drained = new Map(board())
		const withOutflow = buildEdgeIndex([
			{ id: 'a1', from: 'rent', to: 'total' },
			{ id: 'a2', from: 'food', to: 'total' },
			{ id: 'a3', from: 'total', to: 'bus' },
		])
		const either = collection({
			op: 'sum',
			property: 'price',
			source: { ...defaultCollection().source, direction: 'either', signed: true },
		})
		const result = runCollection(drained, either, 'total', REGISTRY, null, withOutflow)
		expect(result.value).toBe(1451)
		// All three still count as items — the sign is about the total, not about membership.
		expect(result.matched).toBe(3)
	})

	it('needs no sign when every arrow runs the same way', () => {
		// One direction puts every row on the same side, so signing it would be a no-op dressed up as
		// a choice — which is why only `either` carries it.
		const inbound = collection({ op: 'sum', property: 'price' })
		expect(runCollection(board(), inbound, 'total', REGISTRY, null, EDGES).value).toBe(1629)
	})

	it('says nothing rather than zero when there is nothing to summarise', () => {
		// A zero looks like an answer. An empty collection has not answered.
		const lonely = new Map([shape('total', {}, { label: 'October' })])
		const result = runCollection(
			lonely,
			collection({ op: 'sum', property: 'price' }),
			'total',
			REGISTRY,
			null
		)
		expect(result.value).toBeNull()
		expect(result.matched).toBe(0)
	})
})

describe('collections — "this frame"', () => {
	/** A collector and two priced stickies inside one frame; a third sticky in another. */
	function framed(): FactsMap {
		const inFrame = (id: string, values: Record<string, PropertyValue>, parentId: string) => {
			const [key, facts] = shape(id, values)
			return [key, { ...facts, parentId }] as [string, ShapeFacts]
		}
		return new Map([
			inFrame('total', {}, 'shape:frame1'),
			inFrame('rent', { price: 1200 }, 'shape:frame1'),
			inFrame('food', { price: 340 }, 'shape:frame1'),
			inFrame('bus', { price: 89 }, 'shape:frame2'),
		])
	}

	const inThisFrame = (patch: Partial<Collection> = {}) =>
		collection({ source: { ...defaultCollection(true).source }, ...patch })

	it('collects the frame the collecting shape is in, with no frame to pick', () => {
		// The menu says "shapes in this frame", so the frame is wherever the shape sits — not a second
		// thing to choose. Before this resolved, a frame-scoped collection matched nothing at all.
		const result = runCollection(
			framed(),
			inThisFrame({ op: 'sum', property: 'price' }),
			'total',
			REGISTRY
		)
		expect(result.value).toBe(1540)
		expect(result.matched).toBe(2)
	})

	it('starts a shape inside a frame off collecting that frame', () => {
		expect(defaultCollection(true).source.scope).toBe('frame')
		// Anywhere else, the documented default stands: what points at me, counted.
		expect(defaultCollection().source).toMatchObject({ scope: 'connected', direction: 'in' })
	})

	it('finds nothing for a collector sitting on open canvas', () => {
		const loose = new Map(framed())
		loose.set('total', { ...loose.get('total')!, parentId: null })
		expect(runCollection(loose, inThisFrame(), 'total', REGISTRY).matched).toBe(0)
	})

	it('keeps a frame someone chose explicitly', () => {
		const aimed = inThisFrame({
			op: 'sum',
			property: 'price',
			source: { ...defaultCollection(true).source, frameId: 'shape:frame2' },
		})
		expect(runCollection(framed(), aimed, 'total', REGISTRY).value).toBe(89)
	})
})
