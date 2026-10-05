import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 5 of docs/canvas-fork-plan.md: Lifeboard's own nodes on the fork. The reference board loads
 * with the shipped extensions and the app's migrations (`?lifeboard=lifeboard`, see lifeboard.tsx).
 */

type Shape = { id: string; type: string; meta: Record<string, unknown>; props: Record<string, unknown> }
type Editor = {
	getShape(id: string): Shape | undefined
	getCurrentPageShapes(): Shape[]
	updateShapes(shapes: object[]): void
	run(fn: () => void): void
	sendToBack(ids: string[]): void
	createShapes(shapes: object[]): void
	createBindings(bindings: object[]): void
	getBindingsFromShape(id: string, type: string): { toId: string }[]
	getShapePageBounds(id: string): { center: { x: number; y: number } } | undefined
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	zoomToFit(): void
	selectNone(): void
}

const NOTE = 'shape:cexNL5C4wynyCCeL0MEZR' // "Desk lamp", ₾120, lighting
const TABLE = 'shape:hdi90DNuMkRnzAatrvc40' // "Everything"

const editorCall = <T,>(page: Page, fn: string, ...args: unknown[]) =>
	page.evaluate(
		([name, rest]) => {
			const editor = (window as unknown as { editor: Record<string, (...a: unknown[]) => unknown> }).editor
			return editor[name as string]!(...(rest as unknown[])) as T
		},
		[fn, args] as const
	)

test.beforeEach(async ({ page }) => {
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	;(page as Page & { errors: string[] }).errors = errors
	await page.goto('/?lifeboard=lifeboard')
	await page.waitForFunction(() => 'editor' in window)
	await editorCall(page, 'zoomToFit')
})

test.afterEach(async ({ page }) => {
	expect((page as Page & { errors: string[] }).errors).toEqual([])
})

test('the board opens with its notes, tables, book and sticky', async ({ page }) => {
	await expect(page.getByText('Home office shopping')).toBeVisible()
	await expect(page.getByText('Total spend')).toBeVisible()
	await expect(page.getByText('4,409.00').first()).toBeVisible()
	await expect(page.getByText('Drop a book file here')).toBeVisible()
	// The sticky's label was written by tldraw 5.5 with bold text in it.
	await expect(page.locator('.tl-rich-text strong', { hasText: 'bold' })).toBeVisible()
})

test('a table recomputes when a note’s property changes', async ({ page }) => {
	await page.evaluate((id) => {
		const editor = (window as unknown as { editor: Editor }).editor
		const note = editor.getShape(id)!
		const props = note.meta['lifeboard:props'] as Record<string, unknown>
		editor.updateShapes([{ id, type: note.type, meta: { 'lifeboard:props': { ...props, price: 220 } } }])
	}, NOTE)
	await expect(page.getByText('4,509.00').first()).toBeVisible()
})

test('a table becomes a kanban, and dragging a card to another lane changes its category', async ({ page }) => {
	await page.evaluate((id) => {
		const editor = (window as unknown as { editor: Editor }).editor
		const table = editor.getShape(id)!
		// As the app switches a view (docs/views-plan.md): the mode, and the view behind its cards.
		editor.run(() => {
			editor.updateShapes([
				{ id, type: table.type, props: { layout: { ...(table.props.layout as object), mode: 'kanban' } } },
			])
			editor.sendToBack([id])
		})
	}, TABLE)
	const heads = page.locator('.lb-kanban__head')
	await expect(heads).toHaveCount(3)
	await editorCall(page, 'zoomToFit')
	await page.waitForTimeout(300)

	// Drag "Desk lamp" (lighting) over the first lane's head, which is "desk".
	const from = await page.evaluate((id) => {
		const editor = (window as unknown as { editor: Editor }).editor
		return editor.pageToScreen(editor.getShapePageBounds(id)!.center)
	}, NOTE)
	const lane = (await heads.first().boundingBox())!
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(lane.x + lane.width / 2, lane.y + lane.height + 30, { steps: 15 })
	await page.waitForTimeout(400)
	await page.mouse.up()

	await expect
		.poll(() =>
			page.evaluate((id) => {
				const note = (window as unknown as { editor: Editor }).editor.getShape(id)!
				return (note.meta['lifeboard:props'] as Record<string, unknown>).category
			}, NOTE)
		)
		.toBe('desk')
})

test('two notes joined by a relation stay joined', async ({ page }) => {
	const ends = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		const notes = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')
		const [a, b] = [notes[1]!.id, notes[2]!.id]
		// The way Lifeboard's `connectShapes` joins them: an arrow, then a binding at each end.
		editor.createShapes([{ id: 'shape:relation', type: 'arrow', x: 0, y: 0 }])
		const centre = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
		editor.createBindings([
			{ type: 'arrow', fromId: 'shape:relation', toId: a, props: { terminal: 'start', ...centre } },
			{ type: 'arrow', fromId: 'shape:relation', toId: b, props: { terminal: 'end', ...centre } },
		])
		return [a, b]
	})
	const bound = await page.evaluate(
		() =>
			(window as unknown as { editor: Editor }).editor
				.getBindingsFromShape('shape:relation', 'arrow')
				.map((b) => b.toId)
				.sort()
	)
	expect(bound).toEqual([...ends].sort())
})
