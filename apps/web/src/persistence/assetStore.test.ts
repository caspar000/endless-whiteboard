import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BlobStore } from '../platform/PlatformAdapter'
import {
	assetSrcForHash,
	createLifeboardAssetStore,
	hasPendingAssetUploads,
	waitForAssetUploads,
} from './assetStore'
import type { TLAsset } from 'tldraw'

// `upload` downscales before hashing, which needs canvas/bitmap APIs this environment doesn't have.
// Stubbed to pass the bytes through, because what's under test is the in-flight *bookkeeping*, not
// the resize — `downscale.test.ts` covers that.
vi.mock('./downscale', () => ({
	downscaleImage: async (file: File) => ({ blob: file }),
}))

/** A blob store whose writes hang until released, so an upload can be held mid-flight on purpose. */
function blockingBlobStore() {
	let release!: () => void
	const blocked = new Promise<void>((resolve) => {
		release = resolve
	})
	const put = vi.fn(async () => {
		await blocked
	})
	return {
		release,
		put,
		store: {
			put,
			get: async () => null,
			delete: async () => {},
			list: async () => [],
			totalBytes: async () => 0,
		} as unknown as BlobStore,
	}
}

const file = () => new File([new Uint8Array([1, 2, 3])], 'photo.png', { type: 'image/png' })
const asset = {} as TLAsset

describe('asset upload tracking', () => {
	beforeEach(async () => {
		// Uploads are tracked module-wide (they outlive the board that started them), so make sure no
		// previous test left one in flight.
		await waitForAssetUploads(0)
		expect(hasPendingAssetUploads()).toBe(false)
	})

	it('reports an upload as pending until it finishes', async () => {
		const blob = blockingBlobStore()
		const store = createLifeboardAssetStore(blob.store)

		const upload = store.upload!(asset, file())
		expect(hasPendingAssetUploads()).toBe(true)

		blob.release()
		await upload
		expect(hasPendingAssetUploads()).toBe(false)
	})

	it('resolves waiters only once the last upload finishes', async () => {
		const first = blockingBlobStore()
		const second = blockingBlobStore()
		const storeA = createLifeboardAssetStore(first.store)
		const storeB = createLifeboardAssetStore(second.store)

		const uploads = [storeA.upload!(asset, file()), storeB.upload!(asset, file())]
		let settled = false
		void waitForAssetUploads(5_000).then(() => {
			settled = true
		})

		first.release()
		await uploads[0]
		await Promise.resolve()
		expect(settled).toBe(false)

		second.release()
		await Promise.all(uploads)
		// One turn for the waiter's own `.then` to run.
		await Promise.resolve()
		expect(settled).toBe(true)
	})

	it('resolves immediately when nothing is in flight', async () => {
		// Not merely fast — synchronous enough that a caller never waits a tick for the common case.
		await expect(waitForAssetUploads(60_000)).resolves.toBeUndefined()
	})

	it('gives up after the timeout so a wedged upload cannot block a caller forever', async () => {
		vi.useFakeTimers()
		try {
			const blob = blockingBlobStore()
			const store = createLifeboardAssetStore(blob.store)
			const upload = store.upload!(asset, file())

			let settled = false
			void waitForAssetUploads(1_000).then(() => {
				settled = true
			})

			await vi.advanceTimersByTimeAsync(999)
			expect(settled).toBe(false)
			await vi.advanceTimersByTimeAsync(2)
			expect(settled).toBe(true)

			// Still genuinely pending — the timeout is a bound on *waiting*, not a claim of completion.
			expect(hasPendingAssetUploads()).toBe(true)
			blob.release()
			await upload
		} finally {
			vi.useRealTimers()
		}
	})

	it('stops tracking an upload that throws, rather than leaking a pending count forever', async () => {
		const store = createLifeboardAssetStore({
			put: async () => {
				throw new Error('quota exceeded')
			},
		} as unknown as BlobStore)

		await expect(store.upload!(asset, file())).rejects.toThrow('quota exceeded')
		expect(hasPendingAssetUploads()).toBe(false)
	})

	it('returns the content-addressed src for the stored bytes', async () => {
		const puts: [string, Blob][] = []
		const store = createLifeboardAssetStore({
			put: async (hash: string, blob: Blob) => {
				puts.push([hash, blob])
			},
		} as unknown as BlobStore)

		const result = await store.upload!(asset, file())
		expect(puts).toHaveLength(1)
		const hash = puts[0]![0]
		expect(hash).toMatch(/^[0-9a-f]{64}$/)
		expect(result.src).toBe(assetSrcForHash(hash))
	})
})
