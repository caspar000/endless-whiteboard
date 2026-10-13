import { expect, test } from '@playwright/test'
import { gotoFresh } from './helpers'

/** The phone layout (docs/mobile-plan.md): the chrome a board has below 768px. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const pill = (page: import('@playwright/test').Page) => page.locator('.lb-pill__current')

test.describe('phone chrome', () => {
	test('the board pill names the board, and its list switches, closes and makes boards', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toContainText('Home office shopping')
		// No tab strip on a phone: the pill is how you see and change the open boards.
		await expect(page.locator('.lb-tabs')).toHaveCount(0)

		await pill(page).click()
		await page.getByRole('menuitem', { name: 'New board' }).click()
		await expect(pill(page)).toContainText('Untitled board')

		await pill(page).click()
		const list = page.getByRole('menu', { name: 'Open boards' })
		await expect(list.getByRole('menuitem')).toHaveText(['Home office shopping', 'Untitled board', 'New board', 'All boards'])
		await list.getByRole('menuitem', { name: 'Home office shopping' }).click()
		await expect(list).toHaveCount(0)
		await expect(pill(page)).toContainText('Home office shopping')

		// Closing one from the list leaves the others open.
		await pill(page).click()
		await list.getByRole('button', { name: 'Close Untitled board' }).click()
		await expect(list.getByRole('menuitem', { name: 'Untitled board' })).toHaveCount(0)
		await page.keyboard.press('Escape')
		await expect(list).toHaveCount(0)

		await pill(page).click()
		await list.getByRole('menuitem', { name: 'All boards' }).click()
		await expect(page.locator('.lb-home__header')).toBeVisible()
	})

	test('the menu is a card that gets out of the way, and has the search the keyboard would', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const sidebar = page.locator('.lb-sidebar')

		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await expect(sidebar).not.toHaveClass(/lb-sidebar--collapsed/)
		// A card between the top bar and the dock, not a full-height panel.
		const box = (await sidebar.boundingBox())!
		expect(box.y).toBeGreaterThan(40)
		expect(box.y + box.height).toBeLessThan(844 - 56)

		// Going somewhere from it closes it.
		await sidebar.getByRole('button', { name: /^All boards/ }).first().click()
		await expect(page.locator('.lb-home__header')).toBeVisible()
		await expect(sidebar).toHaveClass(/lb-sidebar--collapsed/)

		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await sidebar.getByRole('button', { name: 'Search boards and commands' }).click()
		await expect(sidebar).toHaveClass(/lb-sidebar--collapsed/)
		await expect(page.getByPlaceholder(/Search boards/)).toBeFocused()
	})

	test('the agent opens as a card from the right, and a tap beside it closes it', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await page.getByRole('button', { name: 'Open agent panel' }).click()
		const panel = page.locator('.lb-agent-panel')
		await expect(panel).toBeVisible()
		// Measured once it has slid in.
		await expect.poll(async () => {
			const box = (await panel.boundingBox())!
			return box.x > 0 && box.x + box.width < 390 && box.y > 40
		}).toBe(true)

		// The strip beside the card: the top bar's buttons stay usable above the dimming.
		await page.locator('.lb-agent-scrim').click({ position: { x: 3, y: 420 } })
		await expect(page.locator('.lb-agent-scrim')).toHaveCount(0)
	})
})

interface DockEditor {
	getCurrentToolId(): string
	getPath(): string
	createShapes(shapes: unknown[]): void
	getShape(id: string): { x: number; y: number } | undefined
	getSelectedShapeIds(): string[]
	getEditingShapeId(): string | null
	getCurrentPageShapes(): { id: string; type: string }[]
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
}
const tool = (page: import('@playwright/test').Page) =>
	page.evaluate(() => (window as unknown as { editor: DockEditor }).editor.getCurrentToolId())
const touches = async (page: import('@playwright/test').Page) => {
	const cdp = await page.context().newCDPSession(page)
	return (type: 'touchStart' | 'touchMove' | 'touchEnd', points: [number, number][] = []) =>
		cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y })) })
}
/** A box in the middle of the screen, and where it is on screen. */
async function box(page: import('@playwright/test').Page) {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: DockEditor }).editor
		editor.createShapes([{ id: 'shape:box', type: 'geo', x: 0, y: 0, props: { w: 160, h: 120, fill: 'solid' } }])
		;(editor as unknown as { setCamera(c: unknown): void }).setCamera({ x: 115, y: 300, z: 1 })
		return editor.pageToScreen({ x: 80, y: 60 })
	})
}

test.describe('phone dock', () => {
	test('a board opens in Hand, where a drag moves the view and never the shape', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const toggle = page.getByTestId('lb.nav-toggle')
		await expect(toggle).toHaveAttribute('data-mode', 'hand')
		expect(await tool(page)).toBe('hand')

		const at = await box(page)
		const touch = await touches(page)
		await touch('touchStart', [[at.x, at.y]])
		for (let i = 1; i <= 6; i++) await touch('touchMove', [[at.x + i * 15, at.y + i * 10]])
		await touch('touchEnd')
		const moved = await page.evaluate(() => (window as unknown as { editor: DockEditor }).editor.getShape('shape:box'))
		expect(moved).toMatchObject({ x: 0, y: 0 })

		// One button, two modes: a tap on the active one switches.
		await toggle.click()
		await expect(toggle).toHaveAttribute('data-mode', 'select')
		expect(await tool(page)).toBe('select')
		await toggle.click()
		await expect(toggle).toHaveAttribute('data-mode', 'hand')
	})

	test('making a sticky goes back to Hand once you are done with it', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await page.getByTestId('tools.note').click()
		expect(await tool(page)).toBe('note')
		await page.mouse.click(200, 420)
		await expect.poll(() => page.evaluate(() => (window as unknown as { editor: DockEditor }).editor.getEditingShapeId())).not.toBeNull()
		await page.keyboard.type('Milk')
		await page.keyboard.press('Escape')
		await expect.poll(() => tool(page)).toBe('hand')
	})

	test('the pen picks up the eraser when tapped again', async ({ page }) => {
		await gotoFresh(page)
		const pen = page.getByTestId('lb.pen-eraser')
		await pen.click()
		expect(await tool(page)).toBe('draw')
		await pen.click()
		expect(await tool(page)).toBe('eraser')
		await expect(pen).toHaveAttribute('data-state', 'eraser')
		await pen.click()
		expect(await tool(page)).toBe('draw')
	})

	test('More holds the rest: its tools, the node picker and the dice', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const more = page.getByTestId('lb.more')
		const row = page.getByRole('group', { name: 'More tools' })

		await more.click()
		await expect(row).toBeVisible()
		await row.getByTestId('tools.frame').click()
		await expect(row).toHaveCount(0)
		expect(await tool(page)).toBe('frame')
		// The More button wears the tool it is holding.
		await expect(more).toHaveClass(/lb-dock__tool--active/)

		await more.click()
		await row.getByTestId('lb.node-menu').click()
		await expect(page.locator('.lb-nodemenu__panel')).toBeVisible()
		const panel = (await page.locator('.lb-nodemenu__panel').boundingBox())!
		expect(panel.width).toBeGreaterThan(340)
		await page.keyboard.press('Escape')

		// The dice are put away until asked for, and come out in the row's place.
		await expect(page.locator('.lb-dice-tray')).toBeHidden()
		await more.click()
		await row.getByTestId('lb.dice').click()
		await expect(page.locator('.lb-dice-tray')).toBeVisible()
		await more.click()
		await expect(page.locator('.lb-dice-tray')).toBeHidden()
	})

	test('a long press on a shape in Hand chooses Select, with the shape selected and its menu open', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const at = await box(page)
		const touch = await touches(page)
		await touch('touchStart', [[at.x, at.y]])
		await expect(page.getByRole('menu')).toBeVisible()
		await touch('touchEnd')
		await expect(page.getByTestId('lb.nav-toggle')).toHaveAttribute('data-mode', 'select')
		expect(await page.evaluate(() => (window as unknown as { editor: DockEditor }).editor.getSelectedShapeIds())).toEqual(['shape:box'])
	})
})

test.describe('phone reading', () => {
	test('a double tap on a book in Hand opens it, and closing it is back to Hand', async ({ page }) => {
		const { makeRarArchive, PIXEL_GIF } = await import('@lifeboard/book-reader/rar-fixture')
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		const bytes = [...makeRarArchive([{ name: 'page1.jpg', data: PIXEL_GIF }, { name: 'page2.jpg', data: PIXEL_GIF }])]
		await page.evaluate(async (bytes) => {
			const editor = (window as unknown as { editor: { putExternalContent(input: unknown): Promise<void> } }).editor
			await editor.putExternalContent({ type: 'files', files: [new File([Uint8Array.from(bytes)], 'Comic.cbr')], point: { x: 200, y: 400 } })
		}, bytes)
		await expect.poll(() => tool(page)).toBe('hand')
		const centre = await page.evaluate(() => {
			const editor = (window as unknown as { editor: DockEditor & { getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } } }).editor
			const book = editor.getCurrentPageShapes().find((s) => s.type === 'node.book')!
			const b = editor.getShapePageBounds(book.id)
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		})
		const touch = await touches(page)
		for (let i = 0; i < 2; i++) {
			await touch('touchStart', [[centre.x, centre.y]])
			await touch('touchEnd')
		}
		const reader = page.locator('.lb-reader')
		await expect(reader).toBeVisible()
		await reader.getByRole('button', { name: 'Close reader' }).click()
		await expect(reader).toHaveCount(0)
		await expect.poll(() => tool(page)).toBe('hand')
	})
})
