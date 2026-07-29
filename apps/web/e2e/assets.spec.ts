import { expect, test } from '@playwright/test'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo, waitForPersistedShapes } from './helpers'

/**
 * Milestone 3's acceptance criteria: "Paste a 10 MB photo → stored ≪1 MB, survives reload, re-paste
 * dedupes (one blob)."
 *
 * The image is generated in the page as a large PNG so the test carries no binary fixture, and so
 * the downscale path gets a genuinely oversized input (3000px wide, well past the 2048px cap).
 */
async function importGeneratedImage(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(async () => {
		const canvas = document.createElement('canvas')
		canvas.width = 3000
		canvas.height = 2000
		const ctx = canvas.getContext('2d')!
		// Noise, not flat colour: a solid fill would compress to almost nothing and the size
		// assertions below would prove nothing about downscaling.
		const img = ctx.createImageData(canvas.width, canvas.height)
		let seed = 12345
		for (let i = 0; i < img.data.length; i += 4) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff
			img.data[i] = seed & 0xff
			img.data[i + 1] = (seed >> 8) & 0xff
			img.data[i + 2] = (seed >> 16) & 0xff
			img.data[i + 3] = 255
		}
		ctx.putImageData(img, 0, 0)

		const blob = await new Promise<Blob>((resolve) =>
			canvas.toBlob((b) => resolve(b!), 'image/png')
		)
		const file = new File([blob], 'photo.png', { type: 'image/png' })
		const editor = (window as unknown as { editor: { putExternalContent(i: unknown): Promise<void> } })
			.editor
		await editor.putExternalContent({ type: 'files', files: [file], point: { x: 200, y: 200 } })
		return blob.size
	})
}

/** tldraw 5 renders image shapes as an <img> inside its generic HTML container. */
function imageShapes(page: import('@playwright/test').Page) {
	return page.locator('.tl-shape img')
}

/**
 * Reads our own content-addressed blob store directly.
 *
 * Note the existence check: `indexedDB.open('lifeboard')` on a database that does not exist yet
 * *creates* it, at version 1, with no object stores — after which idb-keyval's own `openDB(name, 1,
 * {upgrade})` sees the version it wanted already present, never runs its upgrade, and every
 * subsequent blob write fails silently. Reading must not be able to break what it is reading.
 */
async function readBlobStore(page: import('@playwright/test').Page) {
	return page.evaluate(async () => {
		const exists = ((await indexedDB.databases?.()) ?? []).some((d) => d.name === 'lifeboard')
		if (!exists) return { hashes: [] as string[], bytes: 0 }

		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open('lifeboard')
			req.onsuccess = () => resolve(req.result)
			req.onerror = () => resolve(null)
		})
		if (!db || !db.objectStoreNames.contains('blobs')) return { hashes: [] as string[], bytes: 0 }
		try {
			const store = db.transaction('blobs', 'readonly').objectStore('blobs')
			const [keys, values] = await Promise.all([
				new Promise<IDBValidKey[]>((r) => {
					const q = store.getAllKeys()
					q.onsuccess = () => r(q.result)
				}),
				new Promise<Blob[]>((r) => {
					const q = db.transaction('blobs', 'readonly').objectStore('blobs').getAll()
					q.onsuccess = () => r(q.result as Blob[])
				}),
			])
			return {
				hashes: keys.map(String),
				bytes: values.reduce((sum, b) => sum + (b?.size ?? 0), 0),
			}
		} finally {
			db.close()
		}
	})
}

test.describe('asset store', () => {
	test('downscales on import, content-addresses, dedupes, and survives reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Photos')
		await openBoard(page, 'Photos')

		const sourceBytes = await importGeneratedImage(page)
		await expect(imageShapes(page)).toHaveCount(1)

		// tldraw shows the shape immediately and runs the asset upload in the background, so the blob
		// lands slightly after the shape does.
		await expect.poll(async () => (await readBlobStore(page)).hashes.length).toBe(1)

		const first = await readBlobStore(page)
		expect(first.hashes).toHaveLength(1)
		// SHA-256 hex — the key *is* the content, which is what makes dedupe and idempotent import work.
		expect(first.hashes[0]).toMatch(/^[0-9a-f]{64}$/)

		// Asserted as a *ratio*, not an absolute size. The source here is random noise, which is
		// deliberately incompressible — a real photo shrinks far more. Even so, downscaling must cut
		// it by several times over: this is "the single biggest lever for snappiness and quota" (§4.4).
		expect(sourceBytes).toBeGreaterThan(10_000_000)
		expect(first.bytes).toBeLessThan(sourceBytes / 5)

		// The stored image really is capped at 2048px on its longest edge.
		const stored = await page.evaluate(async (hash) => {
			// Same hazard as readBlobStore: only open a database that already exists.
			const db = await new Promise<IDBDatabase>((resolve) => {
				const req = indexedDB.open('lifeboard')
				req.onsuccess = () => resolve(req.result)
			})
			const blob = await new Promise<Blob>((resolve) => {
				const q = db.transaction('blobs', 'readonly').objectStore('blobs').get(hash)
				q.onsuccess = () => resolve(q.result as Blob)
			})
			db.close()
			const bitmap = await createImageBitmap(blob)
			const size = { w: bitmap.width, h: bitmap.height, type: blob.type }
			bitmap.close()
			return size
		}, first.hashes[0]!)
		expect(Math.max(stored.w, stored.h)).toBe(2048)
		expect(stored.type).toBe('image/webp')

		// Importing the same bytes again must reuse the one blob, not store a second copy.
		await importGeneratedImage(page)
		await expect(imageShapes(page)).toHaveCount(2)
		// Give a second blob every chance to appear, so "dedupe" is a real observation and not just
		// an assertion made before the upload finished.
		await page.waitForTimeout(1000)
		const second = await readBlobStore(page)
		expect(second.hashes).toEqual(first.hashes)
		expect(second.bytes).toBe(first.bytes)

		// And it survives a reload: the shapes come back and still resolve to a rendered image.
		await waitForPersistedShapes(page, 2)
		await page.reload()
		await expect(imageShapes(page)).toHaveCount(2)
		await expect(imageShapes(page).first()).toBeVisible()
		expect((await readBlobStore(page)).hashes).toEqual(first.hashes)
	})

	test('deleting a board reclaims only the blobs nothing else references', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Two boards, same image → one shared blob.
		await createBoard(page, 'Keep')
		await openBoard(page, 'Keep')
		await importGeneratedImage(page)
		await waitForPersistedShapes(page, 1)
		await page.getByRole('button', { name: '← Boards' }).click()

		await createBoard(page, 'Discard')
		await openBoard(page, 'Discard')
		await importGeneratedImage(page)
		await waitForPersistedShapes(page, 1)
		await page.getByRole('button', { name: '← Boards' }).click()

		const shared = await readBlobStore(page)
		expect(shared.hashes).toHaveLength(1)

		// Deleting one board must NOT collect a blob the other board still uses — the exact bug that
		// a naive "delete assets with the shape" implementation would cause.
		const row = page.locator('.lb-list__board', { hasText: 'Discard' })
		await row.getByRole('button', { name: 'Delete', exact: true }).click()
		await row.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-list__board', { hasText: 'Discard' })).toHaveCount(0)

		await expect
			.poll(async () => (await readBlobStore(page)).hashes.length)
			.toBe(1)

		// Now delete the last referencing board: the blob becomes unreachable and is swept.
		const keepRow = page.locator('.lb-list__board', { hasText: 'Keep' })
		await keepRow.getByRole('button', { name: 'Delete', exact: true }).click()
		await keepRow.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-list__board', { hasText: 'Keep' })).toHaveCount(0)

		await expect
			.poll(async () => (await readBlobStore(page)).hashes.length)
			.toBe(0)
	})
})
