import { expect, test, type Page } from '@playwright/test'
import { createBoard, createNote, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * The selected shapes' outlines are drawn on one 2D canvas (SelectionIndicatorsCanvas.tsx). Once
 * nothing is selected it must be empty: it used to clear under the last outline's transform, which
 * left that shape's top and left edges on the board, standing still while the board moved.
 */

/** Pixels with any ink on the visible board's outline canvas. */
const inked = (page: Page) =>
	page.evaluate(() => {
		const canvas = document.querySelector('.lb-board-host:not([data-hidden]) canvas.tl-overlays__canvas') as HTMLCanvasElement | null
		if (!canvas) return -1
		const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
		let n = 0
		for (let i = 3; i < data.length; i += 4) if (data[i]) n++
		return n
	})

test('a selected outline goes when the selection does, after a pan too', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Outlines')
	await openBoard(page, 'Outlines')
	await createNote(page, { x: 480, y: 200 }, { w: 320, h: 200 })
	await page.keyboard.type('# Task List\n- one\n- two')
	await page.keyboard.press('Escape')
	await page.keyboard.press('Escape')

	await page.mouse.click(560, 230)
	await expect.poll(() => inked(page)).toBeGreaterThan(0)
	await page.mouse.wheel(-200, -100)
	await page.waitForTimeout(300)
	await page.keyboard.press('Escape')
	await expect.poll(() => inked(page)).toBe(0)
})
