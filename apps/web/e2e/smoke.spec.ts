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
	openSettings,
	skipFirstRunDemo,
	waitForStableHeight,
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

	test('select and multiSelect pick from options you build in the menu', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			;(window as unknown as { editor: EditorHandle }).editor.createShapes([
				{ type: 'note', x: 200, y: 200 },
			])
		})
		const id = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorHandle }).editor
					.getCurrentPageShapes()
					.find((s) => s.type === 'note')!.id
		)
		await page.evaluate((shapeId) => {
			;(window as unknown as { editor: EditorHandle }).editor.select(shapeId)
		}, id)
		await page.keyboard.press('Alt+p')

		const panel = page.locator('.lb-props')
		await expect(panel).toBeVisible()
		const create = async (option: string) => {
			await panel.getByLabel(/Search or create an option/).fill(option)
			await panel.getByRole('button', { name: `Create “${option}”` }).click()
		}

		await panel.getByRole('button', { name: 'New property…' }).click()
		// `url` is gone from the offered types — `link` is the same thing with a title, and reads a bare
		// address as a title-less link, so nothing was lost by folding them together.
		const offered = await panel.getByLabel('New property type').locator('option').allTextContents()
		expect(offered).not.toContain('url')
		expect(offered).toContain('link')
		await panel.getByLabel('New property name').fill('Status')
		await panel.getByLabel('New property type').selectOption('select')
		await panel.getByRole('button', { name: 'Add' }).click()
		await expect(panel.locator('.lb-choice')).toHaveCount(1)
		await panel.getByLabel('Value of Status').click()
		await expect(panel.getByText('No options yet. Type to create one.')).toBeVisible()
		await create('TODO')
		// Creating from the menu both records the option and picks it — one act, as in Notion.
		await expect(panel.getByLabel('Value of Status')).toHaveText('TODO')

		// A second option, added to the same list rather than replacing it.
		await panel.getByLabel('Value of Status').click()
		await create('DOING')
		await expect(panel.getByLabel('Value of Status')).toHaveText('DOING')
		await panel.getByLabel('Value of Status').click()
		await expect(panel.locator('.lb-choice__opt')).toHaveCount(2)
		// One choice, so picking replaces rather than accumulates.
		await panel.locator('.lb-choice__opt', { hasText: 'TODO' }).click()
		await expect(panel.getByLabel('Value of Status')).toHaveText('TODO')

		await panel.getByRole('button', { name: 'New property…' }).click()
		await panel.getByLabel('New property name').fill('Tags')
		await panel.getByLabel('New property type').selectOption('multiSelect')
		await panel.getByRole('button', { name: 'Add' }).click()
		// Wait for the row to land: the registry write remounts the panel, and a click sent into the
		// gap goes nowhere.
		await expect(panel.locator('.lb-choice')).toHaveCount(2)
		await panel.getByLabel('Add to Tags').click()
		await create('design')
		await create('urgent')
		// Several choices, so the menu stays open and both stick.
		await expect(panel.locator('.lb-choice__opt--on')).toHaveCount(2)

		// The options are on the board's definition, so every other shape gets the same menu.
		const stored = await page.evaluate(() =>
			JSON.stringify(
				(window as unknown as { editor: EditorHandle }).editor.getDocumentSettings().meta[
					'lifeboard:properties'
				]
			)
		)
		expect(stored).toContain('"options":["TODO","DOING"]')
		expect(stored).toContain('"options":["design","urgent"]')

		// And the values reach the card as chips.
		await page.keyboard.press('Escape')
		const strip = page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()
		await expect(strip.locator('.lb-chip')).toHaveCount(3)
		await expect(strip).toContainText('TODO')
	})

	test('any shape can gather, so a plain sticky totals what points at it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
					],
				},
			})
			const priced = (value: number) => ({
				'lifeboard:props': { price: value },
				'lifeboard:propOrder': ['price'],
			})
			editor.createShapes([
				{ type: 'note', x: 80, y: 30, meta: priced(1200) },
				{ type: 'note', x: 420, y: 30, meta: priced(340) },
				{ type: 'note', x: 760, y: 30, meta: priced(89) },
				// The collector: an ordinary sticky, carrying nothing of its own.
				{ type: 'note', x: 420, y: 330 },
			])
		})
		const geometry = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const notes = editor.getCurrentPageShapes().filter((s) => s.type === 'note')
			const centre = (id: string) => {
				const b = editor.getShapePageBounds(id)!
				return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
			}
			return {
				sources: notes.slice(0, 3).map((s) => centre(s.id)),
				target: centre(notes[3]!.id),
				targetId: notes[3]!.id,
			}
		})
		for (const from of geometry.sources) {
			await page.keyboard.press('a')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move((from.x + geometry.target.x) / 2, (from.y + geometry.target.y) / 2, {
				steps: 5,
			})
			await page.mouse.move(geometry.target.x, geometry.target.y, { steps: 5 })
			await page.mouse.up()
			await page.keyboard.press('Escape')
		}

		await page.evaluate((id) => {
			;(window as unknown as { editor: EditorHandle }).editor.select(id)
		}, geometry.targetId)
		await page.keyboard.press('Alt+p')
		const panel = page.locator('.lb-props')
		await expect(panel).toBeVisible()

		/*
		 * The flow, in full: switch Collects on, say which property, say what to do with it. No table
		 * node, no dock button, no column editor — the shape was a sticky before and still is one.
		 *
		 * `force` because the selection toolbar floats over the panel; that overlap is pre-existing and
		 * unrelated to what this is testing.
		 */
		await panel.getByLabel('Collects').check()
		await panel.getByLabel('Collect property').selectOption('price', { force: true })
		await panel.getByLabel('Collect show').selectOption('sum', { force: true })

		// Property before summary is not cosmetic: which summaries exist depends on the property's
		// type, so asking for the summary first could only ever offer the ones needing no property.
		const offered = await panel.getByLabel('Collect show').locator('option').allTextContents()
		expect(offered).toContain('the total')

		await page.keyboard.press('Escape')
		const strip = page.locator('.lb-board-host:not([data-hidden]) .lb-collect')
		await expect(strip.locator('.lb-collect__value')).toHaveText('₾ 1,629.00')
		await expect(strip.locator('.lb-collect__count')).toHaveText('3 items')

		/*
		 * Both ways at once is a balance, not a pile. Turn one of the three arrows around and the
		 * total has to fall by twice that shape's value — once for leaving the additions, once for
		 * joining the subtractions. 1200 + 340 − 89.
		 */
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrows = editor.getCurrentPageShapes().filter((s) => s.type === 'arrow')
			editor.deleteShapes([arrows[2]!.id])
		})
		await page.evaluate((id) => {
			;(window as unknown as { editor: EditorHandle }).editor.select(id)
		}, geometry.targetId)
		await page.keyboard.press('Alt+p')
		await panel.getByLabel('Collect from').selectOption('either', { force: true })
		await page.keyboard.press('Escape')
		// Two arrows left, both inbound, so "either way" still totals them both.
		await expect(strip.locator('.lb-collect__value')).toHaveText('₾ 1,540.00')

		// Alongside, never instead of: the sticky keeps whatever it was, and the total is a footer.
		const stillANote = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorHandle }).editor
					.getCurrentPageShapes()
					.filter((s) => s.type === 'note').length
		)
		expect(stillANote).toBe(4)
	})

	test('a note can put a live total in the middle of a sentence', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		const source = 'In: **{sum price in}** from {count in}\n\nFree: **{sum price either}**'
		await page.evaluate((md) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
					],
				},
			})
			const priced = (value: number) => ({
				'lifeboard:props': { price: value },
				'lifeboard:propOrder': ['price'],
			})
			editor.createShapes([
				{ type: 'note', x: 60, y: 40, meta: priced(8000) },
				{ type: 'note', x: 400, y: 40, meta: priced(200) },
				{ type: 'note', x: 740, y: 40, meta: priced(2000) },
				{
					type: 'node.markdown',
					x: 250,
					y: 350,
					props: { w: 460, h: 180, autoHeight: true, md },
				},
			])
			// The arrows below are drawn with the mouse, so every shape has to be on screen — a new
			// board does not guarantee the camera is where the shapes were put.
			editor.setCamera({ x: 0, y: 0, z: 1 })
		}, source)

		/*
		 * The note auto-heights, and it shrinks: created at 180 it settles near 90 once its content is
		 * measured. Reading bounds before that lands the arrows below the shape, where they bind to
		 * nothing and every expression reports an honest zero.
		 */
		await waitForStableHeight(page, 'node.markdown')
		const geometry = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const stickies = editor.getCurrentPageShapes().filter((s) => s.type === 'note')
			const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const centre = (id: string) => {
				const b = editor.getShapePageBounds(id)!
				return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
			}
			return {
				a: centre(stickies[0]!.id),
				b: centre(stickies[1]!.id),
				out: centre(stickies[2]!.id),
				note: centre(note.id),
			}
		})
		const draw = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
			await page.keyboard.press('a')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
			await page.mouse.move(to.x, to.y, { steps: 5 })
			await page.mouse.up()
			await page.keyboard.press('Escape')
		}
		await draw(geometry.a, geometry.note)
		await draw(geometry.b, geometry.note)
		await draw(geometry.note, geometry.out)

		// 8000 + 200 in, 2000 out, and the balance of the three.
		const body = page.locator('.lb-board-host:not([data-hidden]) .lb-md__body').first()
		await expect(body).toContainText('In: ₾ 8,200.00 from 2')
		await expect(body).toContainText('Free: ₾ 6,200.00')

		/*
		 * The *source* keeps the expression. That asymmetry is the feature — you edit `{sum price in}`
		 * and read ₾8,200 — and it is also what keeps the editor from fighting a value that rewrites
		 * itself while you type in it.
		 */
		const stored = await page.evaluate(
			() =>
				(
					(window as unknown as { editor: EditorHandle }).editor
						.getCurrentPageShapes()
						.find((s) => s.type === 'node.markdown')!.props as { md: string }
				).md
		)
		expect(stored).toBe(source)
	})

	test('expressions work in a sticky, a text shape and a shape label too', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' },
					],
				},
			})
			const priced = (value: number) => ({
				'lifeboard:props': { price: value },
				'lifeboard:propOrder': ['price'],
			})
			const rich = (text: string) => ({
				type: 'doc',
				content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
			})
			editor.createShapes([
				{ type: 'note', x: 60, y: 40, meta: priced(1200) },
				{ type: 'note', x: 400, y: 40, meta: priced(340) },
				// The collector is a plain sticky whose *text* holds the expression.
				{ type: 'note', x: 230, y: 360, props: { richText: rich('Total {sum price in}') } },
				{
					type: 'geo',
					x: 620,
					y: 460,
					props: { w: 240, h: 90, richText: rich('Board: {sum price page}') },
				},
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})

		const geometry = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const notes = editor.getCurrentPageShapes().filter((s) => s.type === 'note')
			const centre = (id: string) => {
				const b = editor.getShapePageBounds(id)!
				return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
			}
			return { a: centre(notes[0]!.id), b: centre(notes[1]!.id), hub: centre(notes[2]!.id) }
		})
		for (const from of [geometry.a, geometry.b]) {
			await page.keyboard.press('a')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move((from.x + geometry.hub.x) / 2, (from.y + geometry.hub.y) / 2, {
				steps: 5,
			})
			await page.mouse.move(geometry.hub.x, geometry.hub.y, { steps: 5 })
			await page.mouse.up()
			await page.keyboard.press('Escape')
		}

		const canvasText = () =>
			page.evaluate(() =>
				[
					...document.querySelectorAll(
						'.lb-board-host:not([data-hidden]) .tl-shape[data-shape-type="note"], .lb-board-host:not([data-hidden]) .tl-shape[data-shape-type="geo"]'
					),
				]
					.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim())
					.filter(Boolean)
			)

		// The sticky's own text, and a rectangle's label, both evaluated — neither renderer is ours.
		await expect.poll(canvasText).toContain('Total ₾ 1,540.00')
		expect(await canvasText()).toContain('Board: ₾ 1,540.00')

		/*
		 * Editing shows the source. Without that the caret would sit in text rewriting itself as you
		 * type — you would go to fix `{sum pric` and find a number under your hands.
		 */
		await page.mouse.dblclick(geometry.hub.x, geometry.hub.y)
		await expect.poll(canvasText).toContain('Total {sum price in}')
		await page.keyboard.press('Escape')
		await expect.poll(canvasText).toContain('Total ₾ 1,540.00')

		// And nothing was written: the store still holds the expression.
		const stored = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const note = editor.getCurrentPageShapes().filter((s) => s.type === 'note')[2]!
			return JSON.stringify(note.props.richText)
		})
		expect(stored).toContain('{sum price in}')
	})

	test('rating, progress and status carry their own controls and reach the card', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await page.evaluate(() => {
			;(window as unknown as { editor: EditorHandle }).editor.createShapes([
				{ type: 'note', x: 200, y: 200 },
			])
		})
		const id = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorHandle }).editor
					.getCurrentPageShapes()
					.find((s) => s.type === 'note')!.id
		)
		await page.evaluate((shapeId) => {
			;(window as unknown as { editor: EditorHandle }).editor.select(shapeId)
		}, id)
		await page.keyboard.press('Alt+p')

		const panel = page.locator('.lb-props')
		await expect(panel).toBeVisible()
		const define = async (name: string, type: string) => {
			await panel.getByRole('button', { name: 'New property…' }).click()
			await panel.getByLabel('New property name').fill(name)
			await panel.getByLabel('New property type').selectOption(type)
			await panel.getByRole('button', { name: 'Add' }).click()
		}

		// Rating: five stars, and clicking the one you are on clears it — the only route back to unrated.
		await define('Quality', 'rating')
		const stars = panel.getByRole('group', { name: 'Value of Quality' })
		await stars.getByLabel('4 of 5').click()
		await expect(stars.locator('.lb-rating__star--on')).toHaveCount(4)
		await stars.getByLabel('4 of 5').click()
		await expect(stars.locator('.lb-rating__star--on')).toHaveCount(0)
		await stars.getByLabel('3 of 5').click()

		await define('Built', 'progress')
		await panel.getByLabel('Value of Built').fill('65')

		// Status: options live in stages, and creating one asks which — there is no sensible default.
		await define('Stage', 'status')
		await panel.getByLabel('Value of Stage').click()
		for (const [option, stage] of [
			['BACKLOG', 'To-do'],
			['IN REVIEW', 'In progress'],
			['SHIPPED', 'Done'],
		]) {
			await panel.getByLabel(/Search or create an option/).fill(option!)
			await panel.getByLabel(`Create “${option}” in ${stage}`).click()
			await panel.getByLabel('Value of Stage').click()
		}
		await expect(panel.locator('.lb-choice__stage')).toHaveCount(3)

		/*
		 * A status option's colour comes from its stage rather than from its own text, which is the
		 * whole difference between a status and a select: two boards spelling "done" differently should
		 * still look alike. Asserted through the hue variable, since that is what the rule reads. Taken
		 * while the menu is still open — picking a single choice closes it.
		 */
		const hues = await panel.evaluate((el) =>
			[...el.querySelectorAll<HTMLElement>('.lb-choice__row .lb-chip')].map((chip) =>
				chip.style.getPropertyValue('--lb-opt-h')
			)
		)
		expect(new Set(hues).size).toBe(3)

		await panel.locator('.lb-choice__opt', { hasText: 'IN REVIEW' }).click()
		await expect(panel.getByLabel('Value of Stage')).toHaveText('IN REVIEW')

		// Stored on the definition, so every other shape on the board inherits the same vocabulary.
		const stored = await page.evaluate(() =>
			JSON.stringify(
				(window as unknown as { editor: EditorHandle }).editor.getDocumentSettings().meta[
					'lifeboard:properties'
				]
			)
		)
		expect(stored).toContain('"SHIPPED":"done"')
		expect(stored).toContain('"IN REVIEW":"active"')

		// On the card: stars as text, a bar for progress, a stage-coloured chip for the status.
		await page.keyboard.press('Escape')
		const strip = page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()
		await expect(strip).toContainText('★★★☆☆')
		await expect(strip.locator('.lb-bar__fill')).toHaveCSS('width', /.+/)
		await expect(strip.locator('.lb-bar')).toContainText('65%')
		await expect(strip.locator('.lb-chip')).toHaveText('IN REVIEW')

		// And both numeric newcomers aggregate, because "numeric" is one question asked in one place.
		const summable = await page.evaluate(() => {
			const meta = (window as unknown as { editor: EditorHandle }).editor.getDocumentSettings()
				.meta['lifeboard:properties'] as { id: string; type: string }[]
			return meta.map((d) => d.type)
		})
		expect(summable).toContain('rating')
		expect(summable).toContain('progress')
	})

	test('a table can follow the arrows drawn into it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Three priced notes and a table, laid out so nothing overlaps and every drag is unambiguous.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'financial', unit: 'GEL' }],
				},
			})
			editor.createShapes([
				{ type: 'geo', x: 100, y: 100, props: { w: 120, h: 80 }, meta: { 'lifeboard:props': { price: 1200 }, 'lifeboard:propOrder': ['price'] } },
				{ type: 'geo', x: 100, y: 260, props: { w: 120, h: 80 }, meta: { 'lifeboard:props': { price: 400 }, 'lifeboard:propOrder': ['price'] } },
				{ type: 'geo', x: 100, y: 420, props: { w: 120, h: 80 }, meta: { 'lifeboard:props': { price: 900 }, 'lifeboard:propOrder': ['price'] } },
				{
					type: 'node.table',
					x: 500,
					y: 220,
					props: {
						w: 240,
						h: 160,
						title: 'Connected',
						source: { shapeTypes: null, scope: 'connected', frameId: null, filters: [] },
						columns: [{ key: 'price', summary: 'sum', width: 1 }],
						groupBy: null,
						sorts: [],
						layout: { mode: 'value', maxRows: 12 },
					},
				},
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})

		const host = page.locator('.lb-board-host:not([data-hidden])')
		const total = host.locator('.lb-table__value').first()
		const count = host.locator('.lb-table__count').first()
		// Nothing is wired up yet, so a connected table is empty rather than quietly showing the whole
		// board — three priced shapes are sitting right there for it to have got wrong.
		await expect(count).toHaveText('0 rows')

		/*
		 * Draw the arrows the way a person does — pick the arrow tool and drag from the shape to the
		 * table — rather than fabricating binding records. The binding is the entire premise of the
		 * feature, so the test has to prove tldraw really makes one from an ordinary drag.
		 */
		const drawArrow = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
			await page.keyboard.press('a')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 5 })
			await page.mouse.move(to.x, to.y, { steps: 5 })
			await page.mouse.up()
			await page.keyboard.press('Escape')
		}
		// Screen coordinates: the camera is at the origin with zoom 1, and the canvas is offset by the
		// sidebar and tab strip, so read the offset back rather than guessing it.
		const origin = await page.evaluate(() => {
			const box = document
				.querySelector('.lb-board-host:not([data-hidden]) .tl-container')!
				.getBoundingClientRect()
			return { x: box.x, y: box.y }
		})
		const at = (x: number, y: number) => ({ x: origin.x + x, y: origin.y + y })

		await drawArrow(at(160, 140), at(620, 300))
		await expect(count).toHaveText('1 row')
		await expect(total).toContainText('1,200')

		await drawArrow(at(160, 300), at(620, 300))
		await expect(count).toHaveText('2 rows')
		await expect(total).toContainText('1,600')

		// The third shape is never wired, so it never counts — which is the whole distinction between
		// this and a page-scoped table.
		const wired = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			return editor.getCurrentPageShapes().filter((s) => s.type === 'arrow').length
		})
		expect(wired).toBe(2)

		// An arrow drawn across empty space is a drawing, not a relation: no binding, no row.
		await drawArrow(at(300, 600), at(420, 640))
		await expect(count).toHaveText('2 rows')

		// Deleting an arrow takes its row with it — the graph is live, not a snapshot.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			editor.deleteShapes([arrow.id])
		})
		await expect(count).toHaveText('1 row')
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

	test('Escape in the new-property form cancels the form and nothing else', async ({ page }) => {
		/*
		 * One keystroke used to do three things. tldraw's Escape branch runs before it checks whether an
		 * input has focus, so it cleared the selection; the panel is only drawn for a single selected
		 * shape, so it vanished; and its own window listener closed it for good measure. The property you
		 * were half-way through naming went with them.
		 */
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
		await panel.getByLabel('New property name').fill('Half-typed')
		await page.keyboard.press('Escape')

		// The form is gone, and only the form.
		await expect(panel.getByLabel('New property name')).toHaveCount(0)
		await expect(panel.getByRole('button', { name: 'New property…' })).toBeVisible()
		await expect(panel).toBeVisible()
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { editor: EditorHandle }).editor.getSelectedShapeIds().length
			)
		).toBe(1)

		// Reopening starts blank rather than with the abandoned name, and Escape still closes the panel
		// when there is no form to cancel.
		await panel.getByRole('button', { name: 'New property…' }).click()
		await expect(panel.getByLabel('New property name')).toHaveValue('')
		await page.keyboard.press('Escape')
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-props')).toHaveCount(0)
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

		// The backup controls live on Settings → Storage now, not under the board grid.
		await openSettings(page, 'Storage')

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
		await openSettings(page, 'Storage')
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
	setCamera(camera: { x: number; y: number; z: number }): void
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	setCamera(camera: { x: number; y: number; z: number }): void
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
