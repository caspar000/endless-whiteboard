import { expect, test } from '@playwright/test'
import { insertSynthetic } from './fixtures/synthetic'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * The "Preparing board" status (canvas/BoardPreparingPill.tsx): on a board big enough for the GPU
 * layer, it says how far the shapes around the screen are from being drawn by it, then that the board
 * is ready, then goes. A small board never shows it.
 */

test('a big board says how far it is from ready, then that it is, then nothing', async ({ page }) => {
	test.skip(!!process.env.LB_GPU_BUDGET, 'the GPU layer on everywhere changes what counts as big')
	test.setTimeout(5 * 60_000)
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Big')
	await openBoard(page, 'Big')
	await insertSynthetic(page, 3000)
	// Nothing returned: the editor doesn't serialise.
	await page.evaluate(() => {
		;(window as unknown as { editor: { zoomToFit(o: unknown): void } }).editor.zoomToFit({ animation: { duration: 0 } })
	})

	const pill = page.getByTestId('lb.board-preparing')
	await expect(pill).toContainText('Preparing board', { timeout: 30_000 })
	await expect(pill).toContainText(/[\d,]+ \/ [\d,]+ shapes|[\d,]+ pictures? left/)
	await expect(pill).toHaveText(/Board ready/, { timeout: 180_000 })
	await expect(pill).toHaveCount(0, { timeout: 10_000 })
})

test("a small board doesn't show it", async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Small')
	await openBoard(page, 'Small')
	await insertSynthetic(page, 20)
	await page.waitForTimeout(3000)
	await expect(page.getByTestId('lb.board-preparing')).toHaveCount(0)
})
