import { expect, test, type Page } from '@playwright/test'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Shapes leaving the page on a big board (docs/gpu-renderer-plan.md, phase 8): unmounted, not just
 * hidden, while off screen or drawn by the GPU layer, and mounted again whenever something needs them.
 * A board counts as big here from 20 shapes (`lifeboard:leave-page-above`), so a small one shows it.
 */

type W = {
	editor: {
		createShapes(s: unknown[]): void
		getCurrentPageShapeIds(): Set<string>
		getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
		getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
		pageToScreen(p: { x: number; y: number }): { x: number; y: number }
		zoomToFit(o: unknown): void
		setCamera(c: unknown): void
		toImage(ids: string[], o: unknown): Promise<{ blob: Blob }>
	}
	lifeboardRenderer: { set(m: string): void }
}

const COLS = 10
const ROWS = 6

async function bigBoard(page: Page, label: (i: number) => string = (i) => `shape ${i}`) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await page.evaluate(() => localStorage.setItem('lifeboard:leave-page-above', '20'))
	await createBoard(page, 'Leave')
	await openBoard(page, 'Leave')
	const labels = Array.from({ length: COLS * ROWS }, (_, i) => label(i))
	await page.evaluate(
		({ COLS, labels }) => {
			const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
			const w = window as unknown as W
			w.editor.createShapes(
				labels.map((text, i) => ({
					id: `shape:leave-${i}`,
					type: 'geo',
					x: (i % COLS) * 300,
					y: Math.floor(i / COLS) * 260,
					props: { w: 180, h: 110, richText: rich(text) },
				}))
			)
		},
		{ COLS, labels }
	)
}

/** How many of the board's geo shapes have an element in the page. */
const mounted = (page: Page) =>
	page.evaluate(() => document.querySelectorAll('.lb-board-host:not([data-hidden]) .tl-shape[data-shape-type="geo"]:not(.tl-shape-background)').length)

const setRenderer = (page: Page, mode: string) => page.evaluate((m) => (window as unknown as W).lifeboardRenderer.set(m), mode)

const fit = (page: Page) => page.evaluate(() => (window as unknown as W).editor.zoomToFit({ animation: { duration: 0 } }))

test('shapes the GPU draws leave the page, and one comes back to be edited', async ({ page }) => {
	await bigBoard(page)
	await setRenderer(page, 'gpu')
	await fit(page)
	await expect.poll(() => mounted(page), { timeout: 30_000 }).toBe(0)

	const at = await page.evaluate(() => {
		const e = (window as unknown as W).editor
		const b = e.getShapePageBounds('shape:leave-0')!
		return e.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
	})
	await page.mouse.dblclick(at.x, at.y)
	// Being edited, it's the page's, so it's mounted.
	await expect(page.locator('.tl-shape[data-shape-id="shape:leave-0"]')).toHaveCount(1)
	await page.keyboard.press('ControlOrMeta+a')
	await page.keyboard.type('edited')
	await page.keyboard.press('Escape')
	await expect
		.poll(() => page.evaluate(() => JSON.stringify((window as unknown as W).editor.getCurrentPageShapes().find((s) => s.id === 'shape:leave-0')?.props.richText)))
		.toContain('edited')
	// Read again with its new text, and gone again.
	await expect.poll(() => mounted(page), { timeout: 30_000 }).toBe(0)
})

test('a shape off screen leaves the page, and comes back when it is on screen', async ({ page }) => {
	await bigBoard(page)
	await setRenderer(page, 'dom')
	await page.evaluate(() => (window as unknown as W).editor.setCamera({ x: 0, y: 0, z: 1 }))
	await expect.poll(() => mounted(page)).toBeLessThan(COLS * ROWS)
	const last = `shape:leave-${COLS * ROWS - 1}`
	await expect(page.locator(`.tl-shape[data-shape-id="${last}"]`)).toHaveCount(0)
	await page.evaluate((id) => {
		const e = (window as unknown as W).editor
		const b = e.getShapePageBounds(id)!
		e.setCamera({ x: -b.x + 100, y: -b.y + 100, z: 1 })
	}, last)
	await expect(page.locator(`.tl-shape[data-shape-id="${last}"]`)).toHaveCount(1)
	await expect(page.locator(`.tl-shape[data-shape-id="${last}"]`)).toContainText(`shape ${COLS * ROWS - 1}`)
})

test('the board exports the same whether its shapes are on the page or have left it', async ({ page }) => {
	test.setTimeout(120_000)
	await bigBoard(page)
	await fit(page)
	const exportBoard = () =>
		page.evaluate(async () => {
			const e = (window as unknown as W).editor
			const { blob } = await e.toImage([...e.getCurrentPageShapeIds()], { format: 'png', pixelRatio: 1, background: true })
			const bytes = new Uint8Array(await blob.arrayBuffer())
			let s = ''
			for (const b of bytes) s += String.fromCharCode(b)
			return btoa(s)
		})
	await setRenderer(page, 'dom')
	await expect.poll(() => mounted(page)).toBe(COLS * ROWS)
	const onPage = PNG.sync.read(Buffer.from(await exportBoard(), 'base64'))
	await setRenderer(page, 'gpu')
	await expect.poll(() => mounted(page), { timeout: 30_000 }).toBe(0)
	const left = PNG.sync.read(Buffer.from(await exportBoard(), 'base64'))
	expect([left.width, left.height]).toEqual([onPage.width, onPage.height])
	expect(pixelmatch(onPage.data, left.data, null, onPage.width, onPage.height, { threshold: 0 })).toBe(0)
	// Each was mounted for its copy, and has left again.
	await expect.poll(() => mounted(page), { timeout: 30_000 }).toBe(0)
})

test('a shape whose label shows an expression stays on the page', async ({ page }) => {
	await bigBoard(page, (i) => (i === 0 ? 'count {count page}' : `shape ${i}`))
	await setRenderer(page, 'gpu')
	await fit(page)
	await expect.poll(() => mounted(page), { timeout: 30_000 }).toBe(1)
	await expect(page.locator('.tl-shape[data-shape-id="shape:leave-0"]')).toHaveCount(1)
})
