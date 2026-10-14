import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * The property card (docs/property-display-plan.md, phase 1): a shape's properties hang below it on a
 * card of their own, in display or source mode, and the card acts as part of its shape.
 */

interface EditorHandle {
	getCurrentPageShapes(): { id: string; type: string; x: number; y: number; meta: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	createShapes(shapes: unknown[]): void
	updateDocumentSettings(settings: { meta: Record<string, unknown> }): void
	select(...ids: string[]): void
	selectNone(): void
	getSelectedShapeIds(): string[]
}

/** A note carrying a select and a price, on a fresh board. */
async function pricedNote(page: Page) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		editor.updateDocumentSettings({
			meta: {
				'lifeboard:properties': [
					{ id: 'type', name: 'Type', type: 'select', options: ['EVENT'] },
					{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
				],
			},
		})
		editor.createShapes([
			{
				type: 'node.markdown',
				x: 200,
				y: 150,
				props: { md: 'Locked bedroom door', w: 300 },
				meta: { 'lifeboard:props': { type: 'EVENT', price: 420 } },
			},
		])
	})
	return page.locator('.lb-board-host:not([data-hidden]) .lb-prop-card')
}

test.describe('the property card', () => {
	test('hangs below the note, not inside it, and toggles between display and source', async ({ page }) => {
		const card = await pricedNote(page)
		await expect(card).toHaveCount(1)

		const note = page.locator('.lb-board-host:not([data-hidden]) .lb-note').first()
		await expect(note.locator('.lb-strip')).toHaveCount(0)
		const noteBox = (await note.boundingBox())!
		const cardBox = (await card.boundingBox())!
		expect(cardBox.y).toBeGreaterThanOrEqual(noteBox.y + noteBox.height)
		// Centred under the note, at its own width rather than the note's.
		expect(Math.abs(cardBox.x + cardBox.width / 2 - (noteBox.x + noteBox.width / 2))).toBeLessThan(2)
		expect(Math.abs(cardBox.width - noteBox.width)).toBeGreaterThan(20)

		// Display: the badge and the value, no names.
		await expect(card.locator('.lb-strip--display .lb-chip')).toHaveText('EVENT')
		await expect(card).toContainText('₾ 420.00')
		await expect(card).not.toContainText('Price')
		await page.screenshot({ path: test.info().outputPath('display.png') })

		// Source: every property with its name.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(editor.getCurrentPageShapes()[0]!.id)
		})
		await page.keyboard.press('Alt+Shift+P')
		await expect(card.locator('.lb-strip__name')).toHaveText(['Type', 'Price'])
		await page.screenshot({ path: test.info().outputPath('source.png') })

		// And back.
		await page.keyboard.press('Alt+Shift+P')
		await expect(card.locator('.lb-strip--display')).toBeVisible()
	})

	test('pressing the card selects its shape, and dragging it moves the shape', async ({ page }) => {
		const card = await pricedNote(page)
		await expect(card).toHaveCount(1)
		await page.evaluate(() => (window as unknown as { editor: EditorHandle }).editor.selectNone())

		const box = (await card.boundingBox())!
		const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
		await page.mouse.click(start.x, start.y)
		const selected = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			return editor.getSelectedShapeIds()
		})
		expect(selected).toHaveLength(1)

		const before = await page.evaluate(
			() => (window as unknown as { editor: EditorHandle }).editor.getCurrentPageShapes()[0]!.x
		)
		await page.mouse.move(start.x, start.y)
		await page.mouse.down()
		await page.mouse.move(start.x + 60, start.y, { steps: 6 })
		await page.mouse.move(start.x + 120, start.y, { steps: 6 })
		await page.mouse.up()
		const after = await page.evaluate(
			() => (window as unknown as { editor: EditorHandle }).editor.getCurrentPageShapes()[0]!.x
		)
		expect(after - before).toBeGreaterThan(80)
	})

	test('a shape with nothing set has no card', async ({ page }) => {
		const card = await pricedNote(page)
		await expect(card).toHaveCount(1)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 700,
					y: 150,
					props: { md: 'Empty', w: 300 },
					meta: { 'lifeboard:props': { type: null, price: null } },
				},
			])
		})
		await expect(card).toHaveCount(2)
		await expect(card.filter({ hasText: '₾' })).toBeVisible()
		await expect(card.filter({ hasNotText: '₾' })).toBeHidden()
	})
})
