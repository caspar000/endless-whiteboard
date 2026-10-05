import { expect, test, type Page } from '@playwright/test'

/**
 * Phase 1 of docs/canvas-fork-plan.md: the fork, as it was in 2023, does the basics in a real browser.
 * Shapes are made with the pointer where the gesture matters (strokes, arrows), and through the editor
 * where only the result does.
 */

type Editor = {
	getCurrentPageShapes(): { id: string; type: string; x: number; y: number; rotation: number; props: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number; center: { x: number; y: number } }
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	setCurrentTool(id: string): void
	createShapes(shapes: object[]): void
	select(...ids: string[]): void
	selectNone(): void
	mark(name?: string): void
	undo(): void
	redo(): void
	getSvg(ids: string[]): Promise<SVGElement | undefined>
	getArrowBinding(arrowId: string, end: 'start' | 'end'): { toId: string } | undefined
	updateInstanceState(state: object): void
}

const shapes = (page: Page) =>
	page.evaluate(() => (window as unknown as { editor: Editor }).editor.getCurrentPageShapes().map((s) => s.type).sort())

async function drag(page: Page, tool: string, from: { x: number; y: number }, to: { x: number; y: number }) {
	await page.evaluate((t) => (window as unknown as { editor: Editor }).editor.setCurrentTool(t), tool)
	const [a, b] = await page.evaluate(
		(points) => {
			const { editor } = window as unknown as { editor: Editor }
			return [editor.pageToScreen(points.from), editor.pageToScreen(points.to)] as const
		},
		{ from, to }
	)
	await page.mouse.move(a.x, a.y)
	await page.mouse.down()
	await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2 - 30, { steps: 8 })
	await page.mouse.move(b.x, b.y, { steps: 8 })
	await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
	// A board of its own per test, so persistence from one run never leaks into the next.
	await page.goto(`/?board=smoke-${Date.now()}`)
	await page.waitForFunction(() => 'editor' in window)
})

test('draws, connects, edits and survives a reload', async ({ page }) => {
	// A rectangle and a sticky, made directly; a stroke and an arrow, made with the pointer.
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		// Labels are rich text (TipTap JSON) since the fork moved to today's records.
		const richText = (text: string) => ({
			type: 'doc',
			content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
		})
		editor.createShapes([
			{ type: 'geo', x: 100, y: 100, props: { w: 160, h: 100, geo: 'rectangle' } },
			{ type: 'note', x: 500, y: 100, props: { richText: richText('A sticky') } },
			{ type: 'text', x: 100, y: 400, props: { richText: richText('Some text') } },
		])
	})
	await drag(page, 'draw', { x: 120, y: 300 }, { x: 320, y: 320 })
	const [rect, note] = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		const all = editor.getCurrentPageShapes()
		const centre = (type: string) => editor.getShapePageBounds(all.find((s) => s.type === type)!.id).center
		return [centre('geo'), centre('note')] as const
	})
	await drag(page, 'arrow', rect, note)
	expect(await shapes(page)).toEqual(['arrow', 'draw', 'geo', 'note', 'text'])

	// Both ends are attached: binding records, as today's boards store them (fork-parity.md D2).
	const ends = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
		return (['start', 'end'] as const).map((end) => editor.getArrowBinding(arrow.id, end)?.toId.length ?? 0)
	})
	expect(ends.every((length) => length > 0)).toBe(true)

	// Move, resize and rotate the rectangle; the arrow follows it.
	const before = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		const geo = editor.getCurrentPageShapes().find((s) => s.type === 'geo')!
		const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
		const arrowBefore = editor.getShapePageBounds(arrow.id)
		editor.mark('transform')
		editor.select(geo.id)
		;(editor as unknown as { nudgeShapes(ids: string[], d: { x: number; y: number }): void }).nudgeShapes([geo.id], { x: 0, y: 200 })
		;(editor as unknown as { resizeShape(id: string, s: { x: number; y: number }): void }).resizeShape(geo.id, { x: 1.5, y: 1.5 })
		;(editor as unknown as { rotateShapesBy(ids: string[], r: number): void }).rotateShapesBy([geo.id], Math.PI / 8)
		return { arrow: arrowBefore }
	})
	const moved = await page.evaluate(() => {
		const editor = (window as unknown as { editor: Editor }).editor
		const geo = editor.getCurrentPageShapes().find((s) => s.type === 'geo')!
		return { centreY: editor.getShapePageBounds(geo.id).center.y, w: geo.props.w, rotation: geo.rotation, arrowH: editor.getShapePageBounds(editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!.id).h }
	})
	// The centre, not `y`: rotating about the centre moves the top-left corner.
	expect(moved.centreY).toBeGreaterThan(300)
	expect(moved.w).toBeGreaterThan(200)
	expect(moved.rotation).toBeCloseTo(Math.PI / 8)
	expect(moved.arrowH).not.toBeCloseTo(before.arrow.h, 0)

	// Undo puts it back; redo does it again.
	const geo = () =>
		page.evaluate(() => {
			const s = (window as unknown as { editor: Editor }).editor.getCurrentPageShapes().find((s) => s.type === 'geo')!
			return { y: s.y, rotation: s.rotation }
		})
	await page.evaluate(() => (window as unknown as { editor: Editor }).editor.undo())
	expect(await geo()).toEqual({ y: 100, rotation: 0 })
	await page.evaluate(() => (window as unknown as { editor: Editor }).editor.redo())
	expect((await geo()).rotation).toBeCloseTo(Math.PI / 8)

	// SVG export covers every shape.
	const svg = await page.evaluate(async () => {
		const editor = (window as unknown as { editor: Editor }).editor
		const el = await editor.getSvg(editor.getCurrentPageShapes().map((s) => s.id))
		return el ? new XMLSerializer().serializeToString(el).length : 0
	})
	expect(svg).toBeGreaterThan(1000)

	// Reload: the board comes back from IndexedDB, under the same name tldraw 5 uses.
	await page.waitForTimeout(800)
	const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name))
	expect(dbs.some((name) => name?.startsWith('TLDRAW_DOCUMENT_v2canvas-lab-smoke-'))).toBe(true)
	await page.reload()
	await page.waitForFunction(() => 'editor' in window)
	await expect.poll(() => shapes(page)).toEqual(['arrow', 'draw', 'geo', 'note', 'text'])
})

test('PNG export', async ({ page }) => {
	await page.evaluate(() => {
		;(window as unknown as { editor: Editor }).editor.createShapes([{ type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } }])
	})
	const bytes = await page.evaluate(async () => {
		const editor = (window as unknown as { editor: Editor }).editor
		const svg = await editor.getSvg(editor.getCurrentPageShapes().map((s) => s.id))
		const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg!)], { type: 'image/svg+xml' }))
		const img = new Image()
		await new Promise((resolve, reject) => {
			img.onload = resolve
			img.onerror = reject
			img.src = url
		})
		const canvas = document.createElement('canvas')
		canvas.width = img.width
		canvas.height = img.height
		canvas.getContext('2d')!.drawImage(img, 0, 0)
		const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
		return blob?.size ?? 0
	})
	expect(bytes).toBeGreaterThan(200)
})
