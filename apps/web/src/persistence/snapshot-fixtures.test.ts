// The composition root, for its registrations: the store built below must carry exactly the schema
// the app applies to a user's board, which since the extension split means every registered
// extension's types too — not just node-kit's built-ins.
import '../extensions'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
	createNodeShapeUtil,
	getNodeDefinitions,
	itemsToNotesMigrations,
	rollupsToTablesMigrations,
	ITEM_NODE_TYPE,
	ROLLUP_NODE_TYPE,
	TABLE_NODE_TYPE,
	parsePropertyRegistry,
	readShapeProperties,
	type TableNodeProps,
} from '@lifeboard/node-kit'
import { NOTE_NODE_TYPE } from '@lifeboard/note-markdown'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	loadSnapshot,
	type JsonObject,
	type TLStoreSnapshot,
} from 'tldraw'

/**
 * The §7 guardrail: "keep fixture snapshots from each release and a test that `loadSnapshot`s all of
 * them."
 *
 * Every fixture is a real snapshot taken from a shipped version of the app. Loading it through the
 * *current* schema is what proves that a props change came with a migration. Without this, changing
 * a node's props would corrupt every existing board and the only symptom would be a user's board
 * failing to open.
 */
const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')

function fixtureFiles(): string[] {
	return readdirSync(fixturesDir)
		.filter((f) => f.endsWith('.json'))
		.sort()
}

function makeStore() {
	// The node shape utils come from the same registry the app uses, so this test sees exactly the
	// schema the app would apply to a user's board. tldraw's own defaults have to be included too:
	// omitting them leaves the built-in migration sequences out of the schema, and loading fails with
	// "depends on missing migration com.tldraw.shape.arrow/4" — a failure about the test setup, not
	// about our data.
	return createTLStore({
		shapeUtils: [...defaultShapeUtils, ...getNodeDefinitions().map(createNodeShapeUtil)],
		bindingUtils: defaultBindingUtils,
		// The same store migrations `<Tldraw migrations>` gets. Without them this test would load
		// fixtures through a schema the app never actually uses, and the one migration that rewrites
		// records across *types* would go completely unexercised on real data.
		migrations: [itemsToNotesMigrations, rollupsToTablesMigrations],
	})
}

describe('snapshot fixtures', () => {
	const files = fixtureFiles()

	it('has at least one fixture, or the guardrail is vacuous', () => {
		expect(files.length).toBeGreaterThan(0)
	})

	it.each(files)('loads %s through the current schema', (file) => {
		const snapshot = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as TLStoreSnapshot
		const store = makeStore()

		// `loadSnapshot` runs the migration sequences. A missing migration throws here.
		expect(() => loadSnapshot(store, snapshot)).not.toThrow()

		const shapes = store.allRecords().filter((r) => r.typeName === 'shape')

		// **No record from the snapshot may disappear.** This replaced "every registered type is still
		// present", which was the wrong invariant twice over: it broke whenever a type was added (no old
		// fixture contains it) and it forbade exactly what a store migration is *for* — deliberately
		// rewriting one type into another.
		//
		// Checked by id rather than by count, because loading legitimately *adds* session records
		// (instance, camera, page state, pointer) that no document snapshot contains. Ids are also what
		// makes this strict enough to matter: the item→note migration rewrites records in place, so a
		// version that created new shapes and deleted the old ones would fail here — and so would every
		// arrow binding and frame parent on the user's board.
		for (const id of Object.keys(snapshot.store)) {
			expect(store.has(id as never), `${file} lost record ${id}`).toBe(true)
		}
		expect(shapes.length).toBeGreaterThan(0)
	})

	it.each(files)('runs props migrations on %s', (file) => {
		// The note node's `autoHeight` was the repo's first real props migration. The v0.1.0 fixture
		// predates it (its schema records `com.tldraw.shape.node.markdown: 0` and its shapes have no
		// `autoHeight`), so loading it here is what proves the migration actually runs — and that it
		// adds `false`, not `true`: a note drawn at a fixed height must keep the height it was drawn at.
		const snapshot = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as TLStoreSnapshot
		const store = makeStore()
		loadSnapshot(store, snapshot)

		const notes = store
			.allRecords()
			.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === 'node.markdown')

		expect(notes.length).toBeGreaterThan(0)
		for (const note of notes) {
			const props = (note as { props: { md: string; autoHeight: boolean } }).props
			expect(typeof props.autoHeight).toBe('boolean')
			expect(props.autoHeight).toBe(false)
			// The content itself must survive untouched.
			expect(props.md.length).toBeGreaterThan(0)
		}
	})

	it.each(files)('turns the rollups in %s into tables that still show their number', (file) => {
		const raw = readFileSync(join(fixturesDir, file), 'utf8')
		const snapshot = JSON.parse(raw) as TLStoreSnapshot
		const store = makeStore()
		loadSnapshot(store, snapshot)

		const rollupsInFixture = Object.values(snapshot.store).filter(
			(r) => (r as { type?: string }).type === ROLLUP_NODE_TYPE
		)
		expect(rollupsInFixture.length).toBeGreaterThan(0)

		// None survive as rollups…
		expect(
			store
				.allRecords()
				.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === ROLLUP_NODE_TYPE)
		).toEqual([])

		// …and each became a table still pointed at the same property, with the same operation, showing
		// one big number rather than silently becoming a grid.
		const tables = store
			.allRecords()
			.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === TABLE_NODE_TYPE)
		expect(tables).toHaveLength(rollupsInFixture.length)

		for (const table of tables) {
			const props = (table as unknown as { props: TableNodeProps }).props
			expect(props.layout.mode).toBe('value')
			expect(props.columns).toHaveLength(1)
			expect(props.columns[0]!.summary).toBeTruthy()
		}

		// The fixture's rollups summed `price`, which is exactly the property the item migration defined —
		// so the two passes agree, which is what `dependsOn` is there to guarantee.
		const summed = tables.map(
			(t) => (t as unknown as { props: TableNodeProps }).props.columns[0]!.key
		)
		expect(summed).toContain('price')
	})

	it.each(files)('turns the items in %s into notes carrying properties', (file) => {
		// The item→note migration, proven against a snapshot a shipped version of the app really wrote.
		// This is the test that would fail if the migration mangled someone's shopping board.
		const raw = readFileSync(join(fixturesDir, file), 'utf8')
		const snapshot = JSON.parse(raw) as TLStoreSnapshot
		const store = makeStore()
		loadSnapshot(store, snapshot)

		// The fixture has to actually contain items, or this proves nothing.
		const itemsInFixture = Object.values(snapshot.store).filter(
			(r) => (r as { type?: string }).type === ITEM_NODE_TYPE
		)
		expect(itemsInFixture.length).toBeGreaterThan(0)

		// None survive as items…
		const remaining = store
			.allRecords()
			.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === ITEM_NODE_TYPE)
		expect(remaining).toEqual([])

		// …and their titles came across as note headings.
		const notes = store
			.allRecords()
			.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === NOTE_NODE_TYPE)
		const titles = itemsInFixture.map((i) => (i as { props: { title: string } }).props.title)
		const mds = notes.map((n) => (n as { props: { md: string } }).props.md)
		for (const title of titles.filter(Boolean)) {
			expect(
				mds.some((md) => md.includes(title)),
				`expected a note headed "${title}"`
			).toBe(true)
		}

		// The whole point of the shopping vertical: prices must still be numbers, or every rollup
		// silently reads zero.
		const prices = notes
			.map((n) => readShapeProperties(n as unknown as { meta: JsonObject }).price)
			.filter((v) => v !== undefined)
		expect(prices.length).toBeGreaterThan(0)
		for (const price of prices) expect(typeof price).toBe('number')

		// And the board learned what a price *is* — without a registry entry the value is uninterpretable
		// and aggregation would refuse to sum it.
		const document = store.allRecords().find((r) => r.typeName === 'document')
		const registry = parsePropertyRegistry(
			(document as { meta: Record<string, unknown> }).meta['lifeboard:properties']
		)
		expect(registry.find((d) => d.id === 'price')).toMatchObject({
			// The fixture predates the `currency` → `financial` rename; the migration writes, and
			// the registry parser reads, the normalised name.
			type: 'financial',
			unit: 'GEL',
		})
	})
})
