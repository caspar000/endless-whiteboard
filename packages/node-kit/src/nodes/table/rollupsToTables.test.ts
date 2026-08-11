import { describe, expect, it } from 'vitest'
import { ROLLUPS_TO_TABLES_MIGRATION_ID, rollupsToTablesMigrations } from './rollupsToTables'
import { ITEMS_TO_NOTES_MIGRATION_ID } from '../../properties/itemsToNotes'
import type { TableNodeProps } from './spec'

const entry = rollupsToTablesMigrations.sequence.find(
	(m) => 'id' in m && m.id === ROLLUPS_TO_TABLES_MIGRATION_ID
) as { up: (store: Record<string, unknown>) => void; dependsOn?: readonly string[] }

function up<T extends Record<string, unknown>>(store: T): T {
	entry.up(store)
	return store
}

type Store = Record<string, Record<string, unknown>>

function rollup(id: string, props: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		id,
		typeName: 'shape',
		type: 'node.rollup',
		parentId: 'page:page',
		index: 'a1',
		x: 800,
		y: 100,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		meta: {},
		props: {
			w: 280,
			h: 150,
			title: 'Total spend',
			source: { scope: 'page', frameId: null, tags: [], nodeType: null },
			agg: { op: 'sum', fieldKey: 'price', groupBy: null },
			format: { style: 'currency', unit: 'GEL' },
			...props,
		},
	}
}

const board = (...shapes: Record<string, unknown>[]): Store => {
	const store: Store = {}
	for (const shape of shapes) store[shape.id as string] = shape
	return store
}

const propsOf = (store: Store, id: string) =>
	store[id]!.props as unknown as TableNodeProps & { w: number; h: number }

describe('rollups → tables migration', () => {
	it('declares its dependency on the items→notes pass', () => {
		// `sortMigrations` orders independent sequences heuristically, so without this the tag filter this
		// migration writes could be built before the Tags property exists.
		expect(entry.dependsOn).toContain(ITEMS_TO_NOTES_MIGRATION_ID)
	})

	it('rewrites the record in place, keeping its id, position and size', () => {
		const store = up(board(rollup('shape:r')))
		expect(store['shape:r']!.type).toBe('node.table')
		expect(store['shape:r']!.x).toBe(800)
		expect(propsOf(store, 'shape:r')).toMatchObject({ w: 280, h: 150 })
	})

	it('shows one big number, not a grid', () => {
		// A board of KPIs must not silently become a board of grids on upgrade.
		expect(propsOf(up(board(rollup('shape:r'))), 'shape:r').layout.mode).toBe('value')
	})

	it('turns the aggregated field into the one summarised column', () => {
		const props = propsOf(up(board(rollup('shape:r'))), 'shape:r')
		expect(props.columns).toEqual([{ key: 'price', summary: 'sum', width: 1 }])
		expect(props.title).toBe('Total spend')
	})

	it('maps every old operation onto a summary op', () => {
		for (const [op, summary] of [
			['sum', 'sum'],
			['avg', 'avg'],
			['min', 'min'],
			['max', 'max'],
			['count', 'count'],
		] as const) {
			const store = up(board(rollup('shape:r', { agg: { op, fieldKey: 'price', groupBy: null } })))
			expect(propsOf(store, 'shape:r').columns[0]!.summary).toBe(summary)
		}
	})

	it('falls back to a row count when no field was ever chosen', () => {
		// Truthful rather than empty: a rollup that was never configured had nothing to show either.
		const store = up(
			board(rollup('shape:r', { agg: { op: 'sum', fieldKey: null, groupBy: null } }))
		)
		expect(propsOf(store, 'shape:r').columns).toEqual([
			{ key: '__label', summary: 'count', width: 1 },
		])
	})

	it('carries the group-by across', () => {
		const store = up(
			board(rollup('shape:r', { agg: { op: 'sum', fieldKey: 'price', groupBy: 'category' } }))
		)
		expect(propsOf(store, 'shape:r').groupBy).toBe('category')
	})

	it('carries a frame scope across', () => {
		const store = up(
			board(
				rollup('shape:r', {
					source: { scope: 'frame', frameId: 'shape:f1', tags: [], nodeType: null },
				})
			)
		)
		expect(propsOf(store, 'shape:r').source).toMatchObject({
			scope: 'frame',
			frameId: 'shape:f1',
		})
	})

	it('turns a tag scope into a tag filter, since tags are a property now', () => {
		const store = up(
			board(
				rollup('shape:r', {
					source: { scope: 'tags', frameId: null, tags: ['furniture'], nodeType: null },
				})
			)
		)
		const props = propsOf(store, 'shape:r')
		// `tags` is not a table scope, so the scope collapses to the board and the selection becomes a
		// filter.
		expect(props.source.scope).toBe('page')
		expect(props.source.filters).toEqual([
			{ propertyId: 'tags', op: 'contains', value: 'furniture' },
		])
	})

	it('keeps only the first tag, because filters are ANDed and the old scope was any-of', () => {
		const store = up(
			board(
				rollup('shape:r', {
					source: { scope: 'tags', frameId: null, tags: ['furniture', 'decor'], nodeType: null },
				})
			)
		)
		// Keeping both would AND them and match nothing — a table showing zero rows is worse than one
		// showing the common case.
		expect(propsOf(store, 'shape:r').source.filters).toHaveLength(1)
	})

	it('carries a node-type filter across as a shape-type allow-list', () => {
		const store = up(
			board(
				rollup('shape:r', {
					source: { scope: 'page', frameId: null, tags: [], nodeType: 'node.markdown' },
				})
			)
		)
		expect(propsOf(store, 'shape:r').source.shapeTypes).toEqual(['node.markdown'])
	})

	it('drops the rollup’s pinned unit, so the property is the only source of truth', () => {
		const store = up(board(rollup('shape:r')))
		expect('format' in (store['shape:r']!.props as object)).toBe(false)
	})

	it('leaves other shapes alone', () => {
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

	it('is idempotent', () => {
		// Same reason as the items→notes pass: tldraw only persists the migrated schema on the next store
		// *change*, so opening a board and touching nothing runs this again next load.
		const once = up(board(rollup('shape:a'), rollup('shape:b', { title: 'By category' })))
		const snapshot = JSON.stringify(once)
		expect(JSON.stringify(up(JSON.parse(snapshot)))).toBe(snapshot)
	})

	it('survives records that have not been validated yet', () => {
		// Runs before validation, so nothing may be assumed well-formed.
		const store = board(
			{ id: 'shape:a', typeName: 'shape', type: 'node.rollup', props: {} },
			{ id: 'shape:b', typeName: 'shape', type: 'node.rollup', props: { source: 'nope', agg: 7 } },
			{ id: 'shape:c', typeName: 'shape', type: 'node.rollup' }
		)
		expect(() => up(store)).not.toThrow()
		expect(store['shape:a']!.type).toBe('node.table')
		// `w`/`h` are `T.nonZeroNumber`, so an absent size has to become a usable one or validation fails
		// moments later.
		expect(propsOf(store, 'shape:a')).toMatchObject({ w: 280, h: 150 })
	})
})
