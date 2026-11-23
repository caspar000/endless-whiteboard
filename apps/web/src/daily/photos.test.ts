import { beforeEach, describe, expect, it, vi } from 'vitest'

const server = vi.hoisted(() => ({
	available: true,
	has: new Set<string>(),
	asked: [] as string[][],
	failNextUpload: false,
}))

vi.mock('../server/serverVault', () => ({
	isServerAvailable: () => server.available,
	missingServerAssets: async (hashes: string[]) => {
		server.asked.push(hashes)
		return hashes.filter((h) => !server.has.has(h))
	},
	uploadServerAsset: async (hash: string) => {
		if (server.failNextUpload) {
			server.failNextUpload = false
			throw new Error('offline')
		}
		server.has.add(hash)
		return true
	},
	fetchServerAsset: async () => null,
	pushVaultSetting: async () => false,
}))

vi.mock('../persistence/downscale', () => ({
	downscaleImage: async (file: Blob) => ({ blob: file, width: 1, height: 1, changed: false }),
}))

const { forgetSentPhotos, isPhotoType, sendPhotos, storePhoto } = await import('./photos')

function memoryBlobs() {
	const files = new Map<string, Blob>()
	return {
		files,
		get: async (hash: string) => files.get(hash),
		put: async (hash: string, blob: Blob) => void files.set(hash, blob),
		has: async (hash: string) => files.has(hash),
		delete: async (hash: string) => void files.delete(hash),
		list: async () => [...files.keys()],
		size: async () => 0,
	}
}

const hash = (n: number) => n.toString(16).padStart(64, '0')

beforeEach(() => {
	forgetSentPhotos()
	server.available = true
	server.has.clear()
	server.asked = []
	server.failNextUpload = false
})

describe('what the food log keeps', () => {
	it('takes photos and refuses an SVG, which can run script', async () => {
		expect(isPhotoType('image/jpeg')).toBe(true)
		expect(isPhotoType('image/HEIC')).toBe(true)
		expect(isPhotoType('image/svg+xml')).toBe(false)
		expect(isPhotoType('text/html')).toBe(false)
		expect(isPhotoType('')).toBe(false)
		const blobs = memoryBlobs()
		const hostile = new Blob(['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"><script>fetch("/api/me")</script></svg>'], { type: 'image/svg+xml' })
		expect(await storePhoto(blobs, hostile)).toBeNull()
		expect(blobs.files.size).toBe(0)
	})
})

describe('sending photos to the server', () => {
	it('sends what the server lacks, from every day asked about', async () => {
		const blobs = memoryBlobs()
		const monday = hash(1)
		const tuesday = hash(2)
		await blobs.put(monday, new Blob(['monday']))
		await blobs.put(tuesday, new Blob(['tuesday']))
		server.has.add(tuesday)
		await sendPhotos(blobs, [monday, tuesday])
		expect(server.has.has(monday)).toBe(true)
		// Known to be there now: not asked about again.
		await sendPhotos(blobs, [monday, tuesday])
		expect(server.asked).toHaveLength(1)
	})

	it('keeps a photo taken offline, and sends it the next time the server answers', async () => {
		const blobs = memoryBlobs()
		await blobs.put(hash(3), new Blob(['offline']))
		server.available = false
		await sendPhotos(blobs, [hash(3)])
		expect(server.asked).toHaveLength(0)
		server.available = true
		server.failNextUpload = true
		await sendPhotos(blobs, [hash(3)])
		expect(server.has.has(hash(3))).toBe(false)
		await sendPhotos(blobs, [hash(3)])
		expect(server.has.has(hash(3))).toBe(true)
	})

	it('leaves a photo this device doesn’t have to the device that does, and asks in batches', async () => {
		const blobs = memoryBlobs()
		await sendPhotos(blobs, [hash(4)])
		expect(server.has.has(hash(4))).toBe(false)
		await sendPhotos(
			blobs,
			Array.from({ length: 2500 }, (_, i) => hash(1000 + i))
		)
		expect(server.asked.slice(1).map((batch) => batch.length)).toEqual([1000, 1000, 500])
	})
})
