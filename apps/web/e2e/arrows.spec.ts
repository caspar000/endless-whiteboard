import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

interface ArrowInfo {
	route?: { x: number; y: number }[]
}

interface EditorHandle {
	getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
	createShapes(shapes: unknown[]): void
	setCamera(camera: { x: number; y: number; z: number }): void
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	getArrowInfo(id: string): ArrowInfo | undefined
	getShapeHandles(id: string): { id: string; x: number; y: number }[] | undefined
	getShapePageTransform(id: string): { applyToPoint(p: { x: number; y: number }): { x: number; y: number } }
	select(...ids: string[]): void
	getBindingsFromShape(id: string, type: string): { toId: string }[]
}

const editorOf = (page: Page) =>
	page.evaluate(() => Boolean((window as unknown as { editor?: EditorHandle }).editor))

async function arrow(page: Page) {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		const shape = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')
		if (!shape) return null
		return {
			id: shape.id,
			kind: shape.props.kind,
			elbowMidPoint: shape.props.elbowMidPoint as number,
			// In page space, rounded: the route itself is in the arrow's own space.
			route:
				editor.getArrowInfo(shape.id)?.route?.map((point) => {
					const { x, y } = editor.getShapePageTransform(shape.id).applyToPoint(point)
					return { x: Math.round(x * 2) / 2, y: Math.round(y * 2) / 2 }
				}) ?? null,
			boundTo: editor.getBindingsFromShape(shape.id, 'arrow').map((b) => b.toId).sort(),
		}
	})
}

test.describe('elbow arrows (B1)', () => {
	test('are drawn from the dock, routed between shapes, and their middle run moves', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await expect.poll(() => editorOf(page)).toBe(true)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:a', type: 'geo', x: 100, y: 100, props: { w: 120, h: 80 } },
				{ id: 'shape:b', type: 'geo', x: 420, y: 300, props: { w: 120, h: 80 } },
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const screen = (x: number, y: number) =>
			page.evaluate(
				(p) => (window as unknown as { editor: EditorHandle }).editor.pageToScreen(p),
				{ x, y }
			)

		// The arrow tool's row offers the kind; elbow it is.
		await page.keyboard.press('a')
		await page.getByRole('button', { name: 'Elbow arrow' }).click()
		await expect(page.getByRole('button', { name: 'Elbow arrow' })).toHaveAttribute('aria-pressed', 'true')

		const from = await screen(160, 140)
		const to = await screen(480, 340)
		await page.mouse.move(from.x, from.y)
		await page.mouse.down()
		await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
		await page.mouse.move(to.x, to.y, { steps: 5 })
		await page.mouse.up()

		const drawn = await arrow(page)
		expect(drawn).toMatchObject({ kind: 'elbow', boundTo: ['shape:a', 'shape:b'] })
		// Out of A's right side, across and down halfway between them, into B's left side.
		expect(drawn!.route).toEqual([
			{ x: 220, y: 140 },
			{ x: 320, y: 140 },
			{ x: 320, y: 340 },
			{ x: 406.5, y: 340 },
		])
		// Its corners are drawn rounded.
		await expect(page.locator(`[data-shape-id="${drawn!.id}"] path[d*="Q"]`).first()).toBeAttached()

		// The middle handle sits on the middle run, and dragging it moves the run across the gap.
		await page.keyboard.press('Escape')
		await page.evaluate((id) => (window as unknown as { editor: EditorHandle }).editor.select(id), drawn!.id)
		const handle = await page.evaluate((id) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const middle = editor.getShapeHandles(id)!.find((h) => h.id === 'middle')!
			return editor.pageToScreen(editor.getShapePageTransform(id).applyToPoint(middle))
		}, drawn!.id)
		const target = await screen(260, 240)
		await page.mouse.move(handle.x, handle.y)
		await page.mouse.down()
		await page.mouse.move((handle.x + target.x) / 2, handle.y, { steps: 5 })
		await page.mouse.move(target.x, handle.y, { steps: 5 })
		await page.mouse.up()

		await expect.poll(async () => (await arrow(page))!.elbowMidPoint).toBeCloseTo(0.2, 1)
		expect((await arrow(page))!.route![1]).toEqual({ x: 260, y: 140 })

		// The selection toolbar switches it back to a curved arrow.
		await page.getByTestId('lb.arrow-kind').click()
		await expect.poll(async () => (await arrow(page))!.kind).toBe('arc')
		expect((await arrow(page))!.route).toBeNull()
	})
})

test.describe('arrow labels (B2)', () => {
	test('a selected arrow’s label drags along it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await expect.poll(() => editorOf(page)).toBe(true)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
					id: 'shape:l',
					type: 'arrow',
					x: 100,
					y: 300,
					props: {
						start: { x: 0, y: 0 },
						end: { x: 600, y: 0 },
						richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'pays for' }] }] },
					},
				},
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
			editor.select('shape:l')
		})
		const screen = (x: number, y: number) =>
			page.evaluate((p) => (window as unknown as { editor: EditorHandle }).editor.pageToScreen(p), { x, y })
		const props = () =>
			page.evaluate(() => {
				const editor = (window as unknown as { editor: EditorHandle }).editor
				return editor.getCurrentPageShapes().find((s) => s.id === 'shape:l')!.props as { bend: number; labelPosition: number }
			})
		const drag = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
			await page.mouse.move(to.x, to.y, { steps: 5 })
			await page.mouse.up()
		}
		const label = await screen(400, 300)

		// Across the arrow from its label, it bends, as it always did.
		await drag(label, { x: label.x + 2, y: label.y + 60 })
		expect(Math.abs((await props()).bend)).toBeGreaterThan(20)
		await page.keyboard.press('ControlOrMeta+z')
		await expect.poll(async () => (await props()).bend).toBe(0)

		// Along it, the label slides and the arrow stays as it is.
		await drag(label, await screen(250, 310))
		expect((await props()).labelPosition).toBeCloseTo(0.25, 1)
		expect((await props()).bend).toBe(0)
		await expect(page.locator('[data-shape-id="shape:l"] .tl-arrow-label')).toBeVisible()
	})
})
