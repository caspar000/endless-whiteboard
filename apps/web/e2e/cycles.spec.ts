import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * A second press of a tool's key, or a second click on its dock button, switches its kind
 * (canvas/toolCycles.ts): Select and Hand, sticky and pinned note, pen and eraser, the arrow's kinds,
 * the shapes.
 */
interface ToolEditor {
	getCurrentToolId(): string
	getStyleForNextShape(style: unknown): string
}
const tool = (page: Page) => page.evaluate(() => (window as unknown as { editor: ToolEditor }).editor.getCurrentToolId())
const nextStyle = (page: Page, key: 'geo' | 'kind') =>
	page.evaluate((key) => {
		const editor = (window as unknown as { editor: { getInstanceState(): { stylesForNextShape: Record<string, string> } } }).editor
		return editor.getInstanceState().stylesForNextShape[key === 'geo' ? 'tldraw:geo' : 'tldraw:arrowKind'] ?? null
	}, key)

async function onABoard(page: Page) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Keys')
	await openBoard(page, 'Keys')
	await page.locator('.lb-board-host:not([data-hidden]) .tl-canvas').click({ position: { x: 640, y: 360 } })
}

const press = async (page: Page, key: string, expected: string) => {
	await page.keyboard.press(key)
	await expect.poll(() => tool(page)).toBe(expected)
}

test('a second press of a tool key switches its kind, and a tool comes back as it was left', async ({ page }) => {
	await onABoard(page)

	// A board starts in Select, so 1 is already a second press.
	expect(await tool(page)).toBe('select')
	await press(page, '1', 'hand')
	await press(page, '1', 'select')
	await press(page, 'h', 'hand')
	await press(page, '2', 'select')

	await press(page, '5', 'note')
	await press(page, '5', 'pinned-note')
	await press(page, 'n', 'note')
	await press(page, 'n', 'pinned-note')

	await press(page, '6', 'draw')
	await press(page, 'd', 'eraser')
	await press(page, '6', 'draw')
	await press(page, '7', 'eraser')
	await press(page, 'e', 'draw')

	// The note comes back pinned: that is how it was left.
	await press(page, '5', 'pinned-note')

	await press(page, 'r', 'geo')
	const first = await nextStyle(page, 'geo')
	await page.keyboard.press('r')
	await expect.poll(() => nextStyle(page, 'geo')).not.toBe(first)
	expect(await tool(page)).toBe('geo')

	await press(page, 'a', 'arrow')
	const kind = await nextStyle(page, 'kind')
	await page.keyboard.press('a')
	await expect.poll(() => nextStyle(page, 'kind')).not.toBe(kind)
})

test('the dock has one button per pair, marked, and a second click switches it', async ({ page }) => {
	await onABoard(page)
	const dock = page.locator('.lb-board-host:not([data-hidden]) .lb-dock')
	await expect(dock.locator('[data-cycles]')).toHaveCount(5)

	const note = dock.getByTestId('tools.note')
	await note.click()
	await expect.poll(() => tool(page)).toBe('note')
	await note.click()
	await expect.poll(() => tool(page)).toBe('pinned-note')
	await expect(note).toHaveAttribute('aria-label', 'Pinned note')

	const pen = dock.getByTestId('tools.draw')
	await pen.click()
	await pen.click()
	await expect.poll(() => tool(page)).toBe('eraser')
	await expect(pen).toHaveAttribute('aria-label', 'Eraser')

	const nav = dock.getByTestId('tools.select')
	await nav.click()
	await expect.poll(() => tool(page)).toBe('select')
	await nav.click()
	await expect.poll(() => tool(page)).toBe('hand')
	await expect(nav).toHaveAttribute('data-mode', 'hand')
	await expect(nav).toHaveAttribute('title', /Press again for Select/)
})
