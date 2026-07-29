import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createNodeShapeUtil, getNodeDefinitions, ITEM_NODE_TYPE } from '@lifeboard/node-kit'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	loadSnapshot,
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
		expect(shapes.length).toBeGreaterThan(0)

		// Every node type must survive the round trip, not just load without throwing. A migration
		// that dropped or blanked records would otherwise pass the check above.
		const types = new Set(shapes.map((s) => (s as { type: string }).type))
		for (const def of getNodeDefinitions()) {
			expect(types.has(def.type), `${file} should still contain a ${def.type}`).toBe(true)
		}
	})

	it.each(files)('preserves item field data in %s', (file) => {
		const snapshot = JSON.parse(readFileSync(join(fixturesDir, file), 'utf8')) as TLStoreSnapshot
		const store = makeStore()
		loadSnapshot(store, snapshot)

		const items = store
			.allRecords()
			.filter((r) => r.typeName === 'shape' && (r as { type: string }).type === ITEM_NODE_TYPE)

		expect(items.length).toBeGreaterThan(0)
		for (const item of items) {
			const props = (item as { props: { title: string; fields: { key: string; value: unknown }[] } })
				.props
			expect(typeof props.title).toBe('string')
			expect(Array.isArray(props.fields)).toBe(true)
		}

		// The whole point of the shopping vertical: prices must still be numbers after migration, or
		// every rollup silently reads zero.
		const prices = items
			.flatMap((i) => (i as { props: { fields: { key: string; value: unknown }[] } }).props.fields)
			.filter((f) => f.key === 'price')
		expect(prices.length).toBeGreaterThan(0)
		for (const price of prices) expect(typeof price.value).toBe('number')
	})
})
