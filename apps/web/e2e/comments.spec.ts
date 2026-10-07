import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/** Comments on a board that is only this device's (fork-parity S7): placed, kept, resolved, listed. */

const toScreen = (page: Page, x: number, y: number) =>
	page.evaluate((p) => (window as unknown as { editor: { pageToScreen(p: { x: number; y: number }): { x: number; y: number } } }).editor.pageToScreen(p), { x, y })

test('a comment is placed with C and a click, survives a reload, and resolves into the list', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { editor?: unknown }).editor))).toBe(true)

	await page.locator('.tl-canvas:visible').click({ position: { x: 40, y: 40 } })
	await page.keyboard.press('c')
	const spot = await toScreen(page, 300, 200)
	await page.mouse.click(spot.x, spot.y)
	await page.getByLabel('Add a comment').fill('Remember the deadline')
	await page.getByLabel('Add a comment').press('Enter')
	await expect(page.getByTestId('lb.comment')).toContainText('You')
	await expect(page.getByLabel('Comments, 1 open')).toBeVisible()

	// A board on this device saves a moment after a change (`PERSIST_THROTTLE_MS`).
	await page.waitForTimeout(1000)
	await page.reload()
	await expect(page.getByTestId('lb.comment-pin')).toHaveCount(1)
	await page.getByTestId('lb.comment-pin').click()
	await page.getByRole('button', { name: 'Resolve' }).click()
	await page.getByTestId('lb.comment-popover').getByLabel('Close').click()
	await expect(page.getByTestId('lb.comment-pin')).toHaveCount(0)

	await page.getByTestId('lb.comments').click()
	await page.getByRole('tab', { name: 'Resolved' }).click()
	await expect(page.getByTestId('lb.comments-panel')).toContainText('Remember the deadline')
})
