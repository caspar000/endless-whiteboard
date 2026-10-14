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
					{ id: 'description', name: 'Description', type: 'text' },
				],
			},
		})
		editor.createShapes([
			{
				type: 'node.markdown',
				x: 200,
				y: 150,
				props: { md: 'Locked bedroom door', w: 300 },
				meta: { 'lifeboard:props': { type: 'EVENT', price: 420, description: null } },
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
		await expect(card.locator('.lb-strip__name')).toHaveText(['Type', 'Price', 'Description'])
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

test.describe('the card layout editor', () => {
	const LAYOUT = [
		'width: 300',
		'rows:',
		'  - center: { property: Price, size: xl, weight: bold }',
		'    right: { property: Type, as: badge }',
		'  - separator',
		'  - left: { property: Description, size: s }',
		'  - left: { text: Featured, size: s }',
		'',
	].join('\n')

	async function openEditor(page: Page) {
		// By coordinates: a shape's DOM doesn't take pointer events, the canvas does.
		const box = (await page.locator('.lb-board-host:not([data-hidden]) .lb-note').first().boundingBox())!
		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
		await page.getByRole('menuitem', { name: 'Edit card layout…' }).click()
		const panel = page.getByRole('dialog', { name: 'Card layout' })
		await expect(panel).toBeVisible()
		return panel
	}

	async function replaceText(page: Page, text: string) {
		await page.locator('.lb-layout-editor .cm-content').click()
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.insertText(text)
	}

	test('starts from the automatic layout, and the card follows what you type', async ({ page }) => {
		const card = await pricedNote(page)
		const panel = await openEditor(page)
		await expect(panel.locator('.cm-content')).toContainText('property: Type')

		await replaceText(page, LAYOUT)
		await expect(card.locator('.lb-layout .lb-el--xl')).toHaveText('₾ 420.00')
		await expect(card.locator('.lb-layout__slot--right .lb-chip')).toHaveText('EVENT')
		// The description is empty, so its row goes; the label row stays, and so does the separator
		// between two drawn rows.
		await expect(card).not.toContainText('Description')
		await expect(card).toContainText('Featured')
		await expect(card.locator('.lb-layout__rule')).toHaveCount(1)
		expect(Math.round((await card.boundingBox())!.width)).toBe(300)
		await page.screenshot({ path: test.info().outputPath('layout.png') })

		// A mistake shows its line and leaves the card as it was.
		await replaceText(page, 'rows:\n  - left: { property: Prise }\n')
		await expect(panel.locator('.lb-layout-editor__error')).toContainText('Line 2')
		await expect(panel.locator('.lb-layout-editor__error')).toContainText('No property called “Prise”')
		await expect(card.locator('.lb-el--xl')).toHaveText('₾ 420.00')
		await page.screenshot({ path: test.info().outputPath('error.png') })

		await replaceText(page, LAYOUT)
		await panel.getByRole('button', { name: 'Done' }).click()
		await expect(panel).toBeHidden()
		await expect(card.locator('.lb-layout')).toBeVisible()

		// The whole editing session is one undo step.
		await page.keyboard.press('ControlOrMeta+Z')
		await expect(card.locator('.lb-layout')).toHaveCount(0)
		await expect(card.locator('.lb-strip--display')).toBeVisible()
	})

	test('Cancel puts the card back as it was', async ({ page }) => {
		const card = await pricedNote(page)
		const panel = await openEditor(page)
		await replaceText(page, LAYOUT)
		await expect(card.locator('.lb-layout')).toBeVisible()
		await panel.getByRole('button', { name: 'Cancel' }).click()
		await expect(panel).toBeHidden()
		await expect(card.locator('.lb-layout')).toHaveCount(0)
		await expect(card.locator('.lb-strip--display')).toBeVisible()
	})
})
