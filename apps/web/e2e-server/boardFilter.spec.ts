import { expect, test } from '@playwright/test'

/** All boards, with a server: a filter between the server's boards and the ones only on this device. */

test('the board list filters between the server and this device, and cards say which', async ({ page }) => {
	await page.goto('/login')
	await page.locator('input[name="username"]').fill('owner')
	await page.locator('input[name="password"]').fill('lifeboard-e2e-password')
	await page.locator('input[name="password"]').press('Enter')
	await page.waitForURL((url) => !url.pathname.startsWith('/login'))
	// A first visit opens the demo board; let it, so it doesn't take the screen later.
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()

	// Two new boards, both on the server; then one of them moves to this device.
	const allBoards = () => page.getByRole('tab', { name: 'All boards' }).click()
	const rename = async (name: string) => {
		await allBoards()
		await page.getByRole('button', { name: 'New board' }).first().click()
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Untitled board')
		await allBoards()
		const card = page.locator('.lb-list__board', { hasText: 'Untitled board' }).first()
		await card.hover()
		await card.getByRole('button', { name: 'Rename' }).click()
		await page.getByLabel('Board name').fill(name)
		await page.getByLabel('Board name').press('Enter')
		await expect(page.locator('.lb-list__board', { hasText: name })).toHaveCount(1)
	}
	await rename('Filter up there')
	await rename('Filter down here')
	const local = page.locator('.lb-list__board', { hasText: 'Filter down here' })
	await local.hover()
	await local.getByRole('button', { name: 'Move to this device' }).click()
	await expect(local.locator('.lb-list__meta')).toContainText('this device only', { timeout: 30_000 })

	const filter = page.getByRole('group', { name: 'Where the boards are' })
	await filter.getByRole('button', { name: /On this device/ }).click()
	await expect(page.locator('.lb-list__board', { hasText: 'Filter down here' })).toHaveCount(1)
	await expect(page.locator('.lb-list__board', { hasText: 'Filter up there' })).toHaveCount(0)

	await filter.getByRole('button', { name: /On the server/ }).click()
	await expect(page.locator('.lb-list__board', { hasText: 'Filter up there' })).toHaveCount(1)
	await expect(page.locator('.lb-list__board', { hasText: 'Filter down here' })).toHaveCount(0)
	await expect(page.locator('.lb-list__board', { hasText: 'Filter up there' }).locator('.lb-list__meta')).not.toContainText('this device')

	await filter.getByRole('button', { name: /All/ }).click()
	await expect(page.locator('.lb-list__board', { hasText: /Filter (up there|down here)/ })).toHaveCount(2)
})
