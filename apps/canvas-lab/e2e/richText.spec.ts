import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 4 of docs/canvas-fork-plan.md: every text-bearing shape is edited as rich text, formatting
 * from the toolbar survives a reload, and an extension passed through `textOptions` works in labels.
 */

type Shape = { id: string; type: string; props: { richText: unknown } }
type Editor = {
	createShapes(shapes: object[]): void
	getShape(id: string): Shape | undefined
	getShapePageBounds(id: string): { center: { x: number; y: number }; midX: number; maxY: number }
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	getEditingShapeId(): string | null
	getCurrentPageShapes(): Shape[]
}


/** Where to double-click to edit a shape: its centre, or for an arrow a point on its line clear of
 * the bend handle in the middle. */
async function screenPoint(page: Page, id: string) {
	return page.evaluate((shapeId) => {
		const editor = (window as unknown as { editor: Editor }).editor
		const bounds = editor.getShapePageBounds(shapeId)
		const isArrow = editor.getShape(shapeId)?.type === 'arrow'
		return editor.pageToScreen(isArrow ? { x: bounds.midX - 75, y: bounds.center.y } : bounds.center)
	}, id)
}

/** Starts editing a shape the way a person does: double-click it. */
async function startEditing(page: Page, id: string) {
	const point = await screenPoint(page, id)
	await page.mouse.dblclick(point.x, point.y)
	await expect.poll(() => page.evaluate((shapeId) => (window as unknown as { editor: Editor }).editor.getEditingShapeId() === shapeId, id)).toBe(true)
	await expect(page.locator('.tl-rich-text-editor .ProseMirror')).toBeFocused()
}

async function stopEditing(page: Page) {
	await page.keyboard.press('Escape')
	await expect.poll(() => page.evaluate(() => (window as unknown as { editor: Editor }).editor.getEditingShapeId())).toBe(null)
	// Let the click counter reset, or the next double-click counts as a third and fourth click.
	await page.waitForTimeout(500)
}

const richText = (page: Page, id: string) =>
	page.evaluate((shapeId) => JSON.stringify((window as unknown as { editor: Editor }).editor.getShape(shapeId)?.props.richText), id)

test.beforeEach(async ({ page }) => {
	await page.goto(`/?board=rich-${Date.now()}`)
	await page.waitForFunction(() => 'editor' in window)
})

test('types into every text-bearing shape', async ({ page }) => {
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		editor.createShapes([
			{ id: 'shape:note', type: 'note', x: 100, y: 100 },
			{ id: 'shape:geo', type: 'geo', x: 400, y: 100, props: { w: 200, h: 120 } },
			{ id: 'shape:text', type: 'text', x: 100, y: 400, props: { richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] } } },
			{ id: 'shape:arrow', type: 'arrow', x: 400, y: 400, props: { start: { x: 0, y: 0 }, end: { x: 300, y: 0 } } },
		])
	})

	for (const id of ['shape:note', 'shape:geo', 'shape:text', 'shape:arrow']) {
		await startEditing(page, id)
		// Everything starts selected, so typing replaces it.
		await page.keyboard.type(`Hello ${id.slice(6)}`)
		await stopEditing(page)
		expect(await richText(page, id)).toContain(`"text":"Hello ${id.slice(6)}"`)
	}
	// Drawn as rich text once editing ends.
	await expect(page.locator('.tl-text-content.tl-rich-text', { hasText: 'Hello note' })).toBeVisible()
})

test('bold and a list from the toolbar survive a reload', async ({ page }) => {
	await page.evaluate(() => {
		;(window as unknown as { editor: Editor }).editor.createShapes([{ id: 'shape:geo', type: 'geo', x: 200, y: 200, props: { w: 240, h: 160 } }])
	})
	await startEditing(page, 'shape:geo')
	await page.keyboard.type('Strong words')
	await page.keyboard.press('ControlOrMeta+a')
	await page.locator('.tlui-rich-text-toolbar__button[data-format="bold"]').click()
	await expect(page.locator('.tlui-rich-text-toolbar__button[data-format="bold"]')).toHaveAttribute('data-active', 'true')
	await page.keyboard.press('End')
	await page.keyboard.press('Enter')
	await page.locator('.tlui-rich-text-toolbar__button[data-format="bullet-list"]').click()
	await page.keyboard.type('a point')
	// Editing kept its focus through both clicks.
	await expect(page.locator('.tl-rich-text-editor .ProseMirror')).toBeFocused()
	await stopEditing(page)

	const saved = await richText(page, 'shape:geo')
	expect(saved).toContain('"type":"bold"')
	expect(saved).toContain('"type":"bulletList"')

	await page.waitForTimeout(800)
	await page.reload()
	await page.waitForFunction(() => 'editor' in window)
	await expect.poll(() => richText(page, 'shape:geo')).toBe(saved)
	await expect(page.locator('.tl-text-content strong', { hasText: 'Strong words' })).toBeVisible()
	await expect(page.locator('.tl-text-content ul li', { hasText: 'a point' })).toBeVisible()
})

test('after editing, undo takes the whole edit; while typing, undo is the text’s own', async ({ page }) => {
	await page.evaluate(() => {
		;(window as unknown as { editor: Editor }).editor.createShapes([{ id: 'shape:note', type: 'note', x: 200, y: 200 }])
	})
	await startEditing(page, 'shape:note')
	await page.keyboard.type('one')
	await stopEditing(page)
	expect(await richText(page, 'shape:note')).toContain('"text":"one"')
	await page.keyboard.press('ControlOrMeta+z')
	await expect.poll(() => richText(page, 'shape:note')).not.toContain('"text":"one"')
	await page.keyboard.press('ControlOrMeta+Shift+z')
	await expect.poll(() => richText(page, 'shape:note')).toContain('"text":"one"')
	// A person's pause between the shortcut and the next double-click.
	await page.waitForTimeout(300)

	await startEditing(page, 'shape:note')
	await page.keyboard.press('End')
	await page.keyboard.type(' two')
	await expect.poll(() => richText(page, 'shape:note')).toContain('"text":"one two"')
	await page.keyboard.press('ControlOrMeta+z')
	await expect.poll(() => richText(page, 'shape:note')).toContain('"text":"one"')
	await expect(page.locator('.tl-rich-text-editor .ProseMirror')).toBeFocused()
	await stopEditing(page)
})

test('an extension passed through textOptions works in a label', async ({ page }) => {
	await page.evaluate(() => {
		;(window as unknown as { editor: Editor }).editor.createShapes([{ id: 'shape:note', type: 'note', x: 200, y: 200 }])
	})
	await startEditing(page, 'shape:note')
	await expect(page.locator('.lab-menu')).toHaveCount(0)
	await page.keyboard.type('ask @')
	await expect(page.locator('.lab-menu')).toBeVisible()
	await page.keyboard.type('x')
	await expect(page.locator('.lab-menu')).toHaveCount(0)
})
