import { expect, test } from '@playwright/test'
import {
	backToList,
	createBoard,
	gotoFresh,
	openBoard,
	skipFirstRunDemo,
	waitForPersistedShapes,
} from './helpers'

/**
 * Milestone 3's acceptance criteria: "Paste a 10 MB photo → stored ≪1 MB, survives reload, re-paste
 * dedupes (one blob)."
 *
 * The image is generated in the page as a large PNG so the test carries no binary fixture, and so
 * the downscale path gets a genuinely oversized input (3000px wide, well past the 2048px cap).
 */
async function importGeneratedImage(
	page: import('@playwright/test').Page,
	/**
	 * Leaves the board from *inside* the page, in the same task the import resolved in.
	 *
	 * The point is to make a race deterministic rather than hope for it. Driving the click from Node
	 * costs a round trip, and the upload usually finishes during it — so a test that imports and then
	 * clicks would pass whether or not the app handles an interrupted upload. Clicking here leaves the
	 * upload no window at all to complete in.
	 */
	opts: { leaveBoardImmediately?: boolean } = {}
): Promise<number> {
	return page.evaluate(async ({ leaveBoardImmediately }) => {
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

		if (leaveBoardImmediately) {
			// The pinned "All boards" tab is the first tab in the strip.
			const home = document.querySelector<HTMLElement>('.lb-tabs__tab')
			if (!home) throw new Error('Could not find the home tab to leave the board')
			home.click()
		}
		return blob.size
	}, opts)
}

/** tldraw 5 renders image shapes as an <img> inside its generic HTML container. */
function imageShapes(page: import('@playwright/test').Page) {
	return page.locator('.lb-board-host:not([data-hidden]) .tl-shape img')
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

/**
 * The `src` of every `asset` record a board has actually persisted.
 *
 * Read from tldraw's own database rather than from the live editor, because that is what asset GC,
 * backup export and the next board open all read. An empty string here is the failure mode worth
 * catching: a record whose upload never landed.
 */
async function readPersistedAssetSrcs(
	page: import('@playwright/test').Page,
	boardId: string
): Promise<string[]> {
	return page.evaluate(async (id) => {
		const dbName = `TLDRAW_DOCUMENT_v2lifeboard-${id}`
		const exists = ((await indexedDB.databases?.()) ?? []).some((d) => d.name === dbName)
		if (!exists) return ['<no database>']

		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open(dbName)
			req.onsuccess = () => resolve(req.result)
		})
		try {
			if (!db.objectStoreNames.contains('records')) return ['<no records store>']
			const records = await new Promise<{ typeName?: string; props?: { src?: string } }[]>((r) => {
				const q = db.transaction('records', 'readonly').objectStore('records').getAll()
				q.onsuccess = () => r(q.result)
			})
			return records.filter((rec) => rec.typeName === 'asset').map((rec) => rec.props?.src ?? '')
		} finally {
			db.close()
		}
	}, boardId)
}

/** The id of the board currently open, taken from the route. */
async function currentBoardId(page: import('@playwright/test').Page): Promise<string> {
	const id = await page.evaluate(() => /#\/board\/([^?]+)/.exec(location.hash)?.[1])
	if (!id) throw new Error('No board is open')
	return decodeURIComponent(id)
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
		await expect
			.poll(async () => (await readBlobStore(page)).hashes.length)
			.toBe(1)

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

	test('an image survives leaving the board mid-upload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Quick exit')
		await openBoard(page, 'Quick exit')
		const boardId = await currentBoardId(page)

		// `putExternalContent` resolves *before* the upload finishes: tldraw creates the asset record
		// with `src: ''` and fills it in from a promise it never awaits. Leaving in that window used to
		// strand the image — the record kept its empty src, the shape rendered blank forever, and the
		// uploaded bytes sat orphaned in the blob store.
		//
		// The click is issued from inside the page so no Playwright round trip gives the upload a head
		// start. It is still a race, though, and on a fast machine the upload can simply win it — what
		// makes the *mechanism* deterministic is `assetStore.test.ts`, which drives a blocked upload
		// directly. This test's job is to prove the whole path works when a real user does it.
		await importGeneratedImage(page, { leaveBoardImmediately: true })
		await expect(page.locator('.lb-sidebar__nav')).toBeVisible()

		// The persisted record is the thing that matters: it is what GC, backup and the next open read.
		await expect
			.poll(async () => readPersistedAssetSrcs(page, boardId), {
				timeout: 20_000,
			})
			.toEqual([expect.stringMatching(/^asset:[0-9a-f]{64}$/)])

		// And the image really renders on reopen — a stranded record produces an <img> too, just one
		// that never loads.
		await openBoard(page, 'Quick exit')
		await expect(imageShapes(page)).toHaveCount(1)
		await expect
			.poll(async () =>
				imageShapes(page)
					.first()
					.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)
			)
			.toBe(true)
	})

	test('deleting a board reclaims only the blobs nothing else references', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Two boards, same image → one shared blob.
		await createBoard(page, 'Keep')
		await openBoard(page, 'Keep')
		await importGeneratedImage(page)
		await waitForPersistedShapes(page, 1)
		await page.getByRole('tab', { name: 'All boards' }).click()

		await createBoard(page, 'Discard')
		await openBoard(page, 'Discard')
		await importGeneratedImage(page)
		await waitForPersistedShapes(page, 1)
		await page.getByRole('tab', { name: 'All boards' }).click()

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

	test('remove background cuts a flat backdrop out of an image', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// A logo-on-white, which is what this is for: a flat backdrop and a solid subject. The noise
		// image the other tests use has no background to find, by construction.
		await page.evaluate(async () => {
			const c = document.createElement('canvas')
			c.width = 400
			c.height = 300
			const x = c.getContext('2d')!
			x.fillStyle = '#ffffff'
			x.fillRect(0, 0, 400, 300)
			x.fillStyle = '#d92b2b'
			x.beginPath()
			x.arc(200, 140, 90, 0, Math.PI * 2)
			x.fill()
			const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
			const file = new File([blob], 'logo.png', { type: 'image/png' })
			await (
				window as unknown as {
					editor: { putExternalContent(o: unknown): Promise<void> }
				}
			).editor.putExternalContent({ type: 'files', files: [file], point: { x: 300, y: 300 } })
		})

		const imageInfo = () =>
			page.evaluate(() => {
				const ed = (
					window as unknown as {
						editor: {
							getCurrentPageShapes(): { id: string; type: string; props: { assetId?: string } }[]
							getAsset(id: string): { props: { src?: string; mimeType?: string } } | undefined
						}
					}
				).editor
				const shape = ed.getCurrentPageShapes().find((s) => s.type === 'image')
				if (!shape?.props.assetId) return null
				const asset = ed.getAsset(shape.props.assetId)
				return {
					id: shape.id,
					assetId: shape.props.assetId,
					src: asset?.props.src ?? null,
					mimeType: asset?.props.mimeType ?? null,
				}
			})

		await expect.poll(imageInfo).not.toBeNull()
		const before = (await imageInfo())!

		await page.evaluate((id) => {
			;(window as unknown as { editor: { select(id: string): unknown } }).editor.select(id)
		}, before.id)

		await page.locator('[data-testid="lb.remove-background"]').click()

		// A *new* asset, so a second copy of the same image on the board is untouched and undo has
		// something to point back at.
		await expect.poll(async () => (await imageInfo())?.assetId).not.toBe(before.assetId)
		const after = (await imageInfo())!
		expect(after.mimeType).toBe('image/webp')

		// The bytes are what matter: corners transparent, the disc still opaque.
		const pixels = await page.evaluate(async (src: string) => {
			const hash = src.slice('asset:'.length)
			const db = await new Promise<IDBDatabase>((r) => {
				const q = indexedDB.open('lifeboard')
				q.onsuccess = () => r(q.result)
			})
			const blob = await new Promise<Blob | undefined>((r) => {
				const q = db.transaction('blobs', 'readonly').objectStore('blobs').get(hash)
				q.onsuccess = () => r(q.result)
			})
			db.close()
			if (!blob) return null
			const bmp = await createImageBitmap(blob)
			const canvas = new OffscreenCanvas(bmp.width, bmp.height)
			const ctx = canvas.getContext('2d')!
			ctx.drawImage(bmp, 0, 0)
			const at = (X: number, Y: number) => [...ctx.getImageData(X, Y, 1, 1).data]
			return { corner: at(2, 2), centre: at(bmp.width >> 1, bmp.height >> 1) }
		}, after.src!)

		expect(pixels?.corner[3]).toBe(0)
		expect(pixels?.centre[3]).toBe(255)

		// One undo entry: creating the asset and repointing the shape happen in a single run.
		await page.keyboard.press('ControlOrMeta+z')
		await expect.poll(async () => (await imageInfo())?.assetId).toBe(before.assetId)
	})

	test('removing the background trims the image to the subject, in place', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// The disc is deliberately off-centre, so an offset applied in the wrong direction shows up as
		// drift rather than cancelling out.
		await page.evaluate(async () => {
			const c = document.createElement('canvas')
			c.width = 400
			c.height = 300
			const x = c.getContext('2d')!
			x.fillStyle = '#ffffff'
			x.fillRect(0, 0, 400, 300)
			x.fillStyle = '#d92b2b'
			x.beginPath()
			x.arc(120, 90, 60, 0, Math.PI * 2)
			x.fill()
			const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
			await (
				window as unknown as { editor: { putExternalContent(o: unknown): Promise<void> } }
			).editor.putExternalContent({
				type: 'files',
				files: [new File([blob], 'disc.png', { type: 'image/png' })],
				point: { x: 500, y: 400 },
			})
		})

		type Geometry = { id: string; x: number; y: number; w: number; h: number }
		const geometry = () =>
			page.evaluate((): Geometry | null => {
				const ed = (
					window as unknown as {
						editor: {
							getCurrentPageShapes(): {
								id: string
								type: string
								x: number
								y: number
								props: { w: number; h: number }
							}[]
						}
					}
				).editor
				const s = ed.getCurrentPageShapes().find((v) => v.type === 'image')
				return s ? { id: s.id, x: s.x, y: s.y, w: s.props.w, h: s.props.h } : null
			})

		await expect.poll(geometry).not.toBeNull()
		const before = (await geometry())!
		// The disc's centre in page space: (120, 90) of a 400×300 image.
		const discBefore = {
			x: before.x + (120 / 400) * before.w,
			y: before.y + (90 / 300) * before.h,
		}

		await page.evaluate((id) => {
			;(window as unknown as { editor: { select(id: string): unknown } }).editor.select(id)
		}, before.id)
		await page.locator('[data-testid="lb.remove-background"]').click()

		// Trimmed to the disc, which is 120px across in a 400×300 image.
		await expect.poll(async () => Math.round((await geometry())!.w)).toBeLessThan(150)
		const after = (await geometry())!
		expect(after.h).toBeLessThan(150)

		// And the shape moved by exactly what was trimmed, so the disc has not budged. Without the
		// compensating offset it would jump up and left by the size of the removed margin.
		const discAfter = { x: after.x + after.w / 2, y: after.y + after.h / 2 }
		expect(Math.abs(discAfter.x - discBefore.x)).toBeLessThan(2)
		expect(Math.abs(discAfter.y - discBefore.y)).toBeLessThan(2)
	})

	test('a cropped image keeps its rounded corners', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Cropped')
		await openBoard(page, 'Cropped')
		await importGeneratedImage(page)
		await expect(imageShapes(page)).toHaveCount(1)

		// Crop away the outer quarter on every side, the way the crop tool does.
		await page.evaluate(() => {
			const editor = (
				window as unknown as {
					editor: {
						getCurrentPageShapes(): { id: string; type: string; props: { w: number; h: number } }[]
						updateShape(shape: unknown): void
					}
				}
			).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'image')!
			const props = shape.props
			editor.updateShape({
				id: shape.id,
				type: 'image',
				props: {
					...props,
					w: props.w / 2,
					h: props.h / 2,
					crop: { topLeft: { x: 0.25, y: 0.25 }, bottomRight: { x: 0.75, y: 0.75 } },
				},
			})
		})

		const measured = await page.evaluate(() => {
			const host = document.querySelector('.lb-board-host:not([data-hidden])')!
			const rounded = host.querySelector<HTMLElement>(
				'.tl-shape[data-shape-type="image"] > .tl-html-container'
			)!
			const inner = rounded.querySelector<HTMLElement>('.tl-image-container')!
			const style = getComputedStyle(rounded)
			return {
				radius: parseFloat(style.borderRadius),
				overflow: style.overflow,
				roundedWidth: rounded.getBoundingClientRect().width,
				innerWidth: inner.getBoundingClientRect().width,
			}
		})

		// The radius has to clip, not merely round — the image inside is a plain rectangle.
		expect(measured.radius).toBeGreaterThan(0)
		expect(measured.overflow).toBe('hidden')

		// The point of the test. Cropping sizes `.tl-image-container` to the *uncropped* image and
		// slides it under the shape with a transform, so a radius applied there rounds corners that
		// sit outside the visible window and the crop looks square. The rounded element must be the
		// one you can actually see.
		expect(measured.innerWidth).toBeGreaterThan(measured.roundedWidth * 1.5)
	})
})
