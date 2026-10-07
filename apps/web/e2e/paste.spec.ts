import { expect, test, type Page } from '@playwright/test'
import { createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/** Phase 2 of the parity work through the real clipboard: what a paste can become (B8). */

interface Shape {
	id: string
	type: string
	props: Record<string, unknown>
}
interface EditorHandle {
	getCurrentPageShapes(): Shape[]
	createShapes(shapes: unknown[]): void
	select(...ids: string[]): void
	selectNone(): void
	setCamera(camera: { x: number; y: number; z: number }): void
	getBindingsFromShape(id: string, type: string): unknown[]
}

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

async function freshBoard(page: Page) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { editor?: unknown }).editor))).toBe(true)
}

async function paste(page: Page, text: string) {
	await page.evaluate((t) => navigator.clipboard.writeText(t), text)
	await page.locator('.tl-canvas:visible').click({ position: { x: 40, y: 40 }, force: true })
	await page.keyboard.press('ControlOrMeta+v')
}

const shapes = (page: Page) =>
	page.evaluate(() => (window as unknown as { editor: EditorHandle }).editor.getCurrentPageShapes())

test('a Mermaid flowchart pastes as shapes joined by arrows', async ({ page }) => {
	await freshBoard(page)
	await paste(page, 'graph TD\n  A[Idea] --> B{Worth it?}\n  B -->|yes| C[Build it]\n  B -->|no| D[Drop it]')
	await expect.poll(async () => (await shapes(page)).filter((s) => s.type === 'geo').length).toBe(4)
	const arrows = (await shapes(page)).filter((s) => s.type === 'arrow')
	expect(arrows).toHaveLength(3)
	const bound = await page.evaluate(
		(ids) => ids.map((id) => (window as unknown as { editor: EditorHandle }).editor.getBindingsFromShape(id, 'arrow').length),
		arrows.map((a) => a.id)
	)
	expect(bound).toEqual([2, 2, 2])
	await expect(page.locator('.tl-canvas:visible')).toContainText('Worth it?')
})

test('embed code pastes as an embed', async ({ page }) => {
	await freshBoard(page)
	await paste(page, '<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>')
	await expect.poll(async () => (await shapes(page)).filter((s) => s.type === 'embed').length).toBe(1)
	const [embed] = (await shapes(page)).filter((s) => s.type === 'embed')
	expect(embed!.props).toMatchObject({ w: 560, h: 315 })
})

test('a link pasted onto a selected shape becomes its link', async ({ page }) => {
	await freshBoard(page)
	await page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		editor.createShapes([{ id: 'shape:box', type: 'geo', x: 200, y: 200, props: { w: 120, h: 80 } }])
		editor.select('shape:box')
	})
	await page.evaluate(() => navigator.clipboard.writeText('https://example.com/plan'))
	await page.keyboard.press('ControlOrMeta+v')
	await expect
		.poll(async () => (await shapes(page)).find((s) => s.id === 'shape:box')?.props.url)
		.toBe('https://example.com/plan')
	expect(await shapes(page)).toHaveLength(1)
})
