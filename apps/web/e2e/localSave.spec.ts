import { expect, test } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * A board on this device keeps an edit made just before a reload: the save waits a moment after each
 * change, and what it hasn't written yet goes to localStorage as the page goes.
 */
test('an edit made the instant before a reload is still there after it', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { editor?: unknown }).editor))).toBe(true)

	for (const id of ['shape:first', 'shape:second']) {
		await page.evaluate((id) => {
			;(window as unknown as { editor: { createShapes(s: unknown[]): void } }).editor.createShapes([
				{ id, type: 'geo', x: 100, y: 100, props: { w: 80, h: 60 } },
			])
		}, id)
		await page.reload()
		await expect
			.poll(() =>
				page.evaluate((id) => Boolean((window as unknown as { editor?: { getShape(id: string): unknown } }).editor?.getShape(id)), id)
			)
			.toBe(true)
	}
	// And once the database has it all, the stash is gone.
	await expect
		.poll(() => page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('lifeboard-local-stash:'))))
		.toEqual([])
})
