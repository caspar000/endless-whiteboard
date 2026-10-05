// The composition root, for its registrations: the schema below must be the app's.
import '../extensions'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { STORE_MIGRATIONS } from '@lifeboard/schema'
import { createTLStore, defaultBindingUtils, loadSnapshot, type TLStoreSnapshot } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { buildBoardShapeUtils, buildStoreShapeUtils } from '../canvas/boardShapeUtils'

/**
 * The canvas fork's reference boards (`packages/canvas/fixtures/`), loaded by the app as it is now.
 * This is the baseline the fork is held to: what loads here, record for record, must load there.
 */
const dir = fileURLToPath(new URL('../../../../packages/canvas/fixtures/', import.meta.url))
const boards = readdirSync(dir).filter((file) => file.endsWith('.json'))

describe('canvas fork reference boards', () => {
	it('has both boards', () => {
		expect(boards.sort()).toEqual(['default-shapes.json', 'lifeboard.json'])
	})

	it.each(boards)('%s loads with every record intact', (file) => {
		const snapshot = JSON.parse(readFileSync(`${dir}${file}`, 'utf8')) as TLStoreSnapshot
		const store = createTLStore({
			shapeUtils: buildStoreShapeUtils(buildBoardShapeUtils()),
			bindingUtils: defaultBindingUtils,
			migrations: STORE_MIGRATIONS,
		})
		loadSnapshot(store, snapshot)
		// The document only: loading also creates this session's camera and instance records.
		const loaded = store.getStoreSnapshot('document').store
		expect(Object.keys(loaded).sort()).toEqual(Object.keys(snapshot.store).sort())
		for (const [id, record] of Object.entries(snapshot.store)) expect(loaded[id]).toEqual(record)
	})
})
