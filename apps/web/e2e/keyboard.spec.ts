import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

interface EditorHandle {
	createShapes(shapes: unknown[]): void
	getSelectedShapeIds(): string[]
	getShape(id: string): { props: { w: number } } | undefined
	setCamera(c: { x: number; y: number; z: number }): void
	selectNone(): void
}

const selected = (page: Page) =>
	page.evaluate(() => (window as unknown as { editor: EditorHandle }).editor.getSelectedShapeIds())

test.describe('keyboard navigation (A1)', () => {
	test('Tab, ⌘-arrows and Alt+Shift-arrows work the board without leaving it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:a', type: 'geo', x: 100, y: 100, props: { w: 120, h: 80 } },
				{ id: 'shape:b', type: 'geo', x: 400, y: 100, props: { w: 120, h: 80 } },
				{ id: 'shape:c', type: 'geo', x: 100, y: 400, props: { w: 120, h: 80 } },
			])
			editor.selectNone()
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		// Focus the board the way a person does, by clicking empty canvas.
		await page.locator('.lb-board-host:not([data-hidden]) .tl-canvas').click({ position: { x: 700, y: 600 } })

		await page.keyboard.press('Tab')
		expect(await selected(page)).toEqual(['shape:a'])
		await page.keyboard.press('Tab')
		expect(await selected(page)).toEqual(['shape:b'])
		await page.keyboard.press('Shift+Tab')
		expect(await selected(page)).toEqual(['shape:a'])
		// Focus stayed on the board rather than moving to the next button.
		expect(await page.evaluate(() => !!document.activeElement?.closest('.tl-container'))).toBe(true)

		await page.keyboard.press('ControlOrMeta+ArrowDown')
		expect(await selected(page)).toEqual(['shape:c'])
		await page.keyboard.press('Alt+Shift+ArrowRight')
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { editor: EditorHandle }).editor.getShape('shape:c')!.props.w))
			.toBe(130)
	})
})
