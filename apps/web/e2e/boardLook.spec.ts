import { expect, test } from '@playwright/test'
import { backToList, createBoard, gotoFresh, openBoard, showSidebar, skipFirstRunDemo } from './helpers'

const GREEN = 'rgb(48, 164, 108)'
const background = (locator: import('@playwright/test').Locator) =>
	locator.evaluate((el) => getComputedStyle(el.querySelector('.lb-badge') ?? el).backgroundColor)

test('a board takes a colour and an icon from its tab, and shows them everywhere it is listed', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Training')
	await openBoard(page, 'Training')

	const tabBadge = page.locator('.lb-tabs__tab--active .lb-badge-button')
	await tabBadge.click()
	const picker = page.getByRole('dialog', { name: 'Colour and icon of Training' })
	await expect(picker).toBeVisible()
	// The tab was clicked through its badge, not selected or renamed.
	await expect(page.getByLabel('Board name')).toHaveCount(0)

	// Search goes by what an icon is for, not only by its name.
	await picker.getByLabel('Search icons').fill('gym')
	await expect(picker.getByRole('button', { name: 'dumbbell' })).toBeVisible()
	await expect(picker.getByRole('button', { name: 'pizza' })).toHaveCount(0)
	await picker.getByRole('button', { name: 'dumbbell' }).click()
	await expect(picker.getByRole('button', { name: 'dumbbell' })).toHaveAttribute('aria-pressed', 'true')

	await picker.getByRole('button', { name: 'Green' }).click()
	await expect.poll(() => background(tabBadge)).toBe(GREEN)
	await expect(tabBadge.locator('svg')).toHaveCount(1)

	// Typing in the search box is the picker's: the board underneath took no tool shortcut from it.
	expect(
		await page.evaluate(
			() => (window as unknown as { editor: { getCurrentToolId(): string } }).editor.getCurrentToolId()
		)
	).toBe('select')

	// The badge is a toggle.
	await tabBadge.click()
	await expect(picker).toHaveCount(0)

	// The sidebar row and the home card wear it too, and it survives a reload.
	await page.reload()
	await expect(page.locator('.lb-tabs__tab--active .lb-badge svg')).toHaveCount(1)
	await showSidebar(page)
	const row = page.locator('.lb-sidebar__board', { has: page.getByRole('button', { name: 'Training', exact: true }) }).first()
	await expect.poll(() => background(row.locator('.lb-badge-button'))).toBe(GREEN)

	await backToList(page)
	const card = page.locator('.lb-card', { hasText: 'Training' })
	await expect.poll(() => background(card.locator('.lb-badge-button'))).toBe(GREEN)

	// The card's badge opens the picker, not the board; Default takes the colour back off.
	await card.locator('.lb-badge-button').click()
	await expect(page.locator('.lb-home__header')).toBeVisible()
	await page.getByRole('dialog', { name: 'Colour and icon of Training' }).getByRole('button', { name: 'Default colour' }).click()
	await expect.poll(() => background(card.locator('.lb-badge-button'))).not.toBe(GREEN)
	await expect(card.locator('.lb-badge svg')).toHaveCount(1)
})

test('⌘K changes the open board’s colour and icon', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Garden')
	await openBoard(page, 'Garden')

	await page.keyboard.press('ControlOrMeta+Shift+k')
	await page.keyboard.type('colour and icon')
	await page.keyboard.press('Enter')
	const picker = page.getByRole('dialog', { name: 'Colour and icon of Garden' })
	await expect(picker).toBeVisible()
	await expect(picker.getByLabel('Search icons')).toBeFocused()
	await page.keyboard.type('plant')
	await picker.getByRole('button', { name: 'sprout' }).click()
	await expect(page.locator('.lb-tabs__tab--active .lb-badge svg')).toHaveCount(1)
	await page.keyboard.press('Escape')
	await expect(picker).toHaveCount(0)
})
