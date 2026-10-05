import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	TLDRAW_DB_NAME_INDEX_KEY,
	TLDRAW_STORE_PREFIX,
	persistenceKeyForBoard,
} from './tldrawLocalDb'

/**
 * The integration test the plan asks for (§4.4, risk table: "tldraw internal DB naming (board
 * delete) → single wrapper function + integration test; exact-version pin").
 *
 * Rather than trusting a comment, this reads the constants back out of the canvas fork's local
 * persistence source and asserts ours still match. The fork kept tldraw's names so existing boards
 * open; if a change renames them, this fails loudly instead of board deletion silently leaving
 * canvas data on disk forever.
 */
function readTldrawLocalIndexedDbSource(): string {
	return readFileSync(
		new URL('../../../../packages/canvas-editor/src/lib/utils/sync/indexedDb.ts', import.meta.url),
		'utf8'
	)
}

describe('tldraw local IndexedDB naming', () => {
	const source = readTldrawLocalIndexedDbSource()

	it('still names document databases with our pinned prefix', () => {
		expect(source).toContain(`const STORE_PREFIX = '${TLDRAW_STORE_PREFIX}'`)
	})

	it('still keeps its database-name index under our pinned localStorage key', () => {
		expect(source).toContain(`const dbNameIndexKey = '${TLDRAW_DB_NAME_INDEX_KEY}'`)
	})

	it('still composes the db name as prefix + persistenceKey', () => {
		// Guards the *shape* of the name, not just the prefix: if tldraw started hashing or
		// suffixing the key, `deleteTldrawDocument` would target a database that doesn't exist.
		expect(source).toMatch(/STORE_PREFIX\s*\+\s*(this\.)?persistenceKey/)
	})

	it('still uses the object-store names and version that readBoardSnapshot depends on', () => {
		// `readBoardSnapshot` reads these stores directly so that backup export can snapshot boards
		// that have no mounted editor. If any of this drifts, export would silently produce empty
		// boards — so it is pinned too.
		expect(source).toContain("Records: 'records'")
		expect(source).toContain("Schema: 'schema'")
		expect(source).toMatch(/const DB_VERSION = 4\b/)
		expect(source).toMatch(/openDB<StoreName>\(storeId,\s*DB_VERSION\b/)
	})

	it('still stores the serialized schema under the key "schema"', () => {
		// tldraw writes it as `schemaStore.put(schema.serialize(), Table.Schema)`, i.e. key ===
		// the store name. `readBoardSnapshot` reads `get('schema')` on that assumption.
		expect(source).toContain('schemaStore.put(schema.serialize(), Table.Schema)')
	})
})

describe('persistenceKeyForBoard', () => {
	it('namespaces board keys so they cannot collide with other tldraw apps on this origin', () => {
		expect(persistenceKeyForBoard('abc123')).toBe('lifeboard-abc123')
	})
})
