import { expect, test, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { insertGallery } from './fixtures/gallery'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Exports while the GPU layer draws (docs/gpu-renderer-plan.md, phase 7): the shapes it draws have
 * their elements hidden, but still laid out, and an export copies those elements. So the board's
 * picture (what thumbnails, image export and the agent's look at the board are made from) has to come
 * out the same, pixel for pixel, whichever renderer is drawing.
 */

type Renderer = { set(m: string): void; scene(e: unknown): { isDrawn(id: string): boolean } }

/** The whole board as a PNG, through the editor's own export. */
const exportBoard = (page: Page) =>
	page.evaluate(async () => {
		type E = { getCurrentPageShapeIds(): Set<string>; toImage(ids: string[], o: unknown): Promise<{ blob: Blob }> }
		const e = (window as unknown as { editor: E }).editor
		const { blob } = await e.toImage([...e.getCurrentPageShapeIds()], { format: 'png', pixelRatio: 1, background: true })
		const bytes = new Uint8Array(await blob.arrayBuffer())
		let s = ''
		for (const b of bytes) s += String.fromCharCode(b)
		return btoa(s)
	})

/** How many of the board's shapes the GPU is drawing now. */
const drawn = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as { lifeboardRenderer: Renderer; editor: { getCurrentPageShapeIds(): Set<string> } }
		const scene = w.lifeboardRenderer.scene(w.editor)
		return [...w.editor.getCurrentPageShapeIds()].filter((id) => scene.isDrawn(id)).length
	})

test('the board exports the same whether the page or the GPU draws it', async ({ page }) => {
	test.setTimeout(240_000)
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Export')
	await openBoard(page, 'Export')
	await insertGallery(page)
	await page.evaluate(() => {
		;(window as unknown as { editor: { zoomToFit(o: unknown): void } }).editor.zoomToFit({ animation: { duration: 0 } })
	})
	const setRenderer = (m: string) => page.evaluate((m) => (window as unknown as { lifeboardRenderer: Renderer }).lifeboardRenderer.set(m), m)

	await setRenderer('dom')
	await expect.poll(() => drawn(page)).toBe(0)
	const byPage = PNG.sync.read(Buffer.from(await exportBoard(page), 'base64'))

	await setRenderer('gpu')
	// Most of the gallery is the GPU's once its elements are read.
	await expect.poll(() => drawn(page), { timeout: 30_000 }).toBeGreaterThan(100)
	const byGpu = PNG.sync.read(Buffer.from(await exportBoard(page), 'base64'))

	expect([byGpu.width, byGpu.height]).toEqual([byPage.width, byPage.height])
	const differing = pixelmatch(byPage.data, byGpu.data, null, byPage.width, byPage.height, { threshold: 0 })
	expect(differing).toBe(0)
})
