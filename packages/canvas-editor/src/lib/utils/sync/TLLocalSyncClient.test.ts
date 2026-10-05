import type { IndexKey } from '@tldraw/utils'
import { vi } from 'vitest'
import { PageRecordType } from '@tldraw/tlschema'
import { promiseWithResolve } from '@tldraw/utils'
import { createTLStore } from '../../config/createTLStore'
import { TLLocalSyncClient } from './TLLocalSyncClient'
import * as idb from './indexedDb'

vi.mock('./indexedDb', async () => ({
	...(await vi.importActual<object>('./indexedDb')),
	storeSnapshotInIndexedDb: vi.fn(() => Promise.resolve()),
	storeChangesInIndexedDb: vi.fn(() => Promise.resolve()),
}))

class BroadcastChannelMock {
	onmessage?: (e: MessageEvent) => void
	constructor(_name: string) {
		// noop
	}
	postMessage = jest.fn((_msg: any) => {
		// noop
	})
	close = jest.fn(() => {
		// noop
	})
}

function testClient(channel = new BroadcastChannelMock('test')) {
	const store = createTLStore({ shapeUtils: [] })
	const onLoad = jest.fn(() => {
		return
	})
	const onLoadError = jest.fn(() => {
		return
	})
	const client = new TLLocalSyncClient(
		store,
		{
			onLoad,
			onLoadError,
			persistenceKey: 'test',
		},
		channel
	)
	return { client, store, onLoad, onLoadError, channel }
}

const reloadMock = jest.fn()

beforeAll(() => {
	Object.defineProperty(window, 'location', {
		configurable: true,
		value: { reload: reloadMock },
	})
})

beforeEach(() => {
	jest.clearAllMocks()
})

jest.useFakeTimers()

const tick = async () => {
	jest.advanceTimersByTime(1000)
	await Promise.resolve()
}

test('the client connects on instantiation, announcing its schema', async () => {
	const { channel } = testClient()
	await tick()
	expect(channel.postMessage).toHaveBeenCalledTimes(1)
	const [msg] = channel.postMessage.mock.calls[0]

	// Today's schemas are a version per migration sequence (2023's had `recordVersions`).
	expect(msg).toMatchObject({ type: 'announce', schema: { schemaVersion: 2, sequences: expect.any(Object) } })
})

test('when a client receives an announce with a newer schema version it reloads itself', async () => {
	const { client, channel, onLoadError } = testClient()
	await tick()
	jest.advanceTimersByTime(10000)
	expect(reloadMock).not.toHaveBeenCalled()
	channel.onmessage?.({
		data: {
			type: 'announce',
			// Newer: a migration sequence this client has never heard of.
			schema: {
				...client.serializedSchema,
				sequences: { ...(client.serializedSchema as { sequences: object }).sequences, 'com.example.newer': 1 },
			},
		},
	} as any)
	expect(reloadMock).toHaveBeenCalled()
	expect(onLoadError).not.toHaveBeenCalled()
})

test('when a client receives an announce with a newer schema version shortly after loading it does not reload but instead reports a loadError', async () => {
	const { client, channel, onLoadError } = testClient()
	await tick()
	jest.advanceTimersByTime(1000)
	expect(reloadMock).not.toHaveBeenCalled()
	channel.onmessage?.({
		data: {
			type: 'announce',
			// Newer: a migration sequence this client has never heard of.
			schema: {
				...client.serializedSchema,
				sequences: { ...(client.serializedSchema as { sequences: object }).sequences, 'com.example.newer': 1 },
			},
		},
	} as any)
	expect(reloadMock).not.toHaveBeenCalled()
	expect(onLoadError).toHaveBeenCalled()
})

test('the first db write after a client connects is a full db overwrite, made as soon as it loads', async () => {
	const { client } = testClient()
	await tick()
	expect(idb.storeSnapshotInIndexedDb).toHaveBeenCalledTimes(1)
	expect(idb.storeChangesInIndexedDb).not.toHaveBeenCalled()

	client.store.put([PageRecordType.create({ name: 'test', index: 'a0' as IndexKey })])
	await tick()
	expect(idb.storeSnapshotInIndexedDb).toHaveBeenCalledTimes(1)
	expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(1)
})

test('it clears the diff queue after every write', async () => {
	const { client } = testClient()
	await tick()
	client.store.put([PageRecordType.create({ name: 'test', index: 'a0' as IndexKey })])
	await tick()
	// @ts-expect-error
	expect(client.diffQueue.length).toBe(0)

	client.store.put([PageRecordType.create({ name: 'test2', index: 'a1' as IndexKey })])
	await tick()
	// @ts-expect-error
	expect(client.diffQueue.length).toBe(0)
})

test('writes that come in during a persist operation will get persisted afterward', async () => {
	const idbOperationResult = promiseWithResolve<void>()
	;(idb.storeSnapshotInIndexedDb as jest.Mock).mockImplementationOnce(() => idbOperationResult)

	const { client } = testClient()
	await tick()
	client.store.put([PageRecordType.create({ name: 'test', index: 'a0' as IndexKey })])
	await tick()

	// we should have called into idb but not resolved the promise yet
	expect(idb.storeSnapshotInIndexedDb).toHaveBeenCalledTimes(1)
	expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(0)

	// if another change comes in, loads of time can pass, but nothing else should get called
	client.store.put([PageRecordType.create({ name: 'test', index: 'a2' as IndexKey })])
	await tick()
	expect(idb.storeSnapshotInIndexedDb).toHaveBeenCalledTimes(1)
	expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(0)

	// if we resolve the idb operation, the next change should get persisted
	idbOperationResult.resolve()
	await tick()
	await tick()
	expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(1)
})

describe('pending writes are not lost', () => {
	async function clientWithPendingChange() {
		const { client } = testClient()
		await tick()
		client.store.put([PageRecordType.create({ name: 'test', index: 'a0' as IndexKey })])
		await tick()
		jest.clearAllMocks()
		client.store.put([PageRecordType.create({ name: 'test2', index: 'a1' as IndexKey })])
		expect(idb.storeChangesInIndexedDb).not.toHaveBeenCalled()
		return client
	}

	test('closing writes them at once, and the write is not cancelled', async () => {
		const client = await clientWithPendingChange()
		client.close()
		expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(1)
		const [{ didCancel }] = (idb.storeChangesInIndexedDb as jest.Mock).mock.calls[0]
		expect(didCancel()).toBe(false)
	})

	test('the page being left writes them at once', async () => {
		const client = await clientWithPendingChange()
		window.dispatchEvent(new Event('pagehide'))
		expect(idb.storeChangesInIndexedDb).toHaveBeenCalledTimes(1)
		client.close()
	})
})
