import { expect, test, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * What the GPU layer reads of each shape, kept between sessions (docs/gpu-renderer-plan.md, phase 10):
 * a board read once is drawn from what was kept when it's opened again, without reading its shapes
 * from the page, and looks the same.
 */

const CHROME = ['.lb-debug-badge', '.tlui-layout', '.lb-tabs', '.lb-sidebar', '.lb-sidebar-reopen', '.lb-agent-fab', '.lb-dice-tray']

type W = {
	editor: { createShapes(s: unknown[]): void; selectNone(): void; zoomToFit(o: unknown): void; getCurrentPageShapeIds(): Set<string> }
	lifeboardRenderer: { set(m: string, remember?: boolean): void; scene(e: unknown): { isDrawn(id: string): boolean }; snapshots(e: unknown): { readCount: number } }
}

const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })

const drawn = (page: Page) =>
	page.evaluate(() => {
		const w = window as unknown as W
		const scene = w.lifeboardRenderer.scene(w.editor)
		return [...w.editor.getCurrentPageShapeIds()].filter((id) => scene.isDrawn(id)).length
	})

const reads = (page: Page) => page.evaluate(() => (window as unknown as W).lifeboardRenderer.snapshots((window as unknown as W).editor).readCount)

const shoot = async (page: Page) => {
	await page.addStyleTag({ content: CHROME.map((c) => `${c} { visibility: hidden !important }`).join('\n') })
	return PNG.sync.read(await page.screenshot({ animations: 'disabled' }))
}

test('a board read once is drawn from what was kept when it opens again, as reading it would', async ({ page }) => {
	test.setTimeout(180_000)
	if (process.env.CACHE_OFF) await page.addInitScript(() => localStorage.setItem('lifeboard:gpu-cache', 'off'))
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Kept')
	await openBoard(page, 'Kept')
	const n = 60
	await page.evaluate(
		({ n, labels }) => {
			const w = window as unknown as W
			const shapes = []
			for (let i = 0; i < n; i++) {
				const at = { x: (i % 10) * 260, y: Math.floor(i / 10) * 200 }
				if (i % 3 === 0) shapes.push({ id: `shape:kept-${i}`, type: 'geo', ...at, props: { w: 200, h: 120, geo: i % 2 ? 'ellipse' : 'rectangle', richText: labels[i] } })
				else if (i % 3 === 1) shapes.push({ id: `shape:kept-${i}`, type: 'note', ...at, props: { richText: labels[i] } })
				else shapes.push({ id: `shape:kept-${i}`, type: 'text', ...at, props: { richText: labels[i] } })
			}
			w.editor.createShapes(shapes)
			w.editor.selectNone()
			w.lifeboardRenderer.set('gpu', true)
			w.editor.zoomToFit({ animation: { duration: 0 } })
		},
		{ n, labels: Array.from({ length: n }, (_, i) => rich(`kept ${i}`)) }
	)
	await expect.poll(() => drawn(page), { timeout: 60_000 }).toBe(n)
	expect(await reads(page)).toBeGreaterThanOrEqual(n)
	// Kept a moment after it's read, in a batch.
	await page.waitForTimeout(3000)

	await page.reload()
	// The board comes back open, as it was left; from the list if not.
	const opened = () => page.evaluate((n) => (window as unknown as { editor?: W['editor'] }).editor?.getCurrentPageShapeIds().size === n, n)
	await expect.poll(async () => (await opened()) || (await page.locator('.lb-home__header').isVisible())).toBe(true)
	if (!(await opened())) await openBoard(page, 'Kept')
	await expect.poll(() => drawn(page), { timeout: 60_000 }).toBe(n)
	// Drawn without reading them from the page again.
	if (!process.env.CACHE_OFF) expect(await reads(page)).toBe(0)
	// And as reading them again would: the same pixels, in the same session (a reload alone moves a few
	// pixels of a note's crease, so two sessions can't be compared).
	await page.waitForTimeout(500)
	const kept = await shoot(page)
	const readBefore = await reads(page)
	await page.evaluate(() => (window as unknown as { editor: unknown; lifeboardRenderer: { snapshots(e: unknown): { readAgain(): void } } }).lifeboardRenderer.snapshots((window as unknown as W).editor).readAgain())
	await expect.poll(async () => (await reads(page)) - readBefore, { timeout: 60_000 }).toBeGreaterThanOrEqual(n)
	await expect.poll(() => drawn(page), { timeout: 60_000 }).toBe(n)
	await page.waitForTimeout(800)
	const read = await shoot(page)
	const diff = new PNG({ width: kept.width, height: kept.height })
	const differing = pixelmatch(read.data, kept.data, diff.data, kept.width, kept.height, { threshold: 0 })
	if (process.env.CACHE_DUMP) {
		const { writeFileSync } = await import('node:fs')
		writeFileSync('/tmp/cache-kept.png', PNG.sync.write(kept))
		writeFileSync('/tmp/cache-read.png', PNG.sync.write(read))
		writeFileSync('/tmp/cache-diff.png', PNG.sync.write(diff))
	}
	expect(differing).toBe(0)
})
