import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { unzipSync } from 'fflate'

/** Settings → Storage → Download server backup is the browser's own download, and a whole backup. */
test('the server backup downloads as a file the browser saves', async ({ page }) => {
	await page.goto('/login')
	await page.locator('input[name="username"]').fill('owner')
	await page.locator('input[name="password"]').fill('lifeboard-e2e-password')
	await page.locator('input[name="password"]').press('Enter')
	await page.waitForURL((url) => !url.pathname.startsWith('/login'))
	// A first visit opens the demo board, which is on the server: something to back up.
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()

	await page.goto('/#/settings/storage')
	const download = page.waitForEvent('download')
	await page.getByRole('button', { name: 'Download server backup (.zip)' }).click()
	const file = await download
	expect(file.suggestedFilename()).toMatch(/^lifeboard-server-\d{4}-\d{2}-\d{2}\.zip$/)
	await expect(page.getByText('The backup is downloading')).toBeVisible()
	// The button is free again at once: the browser has the download, not the page.
	await expect(page.getByRole('button', { name: 'Download server backup (.zip)' })).toBeEnabled()

	const zip = unzipSync(new Uint8Array(readFileSync((await file.path())!)))
	const manifest = JSON.parse(new TextDecoder().decode(zip['manifest.json'])) as { boards: Array<{ id: string; name: string }> }
	expect(manifest.boards.map((board) => board.name)).toContain('Home office shopping')
	expect(Object.keys(zip).some((name) => name.startsWith('boards/'))).toBe(true)
})
