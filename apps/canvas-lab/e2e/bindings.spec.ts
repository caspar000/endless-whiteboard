import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 3 of docs/canvas-fork-plan.md: an arrow drawn between two stickies is bound to both, follows
 * them, and loses its binding with the shape; undo brings both back.
 */

type Box = { x: number; y: number; w: number; h: number; center: { x: number; y: number } }
type Editor = {
	createShapes(shapes: object[]): void
	getCurrentPageShapes(): { id: string; type: string }[]
	getShapePageBounds(id: string): Box
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	setCurrentTool(id: string): void
	getBindingsFromShape(id: string, type: string): { toId: string; props: { terminal: string } }[]
	updateShapes(shapes: object[]): void
	deleteShapes(ids: string[]): void
	mark(name: string): void
	undo(): void
}

const run = <T, A>(page: Page, fn: (editor: Editor, arg: A) => T, arg: A) =>
	page.evaluate(
		([source, a]) => new Function('editor', 'arg', `return (${source})(editor, arg)`)((window as unknown as { editor: Editor }).editor, a),
		[fn.toString(), arg] as const
	) as Promise<T>

test('an arrow between two stickies follows them and goes with them', async ({ page }) => {
	await page.goto(`/?board=bindings-${Date.now()}`)
	await page.waitForFunction(() => 'editor' in window)

	await run(page, (editor) => {
		editor.createShapes([
			{ id: 'shape:one', type: 'note', x: 100, y: 100 },
			{ id: 'shape:two', type: 'note', x: 500, y: 100 },
		])
	}, null)

	// Draw the arrow with the pointer, centre to centre.
	const [from, to] = await run(
		page,
		(editor) => {
			const screen = (id: string) => editor.pageToScreen(editor.getShapePageBounds(id).center)
			return [screen('shape:one'), screen('shape:two')] as const
		},
		null
	)
	await run(page, (editor) => editor.setCurrentTool('arrow'), null)
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	await page.mouse.move(to.x, to.y, { steps: 12 })
	await page.mouse.up()

	const arrowId = await run(page, (editor) => editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!.id, null)
	const ends = () =>
		run(page, (editor, id) => editor.getBindingsFromShape(id, 'arrow').map((b) => `${b.props.terminal}:${b.toId}`).sort(), arrowId)
	expect(await ends()).toEqual(['end:shape:two', 'start:shape:one'])

	// Move the second sticky down: the arrow follows.
	const before = await run(page, (editor, id) => editor.getShapePageBounds(id), arrowId)
	await run(page, (editor) => {
		editor.mark('move')
		editor.updateShapes([{ id: 'shape:two', type: 'note', y: 400 }])
	}, null)
	const after = await run(page, (editor, id) => editor.getShapePageBounds(id), arrowId)
	expect(after.h).toBeGreaterThan(before.h + 100)

	// Delete it: the binding goes, the arrow stays. Undo brings both back.
	await run(page, (editor) => {
		editor.mark('delete')
		editor.deleteShapes(['shape:two'])
	}, null)
	expect(await ends()).toEqual(['start:shape:one'])
	await run(page, (editor) => editor.undo(), null)
	expect(await ends()).toEqual(['end:shape:two', 'start:shape:one'])

	// And it survives a reload.
	await page.waitForTimeout(800)
	await page.reload()
	await page.waitForFunction(() => 'editor' in window)
	await expect.poll(ends).toEqual(['end:shape:two', 'start:shape:one'])
})
