import { expect, test } from '@playwright/test'
import { gotoFresh } from './helpers'

/** The phone layout (docs/mobile-plan.md): the chrome a board has below 768px. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const pill = (page: import('@playwright/test').Page) => page.locator('.lb-pill__current')

test.describe('phone chrome', () => {
	test('the board pill names the board, and its list switches, closes and makes boards', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toContainText('Home office shopping')
		// No tab strip on a phone: the pill is how you see and change the open boards.
		await expect(page.locator('.lb-tabs')).toHaveCount(0)

		await pill(page).click()
		await page.getByRole('menuitem', { name: 'New board' }).click()
		await expect(pill(page)).toContainText('Untitled board')

		await pill(page).click()
		const list = page.getByRole('menu', { name: 'Open boards' })
		await expect(list.getByRole('menuitem')).toHaveText(['Home office shopping', 'Untitled board', 'New board', 'All boards'])
		await list.getByRole('menuitem', { name: 'Home office shopping' }).click()
		await expect(list).toHaveCount(0)
		await expect(pill(page)).toContainText('Home office shopping')

		// Closing one from the list leaves the others open.
		await pill(page).click()
		await list.getByRole('button', { name: 'Close Untitled board' }).click()
		await expect(list.getByRole('menuitem', { name: 'Untitled board' })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await expect(list).toHaveCount(0)

		await pill(page).click()
		await list.getByRole('menuitem', { name: 'All boards' }).click()
		await expect(page.locator('.lb-home__header')).toBeVisible()
	})

	test('the menu is a card that gets out of the way, and has the search the keyboard would', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const sidebar = page.locator('.lb-sidebar')

		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await expect(sidebar).not.toHaveClass(/lb-sidebar--collapsed/)
		// A card between the top bar and the dock, not a full-height panel.
		const box = (await sidebar.boundingBox())!
		expect(box.y).toBeGreaterThan(40)
		expect(box.y + box.height).toBeLessThan(844 - 56)

		// Going somewhere from it closes it.
		await sidebar.getByRole('button', { name: /^All boards/ }).first().click()
		await expect(page.locator('.lb-home__header')).toBeVisible()
		await expect(sidebar).toHaveClass(/lb-sidebar--collapsed/)

		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await sidebar.getByRole('button', { name: 'Search boards and commands' }).click()
		await expect(sidebar).toHaveClass(/lb-sidebar--collapsed/)
		await expect(page.getByPlaceholder(/Search boards/)).toBeFocused()
	})

	test('the agent opens as a card from the right, and a tap beside it closes it', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await page.getByRole('button', { name: 'Open agent panel' }).click()
		const panel = page.locator('.lb-agent-panel')
		await expect(panel).toBeVisible()
		// Measured once it has slid in.
		await expect.poll(async () => {
			const box = (await panel.boundingBox())!
			return box.x > 0 && box.x + box.width < 390 && box.y > 40
		}).toBe(true)

		// The strip beside the card: the top bar's buttons stay usable above the dimming.
		await page.locator('.lb-agent-scrim').click({ position: { x: 3, y: 420 } })
		await expect(page.locator('.lb-agent-scrim')).toHaveCount(0)
	})
})
