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

test.describe('screen readers (A2)', () => {
	test('hear what is selected and which tool is on', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
					id: 'shape:a',
					type: 'geo',
					x: 100,
					y: 100,
					props: { w: 200, h: 100, richText: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Launch plan' }] }] } },
				},
				{ id: 'shape:b', type: 'note', x: 400, y: 100 },
			])
			editor.selectNone()
		})
		await expect(page.locator('.lb-board-host:not([data-hidden]) [role="application"]')).toHaveAccessibleName('Board')
		await page.locator('.lb-board-host:not([data-hidden]) .tl-canvas').click({ position: { x: 700, y: 600 } })
		const heard = page.locator('.lb-board-host:not([data-hidden]) [data-testid="lb.announcer"]')

		await page.keyboard.press('Tab')
		await expect(heard).toHaveText('Rectangle: Launch plan')
		await page.keyboard.press('ControlOrMeta+a')
		await expect(heard).toHaveText('2 shapes selected')
		await page.keyboard.press('a')
		await expect(heard).toHaveText('Relation tool')
	})
})

test.describe('zooming (I4)', () => {
	test('Shift+Z shows the whole board and goes back; Shift+= zooms at the pointer; 5% is the floor', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		const camera = () =>
			page.evaluate(() => {
				const editor = (window as unknown as { editor: { getCamera(): { x: number; y: number; z: number } } }).editor
				const { x, y, z } = editor.getCamera()
				return { x: Math.round(x), y: Math.round(y), z: Math.round(z * 1000) / 1000 }
			})
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:a', type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
				{ id: 'shape:b', type: 'geo', x: 6000, y: 4000, props: { w: 100, h: 100 } },
			])
			editor.selectNone()
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const canvas = page.locator('.lb-board-host:not([data-hidden]) .tl-canvas')
		await canvas.click({ position: { x: 400, y: 300 } })
		const start = await camera()

		await page.keyboard.press('Shift+Z')
		await expect.poll(async () => (await camera()).z).toBeLessThan(0.2)
		await page.keyboard.press('Shift+Z')
		await expect.poll(camera).toEqual(start)

		// Zooming in at the pointer keeps the spot under it where it was.
		const box = (await canvas.boundingBox())!
		const pointer = { x: box.x + 300, y: box.y + 200 }
		await page.mouse.move(pointer.x, pointer.y)
		const under = () =>
			page.evaluate(
				(p) => {
					const editor = (window as unknown as { editor: { screenToPage(p: unknown): { x: number; y: number } } }).editor
					const at = editor.screenToPage(p)
					return { x: Math.round(at.x), y: Math.round(at.y) }
				},
				pointer
			)
		const spot = await under()
		await page.keyboard.press('Shift+Equal')
		await expect.poll(async () => (await camera()).z).toBe(2)
		expect(await under()).toEqual(spot)

		// A press at a time, each after the last one's 120ms animation, as a person would.
		for (let i = 0; i < 8; i++) {
			await page.keyboard.press('Shift+Minus')
			await page.waitForTimeout(200)
		}
		await expect.poll(async () => (await camera()).z).toBe(0.05)
	})
})

test.describe('frames (B4)', () => {
	test('⌘⇧F frames the selection, and again takes the frame apart', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:a', type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } },
				{ id: 'shape:b', type: 'geo', x: 300, y: 100, props: { w: 100, h: 100 } },
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const canvas = page.locator('.lb-board-host:not([data-hidden]) .tl-canvas')
		await canvas.click({ position: { x: 700, y: 600 } })
		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.press('ControlOrMeta+Shift+f')
		const shapes = () =>
			page.evaluate(() =>
				(window as unknown as { editor: { getCurrentPageShapes(): { type: string; parentId: string }[] } }).editor
					.getCurrentPageShapes()
					.map((shape) => `${shape.type}:${shape.parentId.startsWith('page:') ? 'page' : 'frame'}`)
					.sort()
			)
		await expect.poll(shapes).toEqual(['frame:page', 'geo:frame', 'geo:frame'])
		await page.keyboard.press('ControlOrMeta+Shift+f')
		await expect.poll(shapes).toEqual(['geo:page', 'geo:page'])
	})
})

test.describe('typing (B7)', () => {
	test('a sticky curls quotes and makes arrows as you type', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ id: 'shape:s', type: 'note', x: 200, y: 200 }])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const sticky = page.locator('[data-shape-id="shape:s"]')
		const centre = await page.evaluate(() =>
			(window as unknown as { editor: { pageToScreen(p: unknown): { x: number; y: number } } }).editor.pageToScreen({ x: 300, y: 300 })
		)
		await page.mouse.dblclick(centre.x, centre.y)
		await page.keyboard.type('"Ship it" -> Friday...')
		await page.keyboard.press('Escape')
		await expect(sticky).toContainText('“Ship it” → Friday…')
	})
})

test.describe('clipboard (X3)', () => {
	test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

	test('⌘⇧C copies a PNG; ⌘⇧V pastes plain text', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ id: 'shape:a', type: 'geo', x: 100, y: 100, props: { w: 100, h: 100 } }])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		await page.locator('.lb-board-host:not([data-hidden]) .tl-canvas').click({ position: { x: 700, y: 600 } })
		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.press('ControlOrMeta+Shift+c')
		await expect
			.poll(() => page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types)))
			.toContain('image/png')

		// Rich text on the clipboard; with Shift held, only its plain text arrives.
		const before = await page.evaluate(
			() => (window as unknown as { editor: { getCurrentPageShapes(): unknown[] } }).editor.getCurrentPageShapes().length
		)
		await page.keyboard.down('Shift')
		await page.evaluate(() => {
			const data = new DataTransfer()
			data.setData('text/html', '<b>Bold</b> and a <a href="https://x.y">link</a>')
			data.setData('text/plain', 'Bold and a link')
			document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }))
		})
		await page.keyboard.up('Shift')
		const pasted = () =>
			page.evaluate(() => {
				const editor = (window as unknown as {
					editor: { getCurrentPageShapes(): { type: string; props: Record<string, unknown> }[] }
				}).editor
				const shapes = editor.getCurrentPageShapes()
				return { count: shapes.length, text: JSON.stringify(shapes.at(-1)?.props ?? {}) }
			})
		await expect.poll(async () => (await pasted()).count).toBe(before + 1)
		const { text } = await pasted()
		expect(text).toContain('Bold and a link')
		expect(text).not.toContain('"bold"')
		expect(text).not.toContain('https://x.y')
	})
})

test.describe('the next sticky (B3)', () => {
	test('a clone handle makes the next sticky; Tab while writing goes on to another', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ id: 'shape:s', type: 'note', x: 100, y: 200, props: { color: 'green' } }])
			editor.setCamera({ x: 0, y: 0, z: 1 })
			;(editor as unknown as { select(id: string): void }).select('shape:s')
		})
		const notes = () =>
			page.evaluate(() =>
				(window as unknown as {
					editor: { getCurrentPageShapes(): { type: string; x: number; y: number; props: { color: string } }[] }
				}).editor
					.getCurrentPageShapes()
					.filter((shape) => shape.type === 'note')
					.map((shape) => ({ x: Math.round(shape.x), y: Math.round(shape.y), color: shape.props.color }))
					.sort((a, b) => a.x - b.x)
			)

		await page.getByTestId('note-clone.right').click()
		await page.keyboard.type('Second')
		await page.keyboard.press('Tab')
		await page.keyboard.type('Third')
		await page.keyboard.press('Escape')

		expect(await notes()).toEqual([
			{ x: 100, y: 200, color: 'green' },
			{ x: 320, y: 200, color: 'green' },
			{ x: 540, y: 200, color: 'green' },
		])
		await expect(page.locator('.tl-shape', { hasText: 'Second' })).toHaveCount(1)
		await expect(page.locator('.tl-shape', { hasText: 'Third' })).toHaveCount(1)
	})
})

test.describe('styles and the menu (I7)', () => {
	test('right-click opens the menu from the pen; Shift+Q copies the style under the pointer', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:src', type: 'geo', x: 100, y: 100, props: { w: 120, h: 120, color: 'violet', dash: 'dotted', fill: 'solid' } },
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
		const canvas = page.locator('.lb-board-host:not([data-hidden]) .tl-canvas')
		await canvas.click({ position: { x: 700, y: 600 } })

		// Opened and closed at once, as a quick hand might: the board's keys must still work after.
		await canvas.click({ position: { x: 600, y: 500 }, button: 'right' })
		await page.keyboard.press('Escape')
		await page.keyboard.press('d')
		await canvas.click({ position: { x: 600, y: 500 }, button: 'right' })
		await expect(page.getByRole('menu')).toBeVisible()
		await page.keyboard.press('Escape')
		// Closed, as far as the board's shortcuts are concerned, once it has finished going away.
		await expect
			.poll(() =>
				page.evaluate(() => (window as unknown as { editor: { getInstanceState(): { openMenus: string[] } } }).editor.getInstanceState().openMenus)
			)
			.toEqual([])

		const at = await page.evaluate(() =>
			(window as unknown as { editor: { pageToScreen(p: unknown): { x: number; y: number } } }).editor.pageToScreen({ x: 160, y: 160 })
		)
		await page.mouse.move(at.x, at.y)
		await page.mouse.move(at.x + 5, at.y + 5)
		await page.keyboard.press('Shift+Q')
		await expect
			.poll(() =>
				page.evaluate(() => {
					const editor = (window as unknown as { editor: { getInstanceState(): { stylesForNextShape: Record<string, unknown> } } }).editor
					const next = editor.getInstanceState().stylesForNextShape
					return [next['tldraw:color'], next['tldraw:dash']]
				})
			)
			.toEqual(['violet', 'dotted'])
	})
})
