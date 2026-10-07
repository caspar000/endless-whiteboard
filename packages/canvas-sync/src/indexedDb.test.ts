import 'fake-indexeddb/auto'
import type { TLRecord } from '@tldraw/tlschema'
import { describe, expect, it } from 'vitest'
import { clearSyncCache, indexedDbSyncCache, listSyncCacheRooms } from './indexedDb.ts'
import { frame, schema } from './test/harness.ts'

describe('the IndexedDB cache', () => {
	it('keeps each board apart, writes in order, and drops a board whole', async () => {
		const db = `test-${Math.random()}`
		const one = indexedDbSyncCache<TLRecord>('one', db)
		const two = indexedDbSyncCache<TLRecord>('two', db)
		const state = { schema: schema.serialize(), since: { epoch: 'e', clock: 3 }, base: [] }

		expect(await one.load()).toBeNull()
		void one.save({ put: [frame('a'), frame('b')], remove: [], state })
		void one.save({ put: [], remove: [frame('a').id], state: { ...state, since: { epoch: 'e', clock: 4 } } })
		await two.save({ put: [frame('c')], remove: [], state })

		const loaded = await one.load()
		expect(loaded!.records.map((r) => r.id)).toEqual([frame('b').id])
		expect(loaded!.state.since).toEqual({ epoch: 'e', clock: 4 })
		expect((await listSyncCacheRooms(db)).sort()).toEqual(['one', 'two'])

		await clearSyncCache('one', db)
		expect(await one.load()).toBeNull()
		expect((await two.load())!.records).toHaveLength(1)
		expect(await listSyncCacheRooms(db)).toEqual(['two'])
	})
})
