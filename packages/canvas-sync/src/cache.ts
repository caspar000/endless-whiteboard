import type { SerializedSchema, UnknownRecord } from '@tldraw/store'

/**
 * A board kept on this device between visits (docs/fork-parity.md S5), so it opens without the server
 * and keeps edits the server hasn't confirmed across a reload.
 *
 * The client saves what changed as it goes: records written or removed, and where it stands with the
 * server. Loading gives the board back as it was last saved, and the client takes it from there: it
 * shows the board at once, and on reaching the server, catches up from where it left off and sends
 * what is still unconfirmed.
 */
export interface SyncCache<R extends UnknownRecord = UnknownRecord> {
	load(): Promise<SyncCacheContents<R> | null>
	/** Writes in the order called; a write must not overtake an earlier one. */
	save(changes: SyncCacheChanges<R>): Promise<void>
	/**
	 * Saves as the page goes away, in a way that survives it if the cache has one: a write that is
	 * still running when the page unloads can be lost. Falls back to `save`.
	 */
	saveBeforeUnload?(changes: SyncCacheChanges<R>): void
}

export interface SyncCacheState<R extends UnknownRecord = UnknownRecord> {
	/** The schema the records were saved under: a newer app migrates them on load. */
	schema: SerializedSchema
	/** Where this device left off with the server: its history and clock. */
	since?: { epoch: string; clock: number }
	/** The server's version of each record with edits it hasn't confirmed (`null`: it hasn't the record). */
	base: Array<[string, R | null]>
}

export interface SyncCacheContents<R extends UnknownRecord = UnknownRecord> {
	/** Every document record, as this device last had them. */
	records: R[]
	state: SyncCacheState<R>
}

export interface SyncCacheChanges<R extends UnknownRecord = UnknownRecord> {
	put: R[]
	remove: string[]
	state: SyncCacheState<R>
}

/** A cache in memory: for tests, and for a client that should forget on reload. */
export class MemorySyncCache<R extends UnknownRecord = UnknownRecord> implements SyncCache<R> {
	records = new Map<string, R>()
	state: SyncCacheState<R> | null = null

	async load(): Promise<SyncCacheContents<R> | null> {
		if (!this.state) return null
		return structuredClone({ records: [...this.records.values()], state: this.state })
	}

	async save({ put, remove, state }: SyncCacheChanges<R>): Promise<void> {
		for (const record of put) this.records.set(record.id, structuredClone(record))
		for (const id of remove) this.records.delete(id)
		this.state = structuredClone(state)
	}
}
