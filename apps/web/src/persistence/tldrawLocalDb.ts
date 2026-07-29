/**
 * The **one** place that knows how tldraw names its local IndexedDB databases.
 *
 * These constants are internal to tldraw (`@tldraw/editor/src/lib/utils/sync/LocalIndexedDb.ts`,
 * where they carry the comment "DO NOT CHANGE THESE WITHOUT ADDING MIGRATION LOGIC"). They are not
 * part of tldraw's public API, so a tldraw upgrade could change them — which is exactly why they
 * appear here once, behind one function, pinned by `tldrawLocalDb.test.ts`.
 *
 * If that test ever fails after a version bump: deleting a board would silently leave its canvas
 * data on disk forever. Fix the constants, don't delete the test.
 *
 * Verified against tldraw 5.2.5. See docs/tldraw-api-notes.md.
 */
export const TLDRAW_STORE_PREFIX = 'TLDRAW_DOCUMENT_v2'
export const TLDRAW_DB_NAME_INDEX_KEY = 'TLDRAW_DB_NAME_INDEX_v2'

/**
 * tldraw throttles writes to IndexedDB (`PERSIST_THROTTLE_MS` in `TLLocalSyncClient.ts`), and it
 * does *not* flush on unload — `close()` is a noop and persists are deliberately skipped once a
 * reload has started. So for a short window after an edit, the edit exists only in memory.
 *
 * That matters here because backup export reads from the database, not from a live editor: exporting
 * immediately after an edit would otherwise silently write a stale board into the zip. `exportBackup`
 * waits out this window first.
 *
 * Residual limitation worth knowing: closing the tab within this window still loses the last edit.
 * That is tldraw's behaviour, not something we can fix from outside without its internals.
 */
export const TLDRAW_PERSIST_THROTTLE_MS = 350

/** Waits long enough for a pending throttled write to have been issued and completed. */
export function waitForPersistFlush(): Promise<void> {
	// Throttle window plus margin for the write itself.
	return new Promise((resolve) => setTimeout(resolve, TLDRAW_PERSIST_THROTTLE_MS + 250))
}

/** The `persistenceKey` we hand to `<Tldraw>` for a given board. */
export function persistenceKeyForBoard(boardId: string): string {
	return `lifeboard-${boardId}`
}

function tldrawDbName(persistenceKey: string): string {
	return `${TLDRAW_STORE_PREFIX}${persistenceKey}`
}

function readDbNameIndex(): string[] {
	try {
		const raw = localStorage.getItem(TLDRAW_DB_NAME_INDEX_KEY)
		const parsed = raw ? JSON.parse(raw) : []
		return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []
	} catch {
		return []
	}
}

/**
 * Deletes a board's canvas database *and* removes its name from tldraw's localStorage index.
 * Skipping the second step is the subtle bug: tldraw would keep listing a database that no longer
 * exists, and the index would grow without bound as boards come and go.
 */
export async function deleteTldrawDocument(boardId: string): Promise<{ deleted: boolean }> {
	const persistenceKey = persistenceKeyForBoard(boardId)
	const dbName = tldrawDbName(persistenceKey)

	const deleted = await new Promise<boolean>((resolve) => {
		const request = indexedDB.deleteDatabase(dbName)
		// Bounded, because another *tab* holding the database open would otherwise hang the delete
		// forever and leave the UI stuck.
		const timer = setTimeout(() => resolve(false), 5_000)
		const settle = (ok: boolean) => {
			clearTimeout(timer)
			resolve(ok)
		}
		request.addEventListener('success', () => settle(true))
		request.addEventListener('error', () => settle(false))
		// `blocked` is deliberately NOT treated as terminal. It means a connection is still open, but
		// the request stays pending and completes the moment that connection closes. Resolving here
		// (as an earlier version did) reported success while the board's data was still on disk.
	})

	if (deleted) {
		// Only drop the name once the database is actually gone, so the index never claims a
		// deletion that didn't happen.
		const remaining = readDbNameIndex().filter((name) => name !== dbName)
		try {
			localStorage.setItem(TLDRAW_DB_NAME_INDEX_KEY, JSON.stringify(remaining))
		} catch {
			// A full or unavailable localStorage is not worth failing the delete over.
		}
	}

	return { deleted }
}

/** All board ids tldraw currently holds a database for — used to detect orphaned canvas data. */
export function listPersistedBoardIds(): string[] {
	const prefix = `${TLDRAW_STORE_PREFIX}lifeboard-`
	return readDbNameIndex()
		.filter((name) => name.startsWith(prefix))
		.map((name) => name.slice(prefix.length))
}

// ---------------------------------------------------------------------------
// Reading a board's snapshot without mounting an editor
// ---------------------------------------------------------------------------

/**
 * Backup export has to snapshot *every* board, but only the open board has a mounted editor — so
 * `editor.getSnapshot()` can't reach the others. Reading tldraw's own database directly is the
 * alternative, and it's cheap: a `TLStoreSnapshot` is exactly `{ store, schema }`, which is exactly
 * what the `records` and `schema` object stores hold.
 *
 * Crucially the *schema version travels with the data*, so importing runs tldraw's migrations
 * automatically via the `snapshot` prop — the same guarantee the plan relies on (§4.4).
 *
 * These object-store names are internal to tldraw and pinned by `tldrawLocalDb.test.ts`, same as
 * the database name above.
 */
const RECORDS_STORE = 'records'
const SCHEMA_STORE = 'schema'
/** tldraw stores its serialized schema under a key equal to the store name. */
const SCHEMA_KEY = 'schema'
const TLDRAW_DB_VERSION = 4

export interface RawBoardSnapshot {
	store: Record<string, unknown>
	schema: unknown
}

function openExistingDb(dbName: string): Promise<IDBDatabase | null> {
	return new Promise((resolve) => {
		// Opening at tldraw's own version avoids triggering an upgrade; if the database does not
		// exist yet, `upgradeneeded` fires and we abort rather than creating an empty one.
		const request = indexedDB.open(dbName, TLDRAW_DB_VERSION)
		let missing = false
		request.addEventListener('upgradeneeded', () => {
			missing = true
			request.transaction?.abort()
		})
		request.addEventListener('success', () => {
			if (missing) {
				request.result.close()
				resolve(null)
			} else {
				resolve(request.result)
			}
		})
		request.addEventListener('error', () => resolve(null))
		request.addEventListener('blocked', () => resolve(null))
	})
}

/** Returns `null` when the board has never been opened, so has no canvas data yet. */
export async function readBoardSnapshot(boardId: string): Promise<RawBoardSnapshot | null> {
	const db = await openExistingDb(tldrawDbName(persistenceKeyForBoard(boardId)))
	if (!db) return null

	try {
		if (!db.objectStoreNames.contains(RECORDS_STORE) || !db.objectStoreNames.contains(SCHEMA_STORE)) {
			return null
		}

		return await new Promise<RawBoardSnapshot | null>((resolve) => {
			const tx = db.transaction([RECORDS_STORE, SCHEMA_STORE], 'readonly')
			const recordsReq = tx.objectStore(RECORDS_STORE).getAll()
			const keysReq = tx.objectStore(RECORDS_STORE).getAllKeys()
			const schemaReq = tx.objectStore(SCHEMA_STORE).get(SCHEMA_KEY)

			tx.addEventListener('complete', () => {
				const records = recordsReq.result as unknown[]
				const ids = keysReq.result as IDBValidKey[]
				const schema = schemaReq.result as unknown
				if (!schema || records.length === 0) {
					resolve(null)
					return
				}
				const store: Record<string, unknown> = {}
				ids.forEach((id, i) => {
					store[String(id)] = records[i]
				})
				resolve({ store, schema })
			})
			tx.addEventListener('error', () => resolve(null))
			tx.addEventListener('abort', () => resolve(null))
		})
	} finally {
		db.close()
	}
}
