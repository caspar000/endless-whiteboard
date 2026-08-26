import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
	NOTE_EDITOR,
	createBoard,
	createNote,
	gotoFresh,
	noteMarkdown,
	openSettings,
	skipFirstRunDemo,
} from './helpers'

/**
 * The keymap: the command table decides what a key does, and the user decides over it.
 *
 * These test the two things that can only be true if the app really owns dispatch — a rebound chord
 * working, and the old one going quiet — plus the guard that keeps the canvas out of a text field.
 */

/** The zoom level, which is what a camera command changes and nothing else here does. */
async function zoom(page: Page): Promise<number> {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor?: { getZoomLevel(): number } }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getZoomLevel()
	})
}

async function currentTool(page: Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor?: { getCurrentToolId(): string } }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getCurrentToolId()
	})
}

/** Back to the open board from Settings, via its tab — the way a person would. */
async function backToBoard(page: Page): Promise<void> {
	await page.getByRole('tab', { name: 'Untitled board' }).click()
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()
	await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))
}

/** Rebinds a command through the real UI: find its row, press Change, then press the chord. */
async function rebind(page: Page, title: string, key: string): Promise<void> {
	const row = page.locator('.lb-keymap__row', { hasText: title })
	await expect(row).toHaveCount(1)
	await row.getByRole('button', { name: `Change the shortcut for ${title}` }).click()
	await expect(row.locator('.lb-keymap__listening')).toBeVisible()
	await page.keyboard.press(key)
	await expect(row.locator('.lb-keymap__listening')).toHaveCount(0)
}

test.describe('keymap', () => {
	test('a rebound command answers to its new chord, and its old one goes quiet', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Something to zoom to, so "zoom to fit" has an effect to measure.
		await createNote(page, { x: 500, y: 220 })
		await page.keyboard.press('Escape')

		await openSettings(page, 'Keyboard')
		// Generated from the table: no row for "Zoom to fit" is written anywhere on this page.
		await rebind(page, 'Zoom to fit', 'Control+Alt+9')

		await backToBoard(page)

		const before = await zoom(page)
		// The default. tldraw still has its own binding for shift+1 — the app claims the chord and
		// swallows it, which is the only reason a rebinding can be honest.
		await page.keyboard.press('Shift+1')
		await page.waitForTimeout(400)
		expect(await zoom(page)).toBeCloseTo(before, 3)

		await page.keyboard.press('Control+Alt+9')
		await expect.poll(async () => (await zoom(page)) !== before, { timeout: 4000 }).toBe(true)
	})

	test('a tool letter is a binding like any other', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// The default letter, dispatched by the app now and delegated to tldraw's own tool.
		await page.keyboard.press('d')
		await expect.poll(async () => await currentTool(page)).toBe('draw')
		await page.keyboard.press('v')
		await expect.poll(async () => await currentTool(page)).toBe('select')

		await openSettings(page, 'Keyboard')
		await rebind(page, 'Eraser', 'Control+Alt+8')
		await backToBoard(page)

		await page.keyboard.press('Control+Alt+8')
		await expect.poll(async () => await currentTool(page)).toBe('eraser')
		// `e` was the eraser's letter and is now nobody's.
		await page.keyboard.press('v')
		await expect.poll(async () => await currentTool(page)).toBe('select')
		await page.keyboard.press('e')
		await page.waitForTimeout(300)
		expect(await currentTool(page)).toBe('select')
	})

	test('a binding survives a reload, and Reset gives the default back', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openSettings(page, 'Keyboard')
		await rebind(page, 'Eraser', 'Control+Alt+8')

		await page.reload()
		await expect(page.getByRole('heading', { level: 1, name: 'Keyboard' })).toBeVisible()
		const row = page.locator('.lb-keymap__row', { hasText: 'Eraser' })
		// `⌘` rather than `⌃`: Meta and Control are one modifier in this keymap's vocabulary, which is
		// what lets a single binding work on both platforms (`keymap.ts`). Pressing Ctrl records the
		// accelerator, and the keycap says so.
		await expect(row.locator('.lb-kbd')).toHaveText(/^(⌥⌘8|Ctrl\+Alt\+8)$/)

		await row.getByRole('button', { name: 'Reset the shortcut for Eraser' }).click()
		// Back to the table's own answer — a letter and a digit, as two keycaps.
		await expect(row.locator('.lb-kbd').first()).toHaveText('E')
	})

	test('the canvas keeps its hands off a note you are writing', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await createNote(page)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		// Every one of these is a bound chord: `d` and `v` are tools, Backspace is Delete. While a
		// shape is being edited the app must claim none of them.
		await page.keyboard.type('dive')
		await page.keyboard.press('Backspace')
		expect(await currentTool(page)).toBe('select')

		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe('div')
	})

	test('⌘K still reaches over a note being written, because it is app chrome', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await createNote(page)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		// The one deliberate difference from tldraw's own rule, which refuses *everything* while a
		// shape is being edited: the palette is what you open over your work, not instead of it.
		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.locator('.lb-palette__panel')).toBeVisible()
	})
})
