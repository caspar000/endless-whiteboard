import { expect, test, type Page } from '@playwright/test'
import { makeRarArchive, PIXEL_GIF } from '@lifeboard/book-reader/rar-fixture'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * CBR: the one book container the app unpacks for itself.
 *
 * Worth an end-to-end test rather than only the unit ones in the package, because the interesting
 * failure is not in the decompressor — that is covered next to it — but in getting the decompressor
 * to the browser at all. unrar is wasm, reaching the page as an asset emitted from Vite's `?url`,
 * and this suite runs against the **production build**: exactly the seam where "works in dev" stops
 * meaning anything.
 */

/** A comic, as a real RAR. See `rar-fixture` for why the archive is written out by hand. */
function comicBytes(pages: number): number[] {
	return [
		...makeRarArchive([
			// Deliberately out of reading order, and carrying the metadata file comic packers leave
			// behind: what lands on the card should be page one, not the first thing in the archive.
			{ name: 'ComicInfo.xml', data: new TextEncoder().encode('<ComicInfo/>') },
			...Array.from({ length: pages }, (_, index) => ({
				name: `page${pages - index}.jpg`,
				data: PIXEL_GIF,
			})),
		]),
	]
}

async function dropComic(page: Page, name: string, pages: number): Promise<void> {
	await page.evaluate(
		async ({ bytes, name }) => {
			const file = new File([Uint8Array.from(bytes)], name)
			const editor = (
				window as unknown as { editor: { putExternalContent(input: unknown): Promise<void> } }
			).editor
			await editor.putExternalContent({ type: 'files', files: [file], point: { x: 250, y: 200 } })
		},
		{ bytes: comicBytes(pages), name }
	)
}

/**
 * Opens the book the drop just left selected.
 *
 * The card's centre, not `dblclickNode`'s top edge: at this zoom a card dropped near the top of the
 * page has its first few rows behind the tab strip, and the click lands on the app rather than the
 * board. The extra single click is what a person does anyway — reach the card, then open it.
 */
async function openReader(page: Page): Promise<void> {
	const point = await page.evaluate(() => {
		const editor = (
			window as unknown as {
				editor: {
					getCurrentPageShapes(): { id: string; type: string }[]
					getShapePageBounds(id: string): { x: number; y: number; w: number; h: number }
					pageToScreen(p: { x: number; y: number }): { x: number; y: number }
				}
			}
		).editor
		const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.book')
		if (!shape) throw new Error('No book on the board')
		const bounds = editor.getShapePageBounds(shape.id)
		return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
	})
	await page.mouse.click(point.x, point.y)
	await page.mouse.dblclick(point.x, point.y)
}

/** The page count as the property system stores it — the value a table or rollup would count. */
function storedPageCount(page: Page): Promise<unknown> {
	return page.evaluate(() => {
		const editor = (
			window as unknown as { editor: { getCurrentPageShapes(): { type: string; meta: unknown }[] } }
		).editor
		const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.book')
		const props = (shape?.meta as { 'lifeboard:props'?: Record<string, unknown> } | undefined)?.[
			'lifeboard:props'
		]
		return props?.pages
	})
}

test.describe('comic books', () => {
	test.beforeEach(async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Comics')
		await openBoard(page, 'Comics')
	})

	test('a dropped CBR becomes a card with its first page as the cover', async ({ page }) => {
		await dropComic(page, 'Watchmen_01.cbr', 5)

		const cover = page.locator('.lb-board-host:not([data-hidden]) .lb-book__cover')
		// The cover is rendered from inside the archive, so its presence is the whole claim: the RAR
		// was opened, the pages were found, and one of them was decompressed.
		await expect(cover).toBeVisible()
		// A comic archive carries no metadata, so the title stays the one the file name gave it.
		await expect(cover).toHaveAttribute('alt', 'Watchmen 01')

		// Pages is data about the book, not reader state, so it lands in the property system.
		await page.keyboard.press('Alt+p')
		await expect(page.locator('.lb-props')).toContainText('Pages')
		expect(await storedPageCount(page)).toBe(5)
	})

	/**
	 * Resizing a book, which is the one gesture its two halves can disagree during.
	 *
	 * The card is a picture and its height is auto-derived from the cover, so a resize that changed
	 * only the width put the height back to where the drag started on every pointer move while
	 * auto-height corrected it a frame later. On screen: a cover clipped by a card too short for it,
	 * and a property strip — which hangs off the bottom edge — jumping on every frame. The fix is to
	 * scale both axes together, so this asserts the proportions *during* the drag, not just after it.
	 */
	test('resizing a book keeps its cover and its properties with the card', async ({ page }) => {
		await dropComic(page, 'Resize_me.cbr', 3)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-book__cover')).toBeVisible()

		const size = (): Promise<{ w: number; h: number }> =>
			page.evaluate(() => {
				const editor = (
					window as unknown as {
						editor: {
							getCurrentPageShapes(): { id: string; type: string; props: { w: number; h: number } }[]
						}
					}
				).editor
				const book = editor.getCurrentPageShapes().find((s) => s.type === 'node.book')!
				return { w: book.props.w, h: book.props.h }
			})

		// The fixture's page is a single pixel, so a settled card is square give or take its border.
		await expect.poll(async () => Math.round((await size()).h)).toBeLessThan(240)
		const start = await size()
		const startRatio = start.h / start.w

		const corner = await page.evaluate(() => {
			const editor = (
				window as unknown as {
					editor: {
						getCurrentPageShapes(): { id: string; type: string }[]
						getShapePageBounds(id: string): { x: number; y: number; w: number; h: number }
						pageToScreen(p: { x: number; y: number }): { x: number; y: number }
						select(id: string): void
					}
				}
			).editor
			const book = editor.getCurrentPageShapes().find((s) => s.type === 'node.book')!
			editor.select(book.id)
			const b = editor.getShapePageBounds(book.id)
			return editor.pageToScreen({ x: b.x + b.w, y: b.y + b.h })
		})

		await page.mouse.move(corner.x, corner.y)
		await page.mouse.down()

		const ratios: number[] = []
		for (let step = 1; step <= 6; step++) {
			await page.mouse.move(corner.x + step * 30, corner.y + step * 30)
			const during = await size()
			ratios.push(during.h / during.w)
		}
		await page.mouse.up()

		// It actually resized, and stayed the same shape the whole way — the old behaviour halved the
		// ratio as the width ran ahead of the height.
		const end = await size()
		expect(end.w).toBeGreaterThan(start.w + 100)
		for (const ratio of ratios) expect(Math.abs(ratio - startRatio)).toBeLessThan(0.05)

		// And the properties are still sitting on the card's bottom edge rather than somewhere the
		// height used to be.
		const gap = await page.evaluate(() => {
			const host = document.querySelector('.lb-board-host:not([data-hidden])')!
			const card = host.querySelector('.lb-book')!.getBoundingClientRect()
			const strip = host.querySelector('.lb-foreign-strip')!.getBoundingClientRect()
			return strip.top - card.bottom
		})
		expect(Math.abs(gap)).toBeLessThan(6)
	})

	test('the reader pages through a CBR', async ({ page }) => {
		await dropComic(page, 'Watchmen_02.cbr', 4)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-book__cover')).toBeVisible()

		await openReader(page)
		const reader = page.locator('.lb-reader')
		await expect(reader).toBeVisible()
		await expect(reader.locator('.lb-reader__title')).toHaveText('Watchmen 02')

		// Every page in the archive, in reading order, is what a comic has instead of chapters — and
		// the order is the point, since page 10 must not sort between page 1 and page 2.
		await reader.getByTitle('Contents').click()
		await expect(reader.locator('.lb-reader__toc-item')).toHaveText([
			'page1.jpg',
			'page2.jpg',
			'page3.jpg',
			'page4.jpg',
		])
		await reader.getByTitle('Contents').click()

		/*
		 * Turning a page moves through the book.
		 *
		 * Asserted as "further than before" rather than as exact fractions: how far a page is through
		 * a book is foliate's own arithmetic over section sizes, not a number this app decides, and
		 * pinning it here would make the test a change-detector for someone else's rounding.
		 */
		const progress = reader.locator('.lb-reader__track')
		const at = async () => Number(await progress.getAttribute('aria-valuenow'))
		const start = await at()
		expect(start).toBeGreaterThan(0)

		await page.keyboard.press('ArrowRight')
		await expect.poll(at).toBeGreaterThan(start)
		const second = await at()

		await page.keyboard.press('ArrowRight')
		await expect.poll(at).toBeGreaterThan(second)
	})
})
