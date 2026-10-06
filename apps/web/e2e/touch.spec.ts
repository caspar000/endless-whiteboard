import { expect, test, type Page } from '@playwright/test'
import { gotoFresh } from './helpers'

/** A phone: touch, no mouse (docs/fork-parity.md I6). */
test.use({ viewport: { width: 400, height: 800 }, hasTouch: true, isMobile: true })

interface EditorHandle {
	getZoomLevel(): number
	screenToPage(p: { x: number; y: number }): { x: number; y: number }
	setCamera(c: { x: number; y: number; z: number }): void
	selectNone(): void
	getEditingShapeId(): string | null
	createShapes(shapes: unknown[]): void
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
}

async function touches(page: Page) {
	const cdp = await page.context().newCDPSession(page)
	return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][] = []) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) })
}

const view = (page: Page, at: { x: number; y: number }) =>
	page.evaluate((p) => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		const spot = editor.screenToPage(p)
		return { zoom: Math.round(editor.getZoomLevel() * 100) / 100, x: Math.round(spot.x), y: Math.round(spot.y) }
	}, at)

test.describe('touch', () => {
	test('tap, then tap and drag, zooms around the finger; a plain double tap still edits', async ({ page }) => {
		await gotoFresh(page)
		await page.waitForFunction(() => Boolean((window as unknown as { editor?: EditorHandle }).editor))
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.selectNone()
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const touch = await touches(page)
		const at = { x: 250, y: 300 }
		const before = await view(page, at)

		await touch('touchStart', [[at.x, at.y]])
		await touch('touchEnd')
		await touch('touchStart', [[at.x, at.y]])
		for (let i = 1; i <= 10; i++) await touch('touchMove', [[at.x, at.y + i * 15]])
		await touch('touchEnd')

		// 150px down is one doubling, and the spot under the finger hasn't moved.
		await expect.poll(() => view(page, at)).toEqual({ ...before, zoom: 2 })

		// Dragging up zooms back out.
		await page.waitForTimeout(400)
		await touch('touchStart', [[at.x, at.y]])
		await touch('touchEnd')
		await touch('touchStart', [[at.x, at.y]])
		for (let i = 1; i <= 10; i++) await touch('touchMove', [[at.x, at.y - i * 15]])
		await touch('touchEnd')
		await expect.poll(() => view(page, at)).toEqual(before)

		// A double tap that doesn't move is still a double tap: on a sticky, it starts editing it.
		await page.waitForTimeout(400)
		const centre = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const origin = editor.screenToPage({ x: 150, y: 500 })
			editor.createShapes([{ id: 'shape:tap', type: 'note', x: origin.x, y: origin.y }])
			return editor.pageToScreen({ x: origin.x + 100, y: origin.y + 100 })
		})
		const point: [number, number] = [centre.x, centre.y]
		await touch('touchStart', [point])
		await touch('touchEnd')
		await touch('touchStart', [point])
		await touch('touchEnd')
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { editor: EditorHandle }).editor.getEditingShapeId()))
			.toBe('shape:tap')
	})

	test('a long press opens the menu a right-click would', async ({ page }) => {
		await gotoFresh(page)
		await page.waitForFunction(() => Boolean((window as unknown as { editor?: EditorHandle }).editor))
		const touch = await touches(page)
		await touch('touchStart', [[200, 400]])
		await expect(page.getByRole('menu')).toBeVisible()
		await touch('touchEnd')
		await expect(page.getByRole('menuitem', { name: 'Select all' })).toBeVisible()
	})
})
