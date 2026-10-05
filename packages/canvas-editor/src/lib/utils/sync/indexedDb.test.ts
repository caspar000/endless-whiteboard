import { createTLSchema } from '@tldraw/tlschema'
import {
	getAllIndexDbNames,
	loadDataFromStore,
	storeChangesInIndexedDb,
	storeSnapshotInIndexedDb,
} from './indexedDb'

const clearAll = async () => {
	const dbs = (indexedDB as any)._databases as Map<any, any>
	dbs.clear()
	localStorage.clear()
}

beforeEach(async () => {
	await clearAll()
})
const schema = createTLSchema({ shapes: {}, bindings: {} })
describe('storeSnapshotInIndexedDb', () => {
	it("creates documents if they don't exist", async () => {
		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-0',
			schema,
			snapshot: {},
		})

		expect(getAllIndexDbNames()).toMatchInlineSnapshot(`
		      Array [
		        "TLDRAW_DOCUMENT_v2test-0",
		      ]
	    `)

		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-1',
			schema,
			snapshot: {},
		})

		expect(getAllIndexDbNames()).toMatchInlineSnapshot(`
		      Array [
		        "TLDRAW_DOCUMENT_v2test-0",
		        "TLDRAW_DOCUMENT_v2test-1",
		      ]
	    `)

		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-1',
			schema,
			snapshot: {},
		})

		expect(getAllIndexDbNames()).toMatchInlineSnapshot(`
		      Array [
		        "TLDRAW_DOCUMENT_v2test-0",
		        "TLDRAW_DOCUMENT_v2test-1",
		      ]
	    `)
	})

	it('allows reading back the snapshot', async () => {
		expect(getAllIndexDbNames()).toMatchInlineSnapshot(`Array []`)
		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-0',
			schema,
			snapshot: {
				'shape:1': {
					id: 'shape:1',
					type: 'rectangle',
				},
				'page:1': {
					id: 'page:1',
					name: 'steve',
				},
			},
		})

		expect(getAllIndexDbNames()).toMatchInlineSnapshot(`
		Array [
		  "TLDRAW_DOCUMENT_v2test-0",
		]
	`)

		const records = (await loadDataFromStore({ persistenceKey: 'test-0' }))?.records
		expect(records).toMatchInlineSnapshot(`
		Array [
		  Object {
		    "id": "page:1",
		    "name": "steve",
		  },
		  Object {
		    "id": "shape:1",
		    "type": "rectangle",
		  },
		]
	`)
	})

	it('allows storing a session under a particular ID and reading it back', async () => {
		const snapshot = {
			'shape:1': {
				id: 'shape:1',
				type: 'rectangle',
			},
		}

		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-0',
			sessionId: 'session-0',
			schema,
			snapshot,
			sessionStateSnapshot: {
				foo: 'bar',
			} as any,
		})

		expect(
			(await loadDataFromStore({ persistenceKey: 'test-0', sessionId: 'session-0' }))
				?.sessionStateSnapshot
		).toMatchInlineSnapshot(`
		Object {
		  "foo": "bar",
		}
	`)

		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-0',
			sessionId: 'session-1',
			schema,
			snapshot,
			sessionStateSnapshot: {
				hello: 'world',
			} as any,
		})

		expect(
			(await loadDataFromStore({ persistenceKey: 'test-0', sessionId: 'session-0' }))
				?.sessionStateSnapshot
		).toMatchInlineSnapshot(`
		Object {
		  "foo": "bar",
		}
	`)

		expect(
			(await loadDataFromStore({ persistenceKey: 'test-0', sessionId: 'session-1' }))
				?.sessionStateSnapshot
		).toMatchInlineSnapshot(`
		Object {
		  "hello": "world",
		}
	`)
	})
})

describe(storeChangesInIndexedDb, () => {
	it('allows merging changes into an existing store', async () => {
		await storeSnapshotInIndexedDb({
			persistenceKey: 'test-0',
			schema,
			snapshot: {
				'shape:1': {
					id: 'shape:1',
					version: 0,
				},
				'page:1': {
					id: 'page:1',
					version: 0,
				},
				'asset:1': {
					id: 'asset:1',
					version: 0,
				},
			},
		})

		await storeChangesInIndexedDb({
			persistenceKey: 'test-0',
			schema,
			changes: {
				added: {
					'asset:2': {
						id: 'asset:2',
						version: 0,
					},
				},
				updated: {
					'page:1': [
						{
							id: 'page:1',
							version: 0,
						},
						{
							id: 'page:1',
							version: 1,
						},
					],
				},
				removed: {
					'shape:1': {
						id: 'shape:1',
						version: 0,
					},
				},
			},
		})

		expect((await loadDataFromStore({ persistenceKey: 'test-0' }))?.records).toMatchInlineSnapshot(`
		Array [
		  Object {
		    "id": "asset:1",
		    "version": 0,
		  },
		  Object {
		    "id": "asset:2",
		    "version": 0,
		  },
		  Object {
		    "id": "page:1",
		    "version": 1,
		  },
		]
	`)
	})
})

describe('a board saved by tldraw 5.5', () => {
	// The layout tldraw 5.5 leaves in the browser, as read from a Lifeboard board: database version 4,
	// an `assets` store next to the other three, and session state rows like this one.
	async function saveAsTldraw55(name: string) {
		// tldraw lists its databases in localStorage too, under the same key.
		localStorage.setItem('TLDRAW_DB_NAME_INDEX_v2', JSON.stringify([name]))
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.open(name, 4)
			request.onupgradeneeded = () => {
				for (const store of ['records', 'schema', 'session_state', 'assets']) {
					request.result.createObjectStore(store)
				}
			}
			request.onsuccess = () => {
				const db = request.result
				const tx = db.transaction(['records', 'schema', 'session_state', 'assets'], 'readwrite')
				tx.objectStore('records').put({ id: 'page:page', typeName: 'page', name: 'Page 1' }, 'page:page')
				tx.objectStore('schema').put(schema.serialize(), 'schema')
				tx.objectStore('session_state').put(
					{
						id: 'TLDRAW_INSTANCE_STATE_V1_session',
						updatedAt: 1,
						snapshot: {
							version: 0,
							currentPageId: 'page:page',
							exportBackground: true,
							isFocusMode: false,
							isDebugMode: false,
							isToolLocked: false,
							isGridMode: false,
							pageStates: [],
						},
					},
					'TLDRAW_INSTANCE_STATE_V1_session'
				)
				tx.objectStore('assets').put(new Blob(['file']), 'asset:file')
				tx.oncomplete = () => {
					db.close()
					resolve()
				}
				tx.onerror = () => reject(tx.error)
			}
			request.onerror = () => reject(request.error)
		})
	}

	it('opens, with its records and session state, and keeps its assets store', async () => {
		await saveAsTldraw55('TLDRAW_DOCUMENT_v2lifeboard-board')

		const data = await loadDataFromStore({ persistenceKey: 'lifeboard-board' })
		expect(data?.records).toEqual([{ id: 'page:page', typeName: 'page', name: 'Page 1' }])
		expect(data?.sessionStateSnapshot?.currentPageId).toBe('page:page')

		const stores = await new Promise<string[]>((resolve) => {
			const request = indexedDB.open('TLDRAW_DOCUMENT_v2lifeboard-board')
			request.onsuccess = () => {
				resolve([...request.result.objectStoreNames])
				request.result.close()
			}
		})
		expect(stores).toContain('assets')
	})
})
