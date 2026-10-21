import { expect, type Browser, type BrowserContextOptions, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from '../helpers'

/**
 * The four-tree board (the whole-life skill tree test, ~3,500 shapes), built once per run and kept:
 * generating it takes a minute or two, and the parity checks and the benchmark each wanted it in a
 * fresh app. It's the board and the vault behind it (the tree's items and progress live there, not in
 * the shapes), so what's kept is the browser's whole storage, IndexedDB included, and each test
 * starts a context of its own from it.
 */

export const FOUR_TREES_BOARD = 'Four trees'

const shapeCount = (page: Page) => page.evaluate(() => (window as unknown as { editor: { getCurrentPageShapes(): unknown[] } }).editor.getCurrentPageShapes().length)

/** Puts the whole-life test on the open board and waits until it's laid out and settled. */
export async function insertFourTrees(page: Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await page.locator('.lb-palette__input').fill('>whole-life test')
	await expect(page.locator('.lb-palette__row--on')).toContainText('whole-life test')
	await page.keyboard.press('Enter')
	// Inserted, laid out and settled: thousands of shapes, then nothing more for a moment.
	await expect.poll(() => shapeCount(page), { timeout: 120_000 }).toBeGreaterThan(3000)
	let last = -1
	await expect
		.poll(
			async () => {
				const now = await shapeCount(page)
				const settled = now === last
				last = now
				return settled
			},
			{ timeout: 60_000, intervals: [2000] }
		)
		.toBe(true)
}

let kept: Promise<string> | null = null

/** The kept storage's file, the board built into it on first use in this run. */
function fourTreesState(browser: Browser, baseURL: string): Promise<string> {
	kept ??= (async () => {
		const context = await browser.newContext({ baseURL })
		const page = await context.newPage()
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, FOUR_TREES_BOARD)
		await openBoard(page, FOUR_TREES_BOARD)
		await insertFourTrees(page)
		// Closing its tab unmounts the editor, which writes the board out.
		await page.locator('.lb-tabs__close').click()
		await expect(page.locator('.lb-home__header')).toBeVisible()
		await expect(page.locator('.lb-board-host')).toHaveCount(0, { timeout: 20_000 })
		await page.waitForTimeout(1000)
		const file = path.join(os.tmpdir(), `lifeboard-four-trees-${process.pid}-${Date.now()}.json`)
		await context.storageState({ path: file, indexedDB: true })
		await context.close()
		return file
	})()
	return kept
}

/**
 * A page of its own, in a context made with `options` (the test's pixel ratio, say), on the
 * four-tree board, open and settled. Close its context when done.
 */
export async function openFourTrees(browser: Browser, options: BrowserContextOptions & { baseURL: string }): Promise<Page> {
	const file = await fourTreesState(browser, options.baseURL)
	if (!fs.existsSync(file)) throw new Error(`the kept four-tree board is gone: ${file}`)
	const context = await browser.newContext({ ...options, storageState: file })
	const page = await context.newPage()
	await page.goto('/#/')
	await expect(page.locator('.lb-home__header')).toBeVisible()
	await openBoard(page, FOUR_TREES_BOARD)
	await expect.poll(() => shapeCount(page), { timeout: 60_000 }).toBeGreaterThan(3000)
	return page
}
