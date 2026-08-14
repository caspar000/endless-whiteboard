import { expect, test } from '@playwright/test'
import { backToList, countShapes, createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

const PALETTE = '.lb-palette__panel'
const INPUT = '.lb-palette__input'
const ROWS = '.lb-palette__row'

/** `ControlOrMeta` so the suite passes on whichever platform runs it. */
async function openPalette(page: import('@playwright/test').Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await expect(page.locator(PALETTE)).toBeVisible()
}

test.describe('command palette', () => {
	test('opens from the home screen and closes on Escape', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await openPalette(page)
		await expect(page.locator(INPUT)).toBeFocused()

		await page.keyboard.press('Escape')
		await expect(page.locator(PALETTE)).toBeHidden()
	})

	test('typing a board name and pressing Enter opens that board', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Kitchen plans')
		await backToList(page)

		await openPalette(page)
		await page.locator(INPUT).fill('kitchen')
		// Substring, case-insensitive: one board matches, so it is the highlighted row.
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		await expect(page).toHaveURL(/#\/board\//)
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Kitchen plans')
	})

	test('> switches to commands, and running one changes the app', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Both directions, rather than asserting a starting theme: the default is `system`, so which
		// one the app resolves to depends on the machine running the suite.
		for (const theme of ['dark', 'light'] as const) {
			await openPalette(page)
			await page.locator(INPUT).fill(`> ${theme}`)
			await expect(page.locator(ROWS)).toHaveCount(1)
			await page.keyboard.press('Enter')

			await expect(page.locator(PALETTE)).toBeHidden()
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
		}
	})

	test('`when` gates canvas commands on there being a board', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// No board open: Undo has no editor to act on, so it must not be offered.
		await openPalette(page)
		await page.locator(INPUT).fill('> undo')
		await expect(page.locator(ROWS)).toHaveCount(0)
		await page.keyboard.press('Escape')

		await createBoard(page)

		await openPalette(page)
		await page.locator(INPUT).fill('> undo')
		await expect(page.locator(ROWS)).toHaveCount(1)
	})

	test('inserts a node from the registry, at the middle of the view', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		expect(await countShapes(page, 'node.markdown')).toBe(0)

		await openPalette(page)
		// "Add note" is generated from the node registry, not written out anywhere.
		await page.locator(INPUT).fill('> add note')
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(1)
	})

	test('the Help page lists a command because the command exists', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await openPalette(page)
		await page.locator(INPUT).fill('help')
		await page.keyboard.press('Enter')

		// The help page shows one section at a time, and the shortcuts are not the landing one.
		await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()

		// Generated from the registry: "Zoom to fit" has no hand-written row anywhere on the page.
		const row = page.locator('.lb-help__keyrow', { hasText: 'Zoom to fit' })
		await expect(row).toHaveCount(1)
		// Either spelling — the keycap is rendered for whichever platform runs the suite.
		await expect(row.locator('.lb-kbd')).toHaveText(/^(⇧1|Shift\+1)$/)
	})

	test('typing in the palette does not reach the canvas', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		const toolBefore = await currentTool(page)
		expect(toolBefore).toBe('select')

		await openPalette(page)
		/*
		 * `r` and `d` are tldraw tool shortcuts. tldraw reads keys off the *document* and gates them on
		 * `editor.getIsFocused()`, so the only thing standing between these keystrokes and the canvas is
		 * App blurring the editors while the palette is open. This is the regression test for that.
		 */
		await page.locator(INPUT).pressSequentially('draw')
		expect(await currentTool(page)).toBe('select')

		await page.keyboard.press('Escape')
		// ...and the board takes keys again once the palette is gone.
		await page.keyboard.press('d')
		await expect.poll(async () => await currentTool(page)).toBe('draw')
	})
})

async function currentTool(page: import('@playwright/test').Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor?: { getCurrentToolId(): string } }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getCurrentToolId()
	})
}
