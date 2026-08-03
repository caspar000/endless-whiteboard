import { describe, expect, it } from 'vitest'
import { ITEMS_TO_NOTES_MIGRATION_ID, itemsToNotesMigrations } from './itemsToNotes'
import { parsePropertyRegistry } from './schema'

/** The one migration in the sequence, pulled out so tests can drive it directly. */
const migration = itemsToNotesMigrations.sequence.find(
	(m) => 'id' in m && m.id === ITEMS_TO_NOTES_MIGRATION_ID
) as { up: (store: Record<string, unknown>) => void }

function up<T extends Record<string, unknown>>(store: T): T {
	migration.up(store)
	return store
}

type Store = Record<string, Record<string, unknown>>

function itemShape(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		typeName: 'shape',
		type: 'node.item',
		parentId: 'page:page',
		index: 'a1',
		x: 10,
		y: 20,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: 220,
			h: 260,
			title: 'Standing desk',
			imageAssetId: null,
			tags: ['furniture'],
			fields: [
				{ key: 'price', type: 'currency', value: 2399, unit: 'GEL' },
				{ key: 'category', type: 'select', value: 'desk' },
			],
			...over,
		},
	}
}

function board(...shapes: Record<string, unknown>[]): Store {
	const store: Store = {
		'document:document': { id: 'document:document', typeName: 'document', meta: {}, gridSize: 10 },
		'page:page': { id: 'page:page', typeName: 'page', name: 'Page', index: 'a1', meta: {} },
	}
	for (const shape of shapes) store[shape.id as string] = shape
	return store
}

const registryOf = (store: Store) =>
	parsePropertyRegistry(
		(store['document:document']!.meta as Record<string, unknown>)['lifeboard:properties']
	)

describe('items → notes migration', () => {
	it('rewrites the item record in place, keeping its id, position and size', () => {
		// In place, rather than create-new-and-delete-old: arrow bindings, z-order and frame parenting
		// are all expressed as references to the id, so a new shape would silently break all three.
		const store = up(board(itemShape('shape:desk')))
		const note = store['shape:desk']!

		expect(note.type).toBe('node.markdown')
		expect(note.id).toBe('shape:desk')
		expect(note.x).toBe(10)
		expect(note.y).toBe(20)
		expect(note.props).toMatchObject({ w: 220, h: 260 })
	})

	it('turns the title into a heading', () => {
		const store = up(board(itemShape('shape:desk')))
		expect((store['shape:desk']!.props as { md: string }).md).toBe('# Standing desk')
	})

	it('turns an image into a markdown image below the heading', () => {
		const store = up(board(itemShape('shape:desk', { imageAssetId: 'asset:abc' })))
		expect((store['shape:desk']!.props as { md: string }).md).toBe(
			'# Standing desk\n\n![](asset:abc)'
		)
	})

	it('produces an empty note for an item with no title and no image', () => {
		// Rather than a placeholder heading: there is nothing to say, and the properties are the content
		// that actually mattered.
		const store = up(board(itemShape('shape:x', { title: '', imageAssetId: null })))
		expect((store['shape:x']!.props as { md: string }).md).toBe('')
	})

	it('pins the height, so a migrated board looks unchanged', () => {
		// The height came from the item card's layout. Letting the note re-derive one would reflow the
		// whole board on first open.
		const store = up(board(itemShape('shape:desk')))
		expect((store['shape:desk']!.props as { autoHeight: boolean }).autoHeight).toBe(false)
	})

	it('moves field values into meta, keyed by property id', () => {
		const store = up(board(itemShape('shape:desk')))
		expect((store['shape:desk']!.meta as Record<string, unknown>)['lifeboard:props']).toEqual({
			price: 2399,
			category: 'desk',
			tags: ['furniture'],
		})
	})

	it('registers a definition for every distinct field key, plus Tags', () => {
		const store = up(
			board(
				itemShape('shape:a'),
				itemShape('shape:b', {
					fields: [{ key: 'weight', type: 'number', value: 12, unit: 'kg' }],
					tags: [],
				})
			)
		)
		expect(registryOf(store)).toEqual([
			{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
			{ id: 'category', name: 'Category', type: 'select' },
			{ id: 'tags', name: 'Tags', type: 'multiSelect' },
			{ id: 'weight', name: 'Weight', type: 'number', unit: 'kg' },
		])
	})

	it('does not register Tags when nothing is tagged', () => {
		const store = up(board(itemShape('shape:a', { tags: [] })))
		expect(registryOf(store).map((d) => d.id)).toEqual(['price', 'category'])
	})

	it('writes the definition sidecar so a copied shape survives being pasted elsewhere', () => {
		const store = up(board(itemShape('shape:desk')))
		const defs = (store['shape:desk']!.meta as Record<string, unknown>)['lifeboard:propDefs']
		expect(defs).toEqual([
			{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
			{ id: 'category', name: 'Category', type: 'select' },
			{ id: 'tags', name: 'Tags', type: 'multiSelect' },
		])
	})

	it('keeps meta keys it does not own', () => {
		const item = itemShape('shape:desk')
		item.meta = { 'other:thing': 42 }
		const store = up(board(item))
		expect((store['shape:desk']!.meta as Record<string, unknown>)['other:thing']).toBe(42)
	})

	it('repoints a rollup that filtered on the type that no longer exists', () => {
		// Widened to "anything carrying the property" rather than to the note type: after the migration a
		// photo or a sticky may carry a price too, and that is now what the user means.
		const rollup = {
			id: 'shape:r',
			typeName: 'shape',
			type: 'node.rollup',
			meta: {},
			props: {
				source: { scope: 'page', frameId: null, tags: [], nodeType: 'node.item' },
				agg: { op: 'sum', fieldKey: 'price', groupBy: null },
			},
		}
		const store = up(board(itemShape('shape:desk'), rollup))
		expect(
			(store['shape:r']!.props as { source: { nodeType: string | null } }).source.nodeType
		).toBeNull()
	})

	it('leaves a board with no items completely alone', () => {
		const note = {
			id: 'shape:n',
			typeName: 'shape',
			type: 'node.markdown',
			meta: {},
			props: { w: 300, h: 100, md: '# Hi', autoHeight: true },
		}
		const before = JSON.stringify(board(note))
		expect(JSON.stringify(up(JSON.parse(before)))).toBe(before)
	})

	it('is idempotent — up(up(x)) deep-equals up(x)', () => {
		// Load-bearing, not merely tidy. tldraw only persists the migrated schema when the store next
		// *changes*, so opening a board and touching nothing means this runs again on the next load.
		// Deterministic slug ids rather than generated ones are what make that safe.
		const once = up(board(itemShape('shape:desk'), itemShape('shape:lamp', { title: 'Lamp' })))
		const snapshot = JSON.stringify(once)
		expect(JSON.stringify(up(JSON.parse(snapshot)))).toBe(snapshot)
	})

	it('survives records that have not been validated yet', () => {
		// This runs *before* validation, which is the whole reason it can exist — so it must not assume
		// any record is well-formed.
		const store = board(
			itemShape('shape:ok'),
			{ id: 'shape:bad', typeName: 'shape', type: 'node.item', props: { fields: 'nope' } },
			{ id: 'shape:worse', typeName: 'shape', type: 'node.item', props: {} },
			{
				id: 'shape:odd',
				typeName: 'shape',
				type: 'node.item',
				props: { fields: [null, 7], tags: [1] },
			}
		)
		expect(() => up(store)).not.toThrow()
		expect(store['shape:bad']!.type).toBe('node.markdown')
		// A missing width falls back to a usable one — `w`/`h` are `T.nonZeroNumber`, so a zero or
		// absent value would fail validation moments later.
		expect(store['shape:worse']!.props).toMatchObject({ w: 240, h: 120 })
	})

	it('adds to an existing registry rather than replacing it', () => {
		const store = board(itemShape('shape:desk'))
		store['document:document']!.meta = {
			'lifeboard:properties': [{ id: 'price', name: 'Cost', type: 'number' }],
		}
		up(store)
		const registry = registryOf(store)
		// The board's own meaning of `price` wins — shapes may already hold values under it.
		expect(registry[0]).toEqual({ id: 'price', name: 'Cost', type: 'number' })
		expect(registry.map((d) => d.id)).toEqual(['price', 'category', 'tags'])
	})

	it('still moves values onto shapes when there is no document record to register into', () => {
		const store: Store = {}
		store['shape:desk'] = itemShape('shape:desk')
		expect(() => up(store)).not.toThrow()
		expect(store['shape:desk']!.type).toBe('node.markdown')
		// Recoverable from the per-shape sidecar even with no registry.
		expect((store['shape:desk']!.meta as Record<string, unknown>)['lifeboard:props']).toMatchObject(
			{ price: 2399 }
		)
	})
})
