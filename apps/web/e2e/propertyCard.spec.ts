import { expect, test, type Page } from '@playwright/test'
import { clickInSidebar, createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

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

/** Notes carrying a select and a price, on a fresh board: one by default, side by side. */
async function pricedNote(page: Page, count = 1) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await page.evaluate((count) => {
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
		editor.createShapes(
			Array.from({ length: count }, (_, i) => ({
				type: 'node.markdown',
				x: 200 + i * 400,
				y: 150,
				props: { md: i ? `Note ${i + 1}` : 'Locked bedroom door', w: 300 },
				meta: { 'lifeboard:props': { type: 'EVENT', price: 420, description: null } },
			}))
		)
	}, count)
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

/** Right-click → Edit card layout…, which opens the properties panel on its Display tab. */
async function openDisplayTab(page: Page, note = 0) {
	// By coordinates: a shape's DOM doesn't take pointer events, the canvas does.
	const box = (await page.locator('.lb-board-host:not([data-hidden]) .lb-note').nth(note).boundingBox())!
	await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
	await page.getByRole('menuitem', { name: 'Edit card layout…' }).click()
	const panel = page.locator('.lb-props')
	await expect(panel.getByRole('tab', { name: 'Display' })).toHaveAttribute('aria-selected', 'true')
	return panel
}

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
		const display = await openDisplayTab(page)
		await display.getByRole('button', { name: 'Edit as YAML' }).click()
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

test.describe('the Display tab', () => {
	test('builds a layout by hand: customise, style an element, add one, drag one to another slot', async ({
		page,
	}) => {
		const card = await pricedNote(page)
		const panel = await openDisplayTab(page)
		await expect(panel).toContainText('automatic layout')
		await panel.getByRole('button', { name: 'Customise' }).click()
		await expect(card.locator('.lb-layout')).toBeVisible()

		// Rows from the automatic layout: the price's meta row first, then the badge row.
		await panel.getByRole('button', { name: /^Price/ }).click()
		await panel.getByRole('button', { name: 'XL' }).click()
		await panel.getByRole('button', { name: 'Bold' }).click()
		await panel.getByLabel('Decimals of Price').fill('0')
		await expect(card.locator('.lb-el--xl.lb-el--bold')).toHaveText('₾ 420')

		await panel.getByLabel('Add to row 1, right').selectOption({ label: 'Text' })
		await expect(card.locator('.lb-layout__row').first().locator('.lb-layout__slot--right')).toContainText('Label')

		// Drag the badge up into row 1's centre.
		await panel.getByRole('button', { name: /^Type/ }).dragTo(panel.locator('.lb-display__row').first().locator('.lb-display__slot').nth(1))
		await expect(card.locator('.lb-layout__row').first().locator('.lb-layout__slot--center .lb-chip')).toHaveText('EVENT')
		await page.screenshot({ path: test.info().outputPath('display-tab.png') })

		await panel.getByRole('button', { name: 'Use automatic' }).click()
		await expect(card.locator('.lb-strip--display')).toBeVisible()
	})

	test('edits several cards at once, and offers to match them when they differ', async ({ page }) => {
		const cards = await pricedNote(page, 2)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(...editor.getCurrentPageShapes().map((s) => s.id))
		})
		const panel = await openDisplayTab(page)
		await expect(panel.getByRole('tab', { name: 'Data' })).toBeDisabled()
		await expect(panel).toContainText('These 2 cards use the automatic layout')
		await panel.getByRole('button', { name: 'Customise' }).click()
		await expect(cards.locator('.lb-layout')).toHaveCount(2)

		await panel.getByRole('button', { name: /^Price/ }).click()
		await panel.getByRole('button', { name: 'XL' }).click()
		await expect(cards.locator('.lb-el--xl')).toHaveCount(2)

		// Change only the first, then select both again: they now differ.
		await page.keyboard.press('Escape')
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(editor.getCurrentPageShapes()[0]!.id)
		})
		const single = await openDisplayTab(page)
		await single.getByRole('button', { name: /^Price/ }).click()
		await single.getByRole('button', { name: 'S', exact: true }).click()
		await expect(cards.locator('.lb-el--xl')).toHaveCount(1)
		await page.keyboard.press('Escape')

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(...editor.getCurrentPageShapes().map((s) => s.id))
		})
		const both = await openDisplayTab(page)
		await expect(both).toContainText('These 2 cards have different layouts')
		await both.getByRole('button', { name: 'Use this card’s layout on all' }).click()
		await expect(cards.locator('.lb-el--s')).toHaveCount(2)
	})
})

test.describe('reusing layouts', () => {
	const YAML = 'rows:\n  - center: { property: Price, size: xl, weight: bold }\n'

	async function giveFirstCardALayout(page: Page) {
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(editor.getCurrentPageShapes()[0]!.id)
		})
		const display = await openDisplayTab(page)
		await display.getByRole('button', { name: 'Edit as YAML' }).click()
		await page.locator('.lb-layout-editor .cm-content').click()
		await page.keyboard.press('ControlOrMeta+A')
		await page.keyboard.insertText(YAML)
		await page.getByRole('dialog', { name: 'Card layout' }).getByRole('button', { name: 'Done' }).click()
	}

	test('saves a layout to the library and applies it to another card', async ({ page }) => {
		const cards = await pricedNote(page, 2)
		await giveFirstCardALayout(page)
		await expect(cards.locator('.lb-el--xl')).toHaveCount(1)

		const first = await openDisplayTab(page, 0)
		await first.getByRole('button', { name: 'Save this layout…' }).click()
		await first.getByLabel('Name for the saved layout').fill('Event card')
		await first.getByRole('button', { name: 'Save', exact: true }).click()
		await expect(first.locator('.lb-display__saved-name')).toHaveText('Event card')
		await page.keyboard.press('Escape')

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.select(editor.getCurrentPageShapes()[1]!.id)
		})
		const second = await openDisplayTab(page, 1)
		await second.locator('.lb-display__saved').filter({ hasText: 'Event card' }).getByRole('button', { name: 'Apply' }).click()
		await expect(cards.locator('.lb-el--xl')).toHaveCount(2)

		// It follows the vault (here: this device's cache), not the board.
		const stored = await page.evaluate(() => localStorage.getItem('lifeboard:cardLayouts'))
		expect(stored).toContain('Event card')
	})

	test('applies a card’s layout to the cards with exactly the same properties', async ({ page }) => {
		const cards = await pricedNote(page, 2)
		await giveFirstCardALayout(page)
		await expect(cards.locator('.lb-el--xl')).toHaveCount(1)
		await page.keyboard.press('Escape')
		// A third note carries one property more, so it doesn't match.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 200,
					y: 500,
					props: { md: 'Note 3', w: 300 },
					meta: { 'lifeboard:props': { type: 'EVENT', price: 420, description: null, extra: 'x' } },
				},
			])
		})

		// Store and DOM order both shift as shapes are added, so find the card with the layout itself.
		const at = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.meta['lifeboard:propLayout'])!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		})
		await page.mouse.click(at.x, at.y, { button: 'right' })
		await page.getByRole('menuitem', { name: 'Edit card layout…' }).click()
		const display = page.locator('.lb-props')
		await display.getByRole('button', { name: 'Apply to 1 matching card' }).click()
		await expect(cards.locator('.lb-el--xl')).toHaveCount(2)
		await expect(cards).toHaveCount(3)
		// Everything matching now looks the same, so the button goes.
		await expect(display.getByRole('button', { name: /matching/ })).toHaveCount(0)
	})

	test('copies a card’s layout and pastes it onto another', async ({ page }) => {
		const cards = await pricedNote(page, 2)
		await giveFirstCardALayout(page)
		await page.keyboard.press('Escape')

		const notes = page.locator('.lb-board-host:not([data-hidden]) .lb-note')
		const box = async (i: number) => (await notes.nth(i).boundingBox())!
		const a = await box(0)
		await page.mouse.click(a.x + a.width / 2, a.y + a.height / 2, { button: 'right' })
		await page.getByRole('menuitem', { name: 'Copy card layout' }).click()

		const b = await box(1)
		await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2)
		await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2, { button: 'right' })
		await page.getByRole('menuitem', { name: 'Paste card layout' }).click()
		await expect(cards.locator('.lb-el--xl')).toHaveCount(2)
	})
})

test('Help shows the card under each shape, and a layout beside the YAML that draws it', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await clickInSidebar(page, 'Help')
	await page.getByRole('button', { name: 'Properties', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Laying out a card' })).toBeVisible()
	await expect(page.locator('.lb-help__layout-card .lb-el--xl')).toHaveText('₾ 2,399')
	await expect(page.locator('.lb-ex__propcard').first()).toBeVisible()
	await page.locator('.lb-help__layout-example').screenshot({ path: test.info().outputPath('help-layout.png') })
	await page.locator('.lb-ex__board').screenshot({ path: test.info().outputPath('help-board.png') })
})
