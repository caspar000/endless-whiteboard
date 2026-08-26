import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, noteMarkdown, openSettings, skipFirstRunDemo } from './helpers'

/**
 * Extensions that add *behaviour* rather than capability.
 *
 * Two contracts, on purpose (see node-kit's `hooks.ts`): a **reaction** — every enabled hook runs,
 * none can claim — and a **claim**, where exactly one extension gets the dropped content. The link
 * import below is the claiming kind; the property merge that fires on paste is the reacting kind.
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

/** The property values on the first note, keyed by property id. */
async function noteProperties(page: Page): Promise<Record<string, unknown>> {
	return page.evaluate(() => {
		const editor = (
			window as unknown as {
				editor?: {
					getCurrentPageShapes(): { type: string; meta: Record<string, unknown> }[]
				}
			}
		).editor
		if (!editor) throw new Error('window.editor is not exposed')
		const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')
		return (note?.meta['lifeboard:props'] as Record<string, unknown>) ?? {}
	})
}

test.describe('extension behaviour', () => {
	test('a dropped link becomes a note that carries it as a property', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await dropUrl(page, 'https://en.wikipedia.org/wiki/Whiteboard')

		// A note, not tldraw's bookmark card: a card cannot carry a property, join a table or stand in
		// a view, which is most of what content is for here.
		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(1)
		expect(await countShapes(page, 'bookmark')).toBe(0)

		// The title is the host — no network is involved, and a browser cannot read a cross-origin
		// <title> anyway.
		expect(await noteMarkdown(page)).toBe(
			'[en.wikipedia.org](https://en.wikipedia.org/wiki/Whiteboard)'
		)

		// And the value is really on the shape, in markdown's own link form.
		const props = await noteProperties(page)
		expect(Object.values(props)).toContain(
			'[en.wikipedia.org](https://en.wikipedia.org/wiki/Whiteboard)'
		)
	})

	test('switching the extension off returns links to the canvas', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openSettings(page, 'Extensions')
		// The claim is checked at drop time, so this takes effect without a reload.
		await page.locator('.lb-extmarket__card', { hasText: 'Markdown notes' })
			.getByRole('checkbox')
			.uncheck()

		await page.getByRole('tab', { name: 'Untitled board' }).click()
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))

		await dropUrl(page, 'https://example.com/')
		// tldraw's own handling again — whatever it makes of it, it is not one of our notes.
		await expect
			.poll(async () => await countShapes(page, 'node.markdown'), { timeout: 5000 })
			.toBe(0)
	})

	test('the extension page says what behaviour it adds', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await page.goto('/#/settings/extensions/lifeboard.note-markdown')
		await expect(page.getByRole('heading', { level: 1, name: 'Markdown notes' })).toBeVisible()
		// The page's premise is that the manifest describes the extension, so a contribution that
		// changes what dropping something does cannot be missing from it.
		await expect(page.getByText('Dropped links and text')).toBeVisible()
		await expect(
			page.locator('.lb-extpage__item', { hasText: 'Claims links and pasted text' })
		).toHaveCount(1)
	})
})
