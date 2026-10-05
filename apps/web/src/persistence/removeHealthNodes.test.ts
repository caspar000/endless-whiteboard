import '../extensions'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
	createNodeShapeUtil,
	getNodeDefinitions,
	itemsToNotesMigrations,
	removeHealthNodesMigrations,
	rollupsToTablesMigrations,
} from '@lifeboard/node-kit'
import { createTLStore, defaultBindingUtils, defaultShapeUtils, loadSnapshot, type TLStoreSnapshot } from '@lifeboard/canvas'

const fixture = fileURLToPath(new URL('./fixtures/health/v0.1.0-health.json', import.meta.url))

it('opens a board written with health cards, and the cards are gone', () => {
	const store = createTLStore({
		shapeUtils: [...defaultShapeUtils, ...getNodeDefinitions().map(createNodeShapeUtil)],
		bindingUtils: defaultBindingUtils,
		migrations: [itemsToNotesMigrations, rollupsToTablesMigrations, removeHealthNodesMigrations],
	})
	const snapshot = JSON.parse(readFileSync(fixture, 'utf8')) as TLStoreSnapshot
	expect(Object.values(snapshot.store).filter((r) => r.typeName === 'shape')).toHaveLength(13)

	expect(() => loadSnapshot(store, snapshot)).not.toThrow()
	expect(store.allRecords().filter((r) => r.typeName === 'shape')).toEqual([])
})
