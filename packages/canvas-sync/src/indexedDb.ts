import type { UnknownRecord } from '@tldraw/store'
import type { SyncCache, SyncCacheChanges, SyncCacheContents, SyncCacheState } from './cache.ts'

/**
 * Boards kept in this browser's IndexedDB, all in one database: `records` keyed by `[room, record id]`
 * and `rooms` holding each room's sync state. One database rather than one per board, so a board
 * can be dropped (or every board listed) without opening a database per board.
 */
const DB_VERSION = 1
const RECORDS = 'records'
const ROOMS = 'rooms'

export const DEFAULT_SYNC_CACHE_DB = 'lifeboard-sync-cache'

/** A board's cache in IndexedDB. `room` is the board's id. */
export function indexedDbSyncCache<R extends UnknownRecord>(room: string, dbName = DEFAULT_SYNC_CACHE_DB): SyncCache<R> {
	let writes: Promise<void> = Promise.resolve()
	/** Bumped by each stash, so a save only drops the stash it was written alongside. */
	let stashes = 0
	const save = (changes: SyncCacheChanges<R>): Promise<void> => {
		writes = writes.then(() => write(dbName, room, changes)).catch((error) => {
			console.error('Lifeboard: could not keep a board on this device.', error)
		})
		return writes
	}
	return {
		async load(): Promise<SyncCacheContents<R> | null> {
			await writes
			const saved = await withDb(dbName, async (db) => {
				const tx = db.transaction([RECORDS, ROOMS], 'readonly')
				// Both asked for before either is awaited, so the transaction can't close between them.
				const [state, records] = await Promise.all([
					request<SyncCacheState<R> | undefined>(tx.objectStore(ROOMS).get(room)),
					request<R[]>(tx.objectStore(RECORDS).getAll(roomRange(room))),
				])
				return state ? { records, state } : null
			})
			// What the last page stashed as it went: newer than anything the database has.
			const stash = readStash<R>(stashKey(dbName, room))
			if (!stash) return saved
			const records = new Map<string, R>((saved?.records ?? []).map((record) => [record.id, record]))
			for (const record of stash.put) records.set(record.id, record)
			for (const id of stash.remove) records.delete(id)
			await save(stash)
			clearStash(stashKey(dbName, room))
			return { records: [...records.values()], state: stash.state }
		},
		save,
		saveBeforeUnload(changes: SyncCacheChanges<R>): void {
			// Synchronous, so it's written before the page is gone; merged with any earlier stash (the
			// tab went to the background, then closed) so neither loses the other's records.
			const key = stashKey(dbName, room)
			const earlier = readStash<R>(key)
			const merged = earlier ? mergeChanges(earlier, changes) : changes
			const token = ++stashes
			writeStash(key, merged)
			// If the page lives on, the database catches up and the stash isn't needed.
			void save(merged).then(() => {
				if (token === stashes) clearStash(key)
			})
		},
	}
}

/** `later` on top of `earlier`: the records either wrote, and `later`'s state. */
function mergeChanges<R extends UnknownRecord>(earlier: SyncCacheChanges<R>, later: SyncCacheChanges<R>): SyncCacheChanges<R> {
	const put = new Map<string, R>(earlier.put.map((record) => [record.id, record]))
	const remove = new Set(earlier.remove)
	for (const record of later.put) {
		put.set(record.id, record)
		remove.delete(record.id)
	}
	for (const id of later.remove) {
		put.delete(id)
		remove.add(id)
	}
	return { put: [...put.values()], remove: [...remove], state: later.state }
}

/** A stash past this size isn't written: localStorage is small, and the database write may yet land. */
const MAX_STASH_CHARS = 2_000_000

const stashKey = (dbName: string, room: string) => `${dbName}:stash:${room}`

function readStash<R extends UnknownRecord>(key: string): SyncCacheChanges<R> | null {
	try {
		const raw = globalThis.localStorage?.getItem(key)
		return raw ? (JSON.parse(raw) as SyncCacheChanges<R>) : null
	} catch {
		return null
	}
}

function writeStash<R extends UnknownRecord>(key: string, changes: SyncCacheChanges<R>): void {
	try {
		const json = JSON.stringify(changes)
		if (json.length <= MAX_STASH_CHARS) globalThis.localStorage?.setItem(key, json)
	} catch {
		// Full, or private mode: the database write is all there is.
	}
}

function clearStash(key: string): void {
	try {
		globalThis.localStorage?.removeItem(key)
	} catch {
		// Nothing to do.
	}
}

/** Drops a board from the cache: it was deleted, or moved off the server. */
export function clearSyncCache(room: string, dbName = DEFAULT_SYNC_CACHE_DB): Promise<void> {
	clearStash(stashKey(dbName, room))
	return withDb(dbName, async (db) => {
		const tx = db.transaction([RECORDS, ROOMS], 'readwrite')
		tx.objectStore(RECORDS).delete(roomRange(room))
		tx.objectStore(ROOMS).delete(room)
		await done(tx)
	})
}

/** The boards the cache holds. */
export function listSyncCacheRooms(dbName = DEFAULT_SYNC_CACHE_DB): Promise<string[]> {
	return withDb(dbName, async (db) => {
		const tx = db.transaction(ROOMS, 'readonly')
		const keys = await request<IDBValidKey[]>(tx.objectStore(ROOMS).getAllKeys())
		return keys.map(String)
	})
}

async function write<R extends UnknownRecord>(dbName: string, room: string, { put, remove, state }: SyncCacheChanges<R>) {
	await withDb(dbName, async (db) => {
		const tx = db.transaction([RECORDS, ROOMS], 'readwrite')
		const records = tx.objectStore(RECORDS)
		for (const record of put) records.put(record, [room, record.id])
		for (const id of remove) records.delete([room, id])
		tx.objectStore(ROOMS).put(state, room)
		await done(tx)
	})
}

/** Every key of one room: `[room]` sorts before `[room, anything]`, and `[room, []]` after it. */
const roomRange = (room: string) => IDBKeyRange.bound([room], [room, []])

let opening: Promise<IDBDatabase> | null = null
let openName = ''

/** One connection, kept open: opening a database for every save would cost more than the save. */
async function withDb<T>(dbName: string, run: (db: IDBDatabase) => Promise<T>): Promise<T> {
	if (!opening || openName !== dbName) {
		openName = dbName
		opening = new Promise<IDBDatabase>((resolve, reject) => {
			const open = indexedDB.open(dbName, DB_VERSION)
			open.onupgradeneeded = () => {
				const db = open.result
				if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS)
				if (!db.objectStoreNames.contains(ROOMS)) db.createObjectStore(ROOMS)
			}
			open.onsuccess = () => {
				const db = open.result
				// Another tab upgrading: let it, and open again next time.
				db.onversionchange = () => {
					db.close()
					opening = null
				}
				resolve(db)
			}
			open.onerror = () => reject(open.error)
		})
		opening.catch(() => {
			opening = null
		})
	}
	return run(await opening)
}

function request<T>(req: IDBRequest): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result as T)
		req.onerror = () => reject(req.error)
	})
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error ?? new Error('The write was abandoned.'))
	})
}
