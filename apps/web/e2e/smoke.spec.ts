import { expect, test } from '@playwright/test'
import {
	NOTE_EDITOR,
	backToList,
	countShapes,
	createBoard,
	dblclickNode,
	drawNode,
	gotoFresh,
	openBoard,
	openProperties,
	skipFirstRunDemo,
	waitForPersistedShapes,
} from './helpers'

test.describe('first run', () => {
	test('seeds a demo shopping board that totals its notes live', async ({ page }) => {
		await gotoFresh(page)

		// Milestone 10: the first-run board reproduces the driving use case. Since Phase 2 the cards are
		// notes carrying properties, so what proves the data is there is the property strip on the shape.
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()).toBeVisible()
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()).toContainText('Price')

		// Milestone 6 acceptance: a table shows a real total, computed from property values — and with
		// `shapeTypes: null`, from *anything* carrying a price rather than from one node type.
		// 2399 + 850 + 240 + 320 + 120 + 480 = 4409
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 4,409.00')

		// And the same data as a grid, grouped by category, with each group's own subtotal.
		const grid = page.locator('.lb-board-host:not([data-hidden]) .lb-table__grid')
		await expect(grid).toBeVisible()
		await expect(grid).toContainText('Standing desk')
		await expect(grid).toContainText('desk')
		await expect(grid).toContainText('₾ 3,489.00')
		await expect(grid).toContainText('lighting')
	})

	test('totals update when a note is deleted', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 4,409.00')

		// Delete the ₾ 2,399.00 desk through the store, then assert the derived total followed.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const desk = editor
				.getCurrentPageShapes()
				.find(
					(s) =>
						s.type === 'node.markdown' && (s.props as { md?: string }).md?.includes('Standing desk')
				)
			if (!desk) throw new Error('demo desk note not found')
			editor.deleteShapes([desk.id])
		})

		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 2,010.00')
	})
})

test.describe('board CRUD and persistence', () => {
	test('two boards hold independent content across a reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await createBoard(page, 'Board A')
		await openBoard(page, 'Board A')
		await drawNode(page, 'Note', { x: 400, y: 300 })
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(1)
		await backToList(page)

		await createBoard(page, 'Board B')
		await openBoard(page, 'Board B')
		await drawNode(page, 'Table', { x: 400, y: 300 })
		await drawNode(page, 'Table', { x: 700, y: 300 })
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table')).toHaveCount(2)

		// Reload: tldraw's per-board persistenceKey must bring back exactly this board's content.
		// Wait for the write to actually land first — tldraw throttles persists by 350 ms and does
		// not flush on unload, so an immediate reload would legitimately lose the edits.
		await waitForPersistedShapes(page, 2)
		await page.reload()
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table')).toHaveCount(2)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(0)

		await backToList(page)
		await openBoard(page, 'Board A')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(1)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table')).toHaveCount(0)
	})

	test('deleting a board removes its canvas database', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Doomed')

		const boardId = await page.evaluate(async () => {
			const req = indexedDB.open('lifeboard-kv')
			return new Promise<string>((resolve) => {
				req.addEventListener('success', () => {
					const tx = req.result.transaction('kv', 'readonly')
					const get = tx.objectStore('kv').get('boards')
					get.addEventListener('success', () => {
						const boards = get.result as { id: string; name: string }[]
						resolve(boards.find((b) => b.name === 'Doomed')?.id ?? '')
						req.result.close()
					})
				})
			})
		})
		expect(boardId).not.toBe('')

		// The board was opened, so tldraw created its database.
		const dbNamesBefore = await page.evaluate(() =>
			JSON.parse(localStorage.getItem('TLDRAW_DB_NAME_INDEX_v2') ?? '[]')
		)
		expect(dbNamesBefore).toContain(`TLDRAW_DOCUMENT_v2lifeboard-${boardId}`)

		const row = page.locator('.lb-list__board', { hasText: 'Doomed' })
		await row.getByRole('button', { name: 'Delete', exact: true }).click()
		await row.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-list__board', { hasText: 'Doomed' })).toHaveCount(0)

		// Both halves of the delete must have happened: tldraw's name index no longer lists it…
		const dbNamesAfter = await page.evaluate(() =>
			JSON.parse(localStorage.getItem('TLDRAW_DB_NAME_INDEX_v2') ?? '[]')
		)
		expect(dbNamesAfter).not.toContain(`TLDRAW_DOCUMENT_v2lifeboard-${boardId}`)

		// …and the database itself is gone.
		const dbs = await page.evaluate(async () =>
			((await indexedDB.databases?.()) ?? []).map((d) => d.name)
		)
		expect(dbs).not.toContain(`TLDRAW_DOCUMENT_v2lifeboard-${boardId}`)
	})
})

test.describe('nodes', () => {
	test('markdown node renders on edit-end as a single undo step', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await drawNode(page, 'Note', { x: 400, y: 250 }, { w: 360, h: 240 })
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(1)

		// Double-click to edit, type markdown, then leave editing. Typed rather than `fill`ed: the
		// textarea holds a single line now, and Enter is what moves to the next one.
		await dblclickNode(page, 'node.markdown')
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('# Chores')
		await page.keyboard.press('Enter')
		await page.keyboard.type('- morning care')
		await page.keyboard.press('Enter')
		// Auto-continuation prefills the bullet, so only the text is typed.
		await page.keyboard.type('workout')
		await page.keyboard.press('Escape')

		// Display mode shows rendered markdown, not source.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body h1')).toHaveText('Chores')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body li')).toHaveCount(2)

		// One editing session = one undo entry, so a single undo clears the whole text.
		await page.keyboard.press('ControlOrMeta+z')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body h1')).toHaveCount(0)
	})

	test('canvas does not pan while typing in a node', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await drawNode(page, 'Note', { x: 400, y: 250 }, { w: 360, h: 240 })

		await dblclickNode(page, 'node.markdown')
		const cameraBefore = await page.evaluate(() =>
			(window as unknown as { editor: EditorHandle }).editor.getCamera()
		)

		// Space and arrow keys pan the canvas when it has focus — they must not while editing.
		const textarea = page.locator(NOTE_EDITOR)
		await textarea.fill('hello world')
		await textarea.press('ArrowLeft')
		await textarea.press('Space')

		const cameraAfter = await page.evaluate(() =>
			(window as unknown as { editor: EditorHandle }).editor.getCamera()
		)
		expect(cameraAfter.x).toBe(cameraBefore.x)
		expect(cameraAfter.y).toBe(cameraBefore.y)
		expect(cameraAfter.z).toBe(cameraBefore.z)
	})

	test('properties on a note drive a rollup total that updates live', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Two notes carrying a price, created through the store so the test stays about the rollup.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
				},
			})
			const mk = (title: string, price: number, x: number) => ({
				type: 'node.markdown',
				x,
				y: 100,
				props: { w: 220, h: 100, md: `# ${title}`, autoHeight: false },
				meta: { 'lifeboard:props': { price } },
			})
			editor.createShapes([mk('Desk', 1000, 100), mk('Chair', 500, 400)])
		})

		await drawNode(page, 'Table', { x: 700, y: 500 }, { w: 280, h: 180 })
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table')).toHaveCount(1)

		// A fresh table shows a row count, so configure it through its editing UI: add the Price column
		// and sum it. The column picker is fed from the board's *registry*, so "Price" is offered because
		// it was defined — not because some shape happens to carry it.
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')
		await config.getByRole('button', { name: '+ Price' }).click()
		await config.getByLabel('Summary of Price').selectOption('sum')
		// One big number, so the assertion is about the total rather than about row rendering.
		await config.getByLabel('Show as').selectOption('value')
		await page.keyboard.press('Escape')

		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 1,500.00')

		// A meta-only edit must flow through to the total. This is the comparator regression: every
		// comparator in the pipeline used to look at `props` alone, so this edit was invisible.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const chair = editor
				.getCurrentPageShapes()
				.find(
					(s) => s.type === 'node.markdown' && (s.props as { md?: string }).md?.includes('Chair')
				)
			if (!chair) throw new Error('chair not found')
			editor.updateShape({
				id: chair.id,
				type: 'node.markdown',
				meta: { 'lifeboard:props': { price: 700 } },
			})
		})
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 1,700.00')
	})

	test('properties work on a dragged-in image and a sticky note, not just on our own nodes', async ({
		page,
	}) => {
		// The acceptance test for the whole property system: values live in `shape.meta`, so a shape type
		// needs to do nothing at all to carry them. If this passes for tldraw's own shapes, it passes for
		// anything.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
				},
			})
			editor.createShapes([
				// tldraw's sticky note, carrying a price.
				{ type: 'note', x: 100, y: 100, meta: { 'lifeboard:props': { price: 250 } } },
				// tldraw's geo shape, carrying one too.
				{
					type: 'geo',
					x: 400,
					y: 100,
					props: { w: 160, h: 120 },
					meta: { 'lifeboard:props': { price: 75 } },
				},
			])
		})

		await drawNode(page, 'Table', { x: 700, y: 400 }, { w: 280, h: 180 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')
		await config.getByRole('button', { name: '+ Price' }).click()
		await config.getByLabel('Summary of Price').selectOption('sum')
		await config.getByLabel('Show as').selectOption('value')
		await page.keyboard.press('Escape')

		// 250 + 75 — a sticky and a rectangle, summed by a table that knows nothing about either.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 325.00')
	})

	test('a link property takes a title and a URL, and the title opens it in a new tab', async ({
		page,
		context,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ type: 'note', x: 200, y: 200 }])
		})

		await openProperties(page, 'note')
		const panel = page.locator('.lb-props')
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Docs')
		await panel.getByLabel('New property type').selectOption('link')
		await panel.getByRole('button', { name: 'Add' }).click()

		// Two boxes, not one: the value is stored as a single encoded string, which nobody should type.
		await panel.getByLabel('Title of Docs').fill('Lifeboard docs')
		// Typed the way people actually type a URL — no scheme.
		await panel.getByLabel('URL of Docs').fill('lifeboard.app/docs')

		// The panel's own launch button, since the title there is an input and clicking it must edit.
		await expect(panel.getByLabel('Open Docs')).toHaveAttribute(
			'href',
			'https://lifeboard.app/docs'
		)
		await page.keyboard.press('Escape')

		// On the card the title *is* the link — that is where clicking to open belongs.
		const link = page.locator('.lb-board-host:not([data-hidden]) a.lb-strip__link').first()
		await expect(link).toHaveText('Lifeboard docs')
		await expect(link).toHaveAttribute('href', 'https://lifeboard.app/docs')
		await expect(link).toHaveAttribute('rel', 'noreferrer noopener')

		// A new tab, not a navigation: the board has to stay where it is.
		const boardUrl = page.url()
		const [opened] = await Promise.all([context.waitForEvent('page'), link.click()])
		expect(opened.url()).toBe('https://lifeboard.app/docs')
		expect(page.url()).toBe(boardUrl)
	})

	test('a link property refuses a URL that would execute script', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ type: 'note', x: 200, y: 200 }])
		})

		await openProperties(page, 'note')
		const panel = page.locator('.lb-props')
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Docs')
		await panel.getByLabel('New property type').selectOption('link')
		await panel.getByRole('button', { name: 'Add' }).click()

		await panel.getByLabel('Title of Docs').fill('Totally safe')
		await panel.getByLabel('URL of Docs').fill('javascript:alert(1)')

		// No launch button, because there is no safe href to launch.
		await expect(panel.getByLabel('Open Docs')).toHaveCount(0)
		await page.keyboard.press('Escape')

		// The title still shows — it is real data — but never as something clickable.
		const strip = page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()
		await expect(strip).toContainText('Totally safe')
		await expect(page.locator('.lb-board-host:not([data-hidden]) a.lb-strip__link')).toHaveCount(0)
	})

	test('currency is per shape, so pricing one node in USD leaves the others alone', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Side by side, so neither shape's selection toolbar covers the other's panel.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ type: 'note', x: 150, y: 200 },
				{ type: 'note', x: 700, y: 200 },
			])
		})

		const shapeIds = await page.evaluate(() =>
			(window as unknown as { editor: EditorHandle }).editor
				.getCurrentPageShapes()
				.filter((s) => s.type === 'note')
				.map((s) => s.id)
		)

		const openFor = async (id: string) => {
			await page.evaluate((shapeId) => {
				;(window as unknown as { editor: { select(id: string): unknown } }).editor.select(shapeId)
			}, id)
			await page.keyboard.press('Alt+p')
			await expect(page.locator('.lb-props')).toBeVisible()
		}

		// The first note defines Price, in the board's default currency.
		await openFor(shapeIds[0]!)
		const panel = page.locator('.lb-props')
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Price')
		await panel.getByLabel('New property type').selectOption('financial')
		await panel.getByRole('button', { name: 'Add' }).click()
		await panel.getByLabel('Value of Price').fill('2399')
		await page.keyboard.press('Escape')

		// The second carries the same property, priced in USD.
		await openFor(shapeIds[1]!)
		await page.evaluate(() => {
			const attach = [...document.querySelectorAll('.lb-props__attach')].find((b) =>
				b.textContent?.includes('Price')
			) as HTMLElement | undefined
			attach?.click()
		})
		await panel.getByLabel('Value of Price').fill('100')
		await panel.getByLabel('Currency of Price').fill('USD')
		await panel.getByLabel('Currency of Price').blur()
		await page.keyboard.press('Escape')

		// The bug: this used to rewrite the board-level definition, dragging every other card with it.
		const strips = page.locator('.lb-board-host:not([data-hidden]) .lb-strip')
		await expect.poll(async () => (await strips.allTextContents()).join(' | ')).toContain('$ 100.00')
		const all = (await strips.allTextContents()).join(' | ')
		expect(all).toContain('₾ 2,399.00')

		// And the definition still holds GEL, so it stays the default a new value inherits.
		const registry = await page.evaluate(() =>
			JSON.stringify(
				(
					window as unknown as {
						editor: { getDocumentSettings(): { meta?: Record<string, unknown> } }
					}
				).editor.getDocumentSettings().meta?.['lifeboard:properties']
			)
		)
		expect(registry).toContain('"unit":"GEL"')
	})

	test('a property nothing carries stops being suggested, and can be swept up', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ type: 'note', x: 150, y: 200 },
				{ type: 'note', x: 700, y: 200 },
			])
		})
		const shapeIds = await page.evaluate(() =>
			(window as unknown as { editor: EditorHandle }).editor
				.getCurrentPageShapes()
				.filter((s) => s.type === 'note')
				.map((s) => s.id)
		)

		const panel = page.locator('.lb-props')
		const openFor = async (id: string) => {
			await page.evaluate((shapeId) => {
				;(window as unknown as { editor: EditorHandle }).editor.select(shapeId)
			}, id)
			await page.keyboard.press('Alt+p')
			await expect(panel).toBeVisible()
		}

		// The first note invents Price. Defining it attaches it, so the note now carries it.
		await openFor(shapeIds[0]!)
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Price')
		await panel.getByRole('button', { name: 'Add' }).click()
		await page.keyboard.press('Escape')

		// The feature worth keeping: the second note is offered it, because something has it.
		await openFor(shapeIds[1]!)
		await expect(panel.locator('.lb-props__attach', { hasText: 'Price' })).toHaveCount(1)
		await expect(panel.getByRole('button', { name: /unused/ })).toHaveCount(0)
		await page.keyboard.press('Escape')

		// Delete the only note that carries it and the suggestion goes with it, rather than lingering
		// as the name of something that no longer exists anywhere on the board.
		await page.evaluate((id) => {
			;(window as unknown as { editor: EditorHandle }).editor.deleteShapes([id])
		}, shapeIds[0]!)
		await openFor(shapeIds[1]!)
		await expect(panel.locator('.lb-props__attach', { hasText: 'Price' })).toHaveCount(0)

		// And the definition it left behind can be swept up, on purpose rather than automatically.
		const sweep = panel.getByRole('button', { name: 'Remove 1 unused property' })
		await expect(sweep).toBeVisible()
		await sweep.click()
		await expect(sweep).toHaveCount(0)
		const registryAfter = await page.evaluate(() =>
			JSON.stringify(
				(window as unknown as { editor: EditorHandle }).editor.getDocumentSettings().meta[
					'lifeboard:properties'
				]
			)
		)
		expect(registryAfter).not.toContain('Price')
	})

	test('a property can be defined and filled in through the panel, on a shape tldraw owns', async ({
		page,
	}) => {
		// The whole journey, driven the way a user drives it: put a sticky on the board, open its
		// properties, invent a property that did not exist, give it a value, and watch a rollup pick it
		// up. Nothing here touches the store directly.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ type: 'note', x: 200, y: 200 }])
		})

		await openProperties(page, 'note')
		const panel = page.locator('.lb-props')
		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Price')
		await panel.getByLabel('New property type').selectOption('financial')
		await panel.getByRole('button', { name: 'Add' }).click()

		// Defining it attaches it, empty. Filling it in is a separate act — which is the distinction
		// aggregation reports as `skipped` rather than "not matched".
		await panel.getByLabel('Value of Price').fill('420')
		await page.keyboard.press('Escape')

		// The value shows on the sticky itself, because a property is data *about the shape*, not a
		// hidden annotation.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()).toContainText('₾ 420.00')

		await drawNode(page, 'Table', { x: 600, y: 400 }, { w: 280, h: 180 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')
		await config.getByRole('button', { name: '+ Price' }).click()
		await config.getByLabel('Summary of Price').selectOption('sum')
		await config.getByLabel('Show as').selectOption('value')
		await page.keyboard.press('Escape')

		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 420.00')
	})

	test('the properties panel edits any shape and is fully visible above other shapes', async ({
		page,
	}) => {
		await gotoFresh(page)
		// The demo board is deliberately crowded: neighbouring cards are what used to paint over the
		// panel, and a node's own `overflow: hidden` is what used to clip it to one row.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()).toBeVisible()

		// The ₾ 2,399.00 desk specifically: the demo's intro note is also a `node.markdown` but carries no
		// properties, so "the first note" would open an empty panel and prove nothing.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const desk = editor
				.getCurrentPageShapes()
				.find(
					(s) =>
						s.type === 'node.markdown' && (s.props as { md?: string }).md?.includes('Standing desk')
				)
			if (!desk) throw new Error('demo desk note not found')
			editor.select(desk.id)
		})
		await page.keyboard.press('Alt+p')

		const panel = page.locator('.lb-popover')
		await expect(panel).toBeVisible()
		// Every control must be reachable, not just present — `toBeVisible` alone passed while the
		// panel was clipped, because the elements were laid out but painted nowhere.
		await expect(panel.getByLabel('Value of Price')).toBeVisible()
		await expect(panel.getByRole('button', { name: 'New property…' })).toBeVisible()

		// Nothing paints over it: the point at the panel's centre must hit the panel itself.
		const box = (await panel.boundingBox())!
		const onTop = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('.lb-popover') !== null,
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		)
		expect(onTop).toBe(true)

		// Editing a price *through the panel* updates the live rollup — the panel is wired to the store,
		// not just rendered. 4409 - 2399 + 1000 = 3010.
		await page.locator('.lb-props').getByLabel('Value of Price').fill('1000')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__value')).toHaveText('₾ 3,010.00')
	})

	test('a table filters, groups and sorts shapes, and says what it held back', async ({ page }) => {
		// The table as a database view: the acceptance test for Phase 3. Built through the config UI, over
		// shapes that are only related by carrying the same property.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
						{ id: 'category', name: 'Category', type: 'select' },
					],
				},
			})
			// Five priced things and one unpriced, spread across two categories.
			const things: [string, number | null, string][] = [
				['Desk', 2399, 'desk'],
				['Chair', 850, 'desk'],
				['Arm', 240, 'desk'],
				['Lamp', 120, 'light'],
				['Bulb', 30, 'light'],
				['Poster', null, 'decor'],
			]
			editor.createShapes(
				things.map(([name, price, category], i) => ({
					type: 'node.markdown',
					x: (i % 3) * 200,
					y: Math.floor(i / 3) * 140,
					props: { w: 170, h: 80, md: `# ${name}`, autoHeight: false },
					meta: {
						'lifeboard:props': price === null ? { category } : { price, category },
					},
				}))
			)
		})

		// Inside the 1280×720 viewport and clear of the shapes above, or the draw gesture would end
		// off-screen and create nothing.
		await drawNode(page, 'Table', { x: 680, y: 160 }, { w: 300, h: 220 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')

		// Columns: Name is there by default; add Price and sum it.
		await config.getByRole('button', { name: '+ Price' }).click()
		await config.getByLabel('Summary of Price').selectOption('sum')

		// Only things that actually have a price.
		await config.getByRole('button', { name: '+ Filter' }).click()
		await config.getByLabel('Filter 1 property').selectOption('price')
		await config.getByLabel('Filter 1 operator').selectOption('isNotEmpty')

		// Grouped by category, dearest first.
		await config.getByLabel('Group by').selectOption('category')
		await config.getByLabel('Sort by').selectOption('price')
		await config.getByLabel('Sort direction').selectOption('desc')
		await page.keyboard.press('Escape')

		const grid = page.locator('.lb-board-host:not([data-hidden]) .lb-table__grid')
		// The unpriced poster is filtered out: 2399 + 850 + 240 + 120 + 30 = 3639 over 5 rows.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__row--summary')).toContainText('₾ 3,639.00')
		await expect(grid).not.toContainText('Poster')

		// Each group carries its own subtotal — what the old rollup's grouped mode did.
		const groups = page.locator('.lb-board-host:not([data-hidden]) .lb-table__row--group')
		await expect(groups).toHaveCount(2)
		await expect(groups.first()).toContainText('desk')
		await expect(groups.first()).toContainText('₾ 3,489.00')
		await expect(groups.nth(1)).toContainText('₾ 150.00')

		// Sorted dearest first. `--data` rows only, so the group headers ("desk 3 ₾ 3,489.00") don't count as
		// rows — which is exactly what a looser locator matched.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__row--data')).toHaveCount(5)
		expect(await page.locator('.lb-board-host:not([data-hidden]) .lb-table__row--data').allTextContents()).toEqual([
			'Desk₾ 2,399.00',
			'Chair₾ 850.00',
			'Arm₾ 240.00',
			'Lamp₾ 120.00',
			'Bulb₾ 30.00',
		])
	})

	test('a table caps its rows and says how many it is not showing', async ({ page }) => {
		// A cap rather than a scrollbar: `canScroll` only applies to the shape being *edited*, and in
		// display mode a shape must not swallow pointer events or it stops behaving like a shape. Silently
		// truncating would make the table lie about the board, so the count is on screen.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
				},
			})
			editor.createShapes(
				Array.from({ length: 20 }, (_, i) => ({
					type: 'node.markdown',
					x: (i % 5) * 120,
					y: Math.floor(i / 5) * 90,
					props: { w: 100, h: 60, md: `# Thing ${i}`, autoHeight: false },
					meta: { 'lifeboard:props': { price: i + 1 } },
				}))
			)
		})

		await drawNode(page, 'Table', { x: 700, y: 150 }, { w: 280, h: 220 })
		await dblclickNode(page, 'node.table')
		await page.locator('.lb-tcfg').getByRole('button', { name: '+ Price' }).click()
		await page.keyboard.press('Escape')

		// 20 rows, 12 shown by default.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__count')).toHaveText('20 rows')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-table__more')).toHaveText('+8 more')
	})

	test('the toolbar comes from the registry, and retired node types are hidden from it', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// §7: registry-driven UI. These exist because the definitions are registered, not because
		// anything in the toolbar names them.
		await expect(page.getByTestId('tools.node-markdown')).toBeVisible()
		await expect(page.getByTestId('tools.node-table')).toBeVisible()

		// Both retired types stay *registered* — unregistering one would turn any surviving record into a
		// validation failure — but a user must never be offered a type that no longer has a future.
		await expect(page.getByTestId('tools.node-item')).toHaveCount(0)
		await expect(page.getByTestId('tools.node-rollup')).toHaveCount(0)
	})

	test('properties survive being copied to another board', async ({ page }) => {
		// The definition sidecar's reason to exist. A copied shape carries id → value pairs, which are
		// meaningless without knowing that `price` is GEL currency — so each shape also carries a copy of
		// the definitions it uses, and pasting merges them into the target board's registry.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Source')
		await openBoard(page, 'Source')

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
				},
			})
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 200,
					y: 200,
					props: { w: 220, h: 100, md: '# Original', autoHeight: false },
					meta: {
						'lifeboard:props': { price: 99 },
						'lifeboard:propDefs': [{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' }],
					},
				},
			])
		})
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip')).toContainText('₾ 99.00')

		// Read the shape back out, then re-create it on a *different* board — the same bytes a clipboard
		// paste would carry, without depending on headless clipboard permissions.
		const copied = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			return { props: shape.props, meta: shape.meta }
		})

		await backToList(page)
		await createBoard(page, 'Target')
		await openBoard(page, 'Target')

		// The target board has never heard of `price`.
		expect(
			await page.evaluate(() => {
				const editor = (window as unknown as { editor: EditorHandle }).editor
				return editor.getDocumentSettings().meta['lifeboard:properties'] ?? null
			})
		).toBeNull()

		await page.evaluate((copy) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([{ type: 'node.markdown', x: 300, y: 300, ...copy }])
		}, copied)

		// The value renders — which it can only do if the target board adopted the definition, since the
		// strip skips values it has no definition for.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip')).toContainText('₾ 99.00')
		expect(
			await page.evaluate(() => {
				const editor = (window as unknown as { editor: EditorHandle }).editor
				return editor.getDocumentSettings().meta['lifeboard:properties']
			})
		// The sidecar was seeded with the pre-rename 'currency'; adoption reads it through the
		// normalising parser, so the target board's registry holds the current name.
		).toEqual([{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }])
	})
})

test.describe('backup', () => {
	test('export → wipe → import restores boards as copies', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Backed up')
		await openBoard(page, 'Backed up')

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
					type: 'node.item',
					x: 150,
					y: 150,
					props: {
						w: 220,
						h: 260,
						title: 'Survivor',
						imageAssetId: null,
						tags: [],
						fields: [{ key: 'price', type: 'currency', value: 1234, unit: 'GEL' }],
					},
				},
			])
		})
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-item')).toHaveCount(1)
		await backToList(page)

		// The backup controls live in the sidebar's Storage section now, not under the board grid.
		await page.getByRole('button', { name: 'Settings' }).click()

		// Export and capture the zip bytes.
		const downloadPromise = page.waitForEvent('download')
		await page.getByRole('button', { name: /Export backup/ }).click()
		const download = await downloadPromise
		const zipPath = await download.path()
		expect(zipPath).toBeTruthy()

		await expect(page.locator('.lb-settings__message')).toContainText('Exported')

		// Wipe everything, exactly as the acceptance criterion says.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await expect(page.locator('.lb-list__board', { hasText: 'Backed up' })).toHaveCount(0)

		// Import the zip back.
		await page.getByRole('button', { name: 'Settings' }).click()
		const fileChooserPromise = page.waitForEvent('filechooser')
		await page.getByRole('button', { name: 'Import backup' }).click()
		const fileChooser = await fileChooserPromise
		await fileChooser.setFiles(zipPath!)

		// A successful import returns to the board grid, so the restored board is the assertion — not a
		// status line on a panel the user has already been taken away from.
		await expect(page.locator('.lb-list__board', { hasText: 'Backed up' })).toHaveCount(1)

		// Open the restored board: its content came back through tldraw's snapshot loader.
		await openBoard(page, 'Backed up')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-item')).toHaveCount(1)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-item__value--money')).toHaveText('₾ 1,234.00')
	})
})

interface EditorHandle {
	getCurrentPageShapes(): {
		id: string
		type: string
		props: Record<string, unknown>
		meta: Record<string, unknown>
	}[]
	getCamera(): { x: number; y: number; z: number }
	createShapes(shapes: unknown[]): void
	updateShape(shape: unknown): void
	deleteShapes(ids: string[]): void
	selectAll(): void
	select(...ids: string[]): void
	getSelectedShapeIds(): string[]
	duplicateShapes(ids: string[], offset: { x: number; y: number }): void
	getDocumentSettings(): { meta: Record<string, unknown> }
	updateDocumentSettings(settings: { meta: Record<string, unknown> }): void
}
