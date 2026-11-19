import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * A link on the board is a square card that opens it (canvas/linkPreview/): a click anywhere opens the
 * link, a drag moves the card, a double-click opens its inspector.
 *
 * The suite runs without the server's page lookup, so a card is named after its site.
 */

/** Drops a URL on the canvas the way a browser does. */
async function dropUrl(page: Page, url: string): Promise<void> {
	await page.evaluate((href) => {
		const data = new DataTransfer()
		data.setData('text/uri-list', href)
		data.setData('text/plain', href)
		const canvas = document.querySelector('.lb-board-host:not([data-hidden]) .tl-canvas')
		if (!canvas) throw new Error('no visible canvas')
		const at = canvas.getBoundingClientRect()
		const init = {
			dataTransfer: data,
			bubbles: true,
			cancelable: true,
			clientX: at.left + at.width / 2,
			clientY: at.top + at.height / 2,
		}
		canvas.dispatchEvent(new DragEvent('dragenter', init))
		canvas.dispatchEvent(new DragEvent('dragover', init))
		canvas.dispatchEvent(new DragEvent('drop', init))
	}, url)
}

interface CardEditor {
	getCurrentPageShapes(): { id: string; type: string; x: number; y: number; props: { url: string; w: number; h: number } }[]
	getSelectedShapeIds(): string[]
	selectNone(): void
}

async function theCard(page: Page) {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: CardEditor }).editor
		return editor.getCurrentPageShapes().find((s) => s.type === 'bookmark')!
	})
}

test.describe('link cards', () => {
	test.beforeEach(async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		// Record what would open in a new tab rather than leaving the suite for the web.
		await page.evaluate(() => {
			const opened: string[] = []
			;(window as unknown as { opened: string[] }).opened = opened
			window.open = (url?: string | URL) => {
				opened.push(String(url))
				return null
			}
		})
	})

	test('a dropped link becomes a square card named after its site', async ({ page }) => {
		await dropUrl(page, 'https://en.wikipedia.org/wiki/Whiteboard')

		await expect.poll(async () => await countShapes(page, 'bookmark')).toBe(1)
		expect(await countShapes(page, 'node.markdown')).toBe(0)
		const card = await theCard(page)
		expect(card.props.url).toBe('https://en.wikipedia.org/wiki/Whiteboard')
		expect(card.props.w).toBe(card.props.h)

		const shown = page.locator('.lb-linkcard')
		await expect(shown.locator('.lb-linkcard__title')).toHaveText('en.wikipedia.org')
		await expect(shown.locator('.lb-linkcard__domain-text')).toHaveText('en.wikipedia.org')
		// The corner says it's a link and takes no clicks.
		await expect(shown.locator('.lb-linkcard__badge')).toHaveCSS('pointer-events', 'none')
	})

	test('a click anywhere on the card opens the link, and a drag moves it instead', async ({ page }) => {
		await dropUrl(page, 'https://example.com/page')
		await expect.poll(async () => await countShapes(page, 'bookmark')).toBe(1)
		await page.evaluate(() => (window as unknown as { editor: CardEditor }).editor.selectNone())

		const box = (await page.locator('.lb-linkcard').boundingBox())!
		// Near the bottom-left corner, far from the badge.
		await page.mouse.click(box.x + 20, box.y + box.height - 20)
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
			.toEqual(['https://example.com/page'])
		expect(await page.evaluate(() => (window as unknown as { editor: CardEditor }).editor.getSelectedShapeIds())).toEqual([])

		const before = await theCard(page)
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
		await page.mouse.down()
		await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 8 })
		await page.mouse.up()
		const after = await theCard(page)
		expect(after.x - before.x).toBeCloseTo(80, 0)
		expect(await page.evaluate(() => (window as unknown as { editor: CardEditor }).editor.getSelectedShapeIds())).toEqual([after.id])
		// Still only the one click's link.
		await page.waitForTimeout(600)
		expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toHaveLength(1)
	})

	test('a double-click opens the inspector, which names the card', async ({ page }) => {
		await dropUrl(page, 'https://example.com/page')
		await expect.poll(async () => await countShapes(page, 'bookmark')).toBe(1)

		await page.locator('.lb-linkcard').dblclick()
		const inspector = page.getByRole('dialog', { name: 'Link preview' })
		await expect(inspector).toBeVisible()
		await inspector.getByRole('textbox', { name: 'Title' }).fill('The plan')
		await expect(page.locator('.lb-linkcard__title')).toHaveText('The plan')

		await page.keyboard.press('Escape')
		await expect(inspector).toBeHidden()
		await page.waitForTimeout(600)
		expect(await page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([])
	})
})
