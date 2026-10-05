import { expect, test } from '@playwright/test'

/** Phase 5 of docs/canvas-fork-plan.md: the composable context menu still opens on the canvas. */

type Editor = {
	createShapes(shapes: object[]): void
	getShapePageBounds(id: string): { center: { x: number; y: number } }
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	getShape(id: string): object | undefined
}

test('right-clicking a shape opens the standard context menu, and its actions work', async ({ page }) => {
	await page.goto(`/?board=ui-${Date.now()}`)
	await page.waitForFunction(() => 'editor' in window)
	const point = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		editor.createShapes([{ id: 'shape:box', type: 'geo', x: 200, y: 200, props: { w: 120, h: 80 } }])
		return editor.pageToScreen(editor.getShapePageBounds('shape:box').center)
	})
	await page.mouse.click(point.x, point.y)
	await page.mouse.click(point.x, point.y, { button: 'right' })
	const menu = page.locator('.tlui-menu')
	await expect(menu).toBeVisible()
	await menu.locator('[data-testid="menu-item.delete"]').click()
	await expect
		.poll(() => page.evaluate(() => !!(window as unknown as { editor: Editor }).editor.getShape('shape:box')))
		.toBe(false)
})
