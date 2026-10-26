import { expect, test } from '@playwright/test'
import { gotoFresh } from './helpers'

/** The phone layout (docs/mobile-plan.md): the chrome a board has below 768px. */
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

const pill = (page: import('@playwright/test').Page) => page.locator('.lb-pill__current')

/**
 * A fresh app on its board, with the editor ready for `page.evaluate`: it arrives a moment after the
 * canvas, and a slow machine (CI) reads `window.editor` before it otherwise.
 */
async function gotoBoard(page: import('@playwright/test').Page) {
	await gotoFresh(page)
	await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))
}

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
		await expect(page.getByRole('combobox', { name: /^Search boards/ })).toBeFocused()
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
		await gotoBoard(page)
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
		await gotoBoard(page)
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
		await gotoBoard(page)
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
		await gotoBoard(page)
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
		await gotoBoard(page)
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

test.describe('phone pages', () => {
	test('the home screen shows boards two to a row', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await pill(page).click()
		await page.getByRole('menuitem', { name: 'New board' }).click()
		await expect(pill(page)).toContainText('Untitled board')
		await pill(page).click()
		await page.getByRole('menuitem', { name: 'All boards' }).click()
		const cards = page.locator('.lb-list__boards > li')
		await expect(cards).toHaveCount(2)
		// Measured once both have risen into place.
		await expect
			.poll(async () => {
				const [a, b] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()])
				return Math.round(a!.y) === Math.round(b!.y) && b!.x >= a!.x + a!.width
			})
			.toBe(true)
	})

	test('a card keeps its actions behind a ⋯, with no hover to show them', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await pill(page).click()
		await page.getByRole('menuitem', { name: 'All boards' }).click()
		const card = page.locator('.lb-list__board').first()
		const rename = card.getByRole('button', { name: 'Rename' })
		await expect(rename).toBeHidden()

		await card.getByRole('button', { name: /^Actions for / }).click()
		await expect(rename).toBeVisible()
		await rename.click()
		await expect(card.getByRole('textbox', { name: 'Board name' })).toBeVisible()
		await page.keyboard.press('Escape')

		await card.getByRole('button', { name: /^Actions for / }).click()
		await card.getByRole('button', { name: 'Delete', exact: true }).click()
		await card.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-list__board')).toHaveCount(0)
	})

	test('the selection toolbar sits above the dock, and gives way to More', async ({ page }) => {
		await gotoBoard(page)
		await expect(pill(page)).toBeVisible()
		await page.getByTestId('lb.nav-toggle').click()
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: DockEditor & { select(id: string): void } }).editor
			editor.select(editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!.id)
		})
		const bar = page.locator('.lb-seltb')
		await expect(bar).toBeVisible()
		const [toolbar, dock] = await Promise.all([bar.boundingBox(), page.locator('.lb-dock').boundingBox()])
		expect(toolbar!.y + toolbar!.height).toBeLessThanOrEqual(dock!.y)
		expect(dock!.y - (toolbar!.y + toolbar!.height)).toBeLessThan(24)

		await page.getByTestId('lb.more').click()
		await expect(bar).toBeHidden()
		await page.getByTestId('lb.more').click()
		await expect(bar).toBeVisible()
	})

	test('Help has a page on using it on a phone', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toBeVisible()
		await page.getByRole('button', { name: 'Expand sidebar' }).click()
		await page.locator('.lb-sidebar').getByRole('button', { name: 'Help', exact: true }).click()
		await page.getByRole('button', { name: 'On a phone' }).click()
		await expect(page.getByRole('heading', { level: 1, name: 'On a phone' })).toBeVisible()
	})
})

test.describe('phone gaps', () => {
	test('a board is renamed from the board list at the top', async ({ page }) => {
		await gotoFresh(page)
		await expect(pill(page)).toContainText('Home office shopping')
		await pill(page).click()
		const list = page.getByRole('menu', { name: 'Open boards' })
		await list.getByRole('button', { name: 'Rename Home office shopping' }).click()
		await page.getByLabel('Board name').fill('Desk setup')
		await page.getByLabel('Board name').press('Enter')
		await expect(list.getByRole('menuitem', { name: 'Desk setup' })).toBeVisible()
		await expect(pill(page)).toContainText('Desk setup')

		// Escape gives a half-typed name up.
		await list.getByRole('button', { name: 'Rename Desk setup' }).click()
		await page.getByLabel('Board name').fill('Nope')
		await page.getByLabel('Board name').press('Escape')
		await expect(list.getByRole('menuitem', { name: 'Desk setup' })).toBeVisible()
	})

	test('a double tap on a shape in Hand opens it in Quick look, and selects nothing', async ({ page }) => {
		await gotoBoard(page)
		await expect(pill(page)).toBeVisible()
		const centre = await page.evaluate(() => {
			const editor = (window as unknown as { editor: DockEditor & { getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } } }).editor
			const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const b = editor.getShapePageBounds(note.id)
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		})
		const touch = await touches(page)
		for (let i = 0; i < 2; i++) {
			await touch('touchStart', [[centre.x, centre.y]])
			await touch('touchEnd')
		}
		await expect(page.getByTestId('lb.quick-look')).toBeVisible()
		expect(await page.evaluate(() => (window as unknown as { editor: DockEditor }).editor.getSelectedShapeIds())).toEqual([])
		expect(await tool(page)).toBe('hand')
	})

	test('a link on a note opens from Hand, in a new tab', async ({ page, context }) => {
		await gotoBoard(page)
		await expect(pill(page)).toBeVisible()
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: DockEditor & { select(id: string): void; setCamera(c: unknown): void } }).editor
			editor.createShapes([{ id: 'shape:linked', type: 'note', x: 0, y: 0 }])
			editor.setCamera({ x: 95, y: 250, z: 1 })
			editor.select('shape:linked')
		})
		await page.keyboard.press('Alt+p')
		const panel = page.locator('.lb-props')
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Docs')
		await panel.getByLabel('New property type').selectOption('link')
		await panel.getByRole('button', { name: 'Add' }).click()
		await panel.getByLabel('Title of Docs').fill('Lifeboard docs')
		await panel.getByLabel('URL of Docs').fill('lifeboard.app/docs')
		await page.keyboard.press('Escape')
		await page.evaluate(() => {
			;(window as unknown as { editor: { selectNone(): void } }).editor.selectNone()
		})
		expect(await tool(page)).toBe('hand')

		const link = page.locator('.lb-board-host:not([data-hidden]) a.lb-strip__link').first()
		await expect(link).toBeVisible()
		const box = (await link.boundingBox())!
		const touch = await touches(page)
		const [opened] = await Promise.all([
			context.waitForEvent('page'),
			(async () => {
				await touch('touchStart', [[box.x + box.width / 2, box.y + box.height / 2]])
				await touch('touchEnd')
			})(),
		])
		expect(opened.url()).toBe('https://lifeboard.app/docs')
	})
})

test.describe('phone kinds', () => {
	test('a second tap on the sticky or the shapes switches its kind, and the buttons say they cycle', async ({ page }) => {
		await gotoBoard(page)
		await expect(pill(page)).toBeVisible()
		await expect(page.locator('.lb-dock [data-cycles]')).toHaveCount(4)
		const note = page.getByTestId('tools.note')
		await note.click()
		await note.click()
		await expect.poll(() => tool(page)).toBe('pinned-note')

		const shapes = page.getByTestId('tools.geo')
		await shapes.click()
		const geo = () =>
			page.evaluate(
				() => (window as unknown as { editor: { getInstanceState(): { stylesForNextShape: Record<string, string> } } }).editor.getInstanceState().stylesForNextShape['tldraw:geo'] ?? 'rectangle'
			)
		const before = await geo()
		await shapes.click()
		await expect.poll(geo).not.toBe(before)
	})
})
