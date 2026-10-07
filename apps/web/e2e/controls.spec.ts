import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/** Phase 1 of the parity work in a real browser: I5, B9, B13 and X4 (docs/fork-parity.md). */

interface EditorHandle {
	getCurrentPageShapes(): { id: string; type: string; x: number; y: number; props: Record<string, unknown> }[]
	createShapes(shapes: unknown[]): void
	setCamera(camera: { x: number; y: number; z: number }): void
	getCamera(): { x: number; y: number; z: number }
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number; center: { x: number; y: number } }
	getSvg(ids: string[], opts?: { padding?: number | 'auto' }): Promise<SVGSVGElement | undefined>
	select(...ids: string[]): void
	getSelectedShapeIds(): string[]
}

const run = <T, A>(page: Page, fn: (editor: EditorHandle, arg: A) => T, arg?: A) =>
	page.evaluate(
		({ source, arg }) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			return new Function('editor', 'arg', `return (${source})(editor, arg)`)(editor, arg) as T
		},
		{ source: fn.toString(), arg }
	)

async function freshBoard(page: Page) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { editor?: unknown }).editor))).toBe(true)
	await run(page, (editor) => editor.setCamera({ x: 0, y: 0, z: 1 }))
}

test('a right drag pans; a right click still opens the menu (I5)', async ({ page }) => {
	await freshBoard(page)
	const canvas = page.locator('.tl-canvas:visible')
	const box = (await canvas.boundingBox())!
	const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

	await page.mouse.move(at.x, at.y)
	await page.mouse.down({ button: 'right' })
	await page.mouse.move(at.x + 60, at.y + 40, { steps: 6 })
	await page.mouse.move(at.x + 120, at.y + 80, { steps: 6 })
	await page.mouse.up({ button: 'right' })
	const camera = await run(page, (editor) => editor.getCamera())
	expect(camera.x).toBeGreaterThan(100)
	expect(camera.y).toBeGreaterThan(60)
	await expect(page.locator('.tlui-menu')).toHaveCount(0)

	await page.mouse.click(at.x, at.y, { button: 'right' })
	await expect(page.locator('.tlui-menu').first()).toBeVisible()
})

test('a shape pulled out of the dock lands where it is let go (B9)', async ({ page }) => {
	await freshBoard(page)
	const button = (await page.getByTestId('tools.note').boundingBox())!
	const target = await run(page, (editor) => editor.pageToScreen({ x: 300, y: 200 }))

	await page.mouse.move(button.x + button.width / 2, button.y + button.height / 2)
	await page.mouse.down()
	await page.mouse.move(button.x + button.width / 2, button.y - 40, { steps: 5 })
	await page.mouse.move(target.x, target.y, { steps: 10 })
	await page.mouse.up()

	const notes = await run(page, (editor) => editor.getCurrentPageShapes().filter((s) => s.type === 'note'))
	expect(notes).toHaveLength(1)
	const centre = await run(page, (editor, id: string) => editor.getShapePageBounds(id).center, notes[0]!.id)
	expect(centre.x).toBeCloseTo(300, -1)
	expect(centre.y).toBeCloseTo(200, -1)
	// Dropped, it's selected, and the dock didn't take the click as picking the note tool.
	expect(await run(page, (editor) => editor.getSelectedShapeIds())).toEqual([notes[0]!.id])
	await expect(page.getByTestId('tools.note')).toHaveAttribute('aria-pressed', 'false')
})

test('a note has corner handles, and scales from them (B13)', async ({ page }) => {
	await freshBoard(page)
	await run(page, (editor) => {
		editor.createShapes([{ id: 'shape:n', type: 'note', x: 100, y: 100 }])
		editor.select('shape:n')
	})
	const corner = await run(page, (editor) => editor.pageToScreen({ x: 300, y: 300 }))
	await page.mouse.move(corner.x, corner.y)
	await page.mouse.down()
	await page.mouse.move(corner.x + 50, corner.y + 50, { steps: 5 })
	await page.mouse.move(corner.x + 100, corner.y + 100, { steps: 5 })
	await page.mouse.up()
	const scale = await run(page, (editor) => editor.getCurrentPageShapes()[0]!.props.scale as number)
	expect(scale).toBeCloseTo(1.5, 1)
})

test('a trimmed export ends where the drawing does (X4)', async ({ page }) => {
	await freshBoard(page)
	const sizes = await page.evaluate(async () => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		editor.createShapes([
			{ id: 'shape:a', type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
			{ id: 'shape:b', type: 'geo', x: 300, y: 0, props: { w: 100, h: 100 } },
			{ id: 'shape:arrow', type: 'arrow', x: 100, y: 50, props: { start: { x: 0, y: 0 }, end: { x: 200, y: 0 } } },
		])
		const ids = ['shape:a', 'shape:b', 'shape:arrow']
		const width = async (padding?: number | 'auto') =>
			Number((await editor.getSvg(ids, padding === undefined ? {} : { padding }))!.getAttribute('width'))
		return { padded: await width(), trimmed: await width('auto') }
	})
	expect(sizes.padded).toBe(464)
	// The shapes' 400 and their strokes, no margin.
	expect(sizes.trimmed).toBeGreaterThan(400)
	expect(sizes.trimmed).toBeLessThan(420)
})
