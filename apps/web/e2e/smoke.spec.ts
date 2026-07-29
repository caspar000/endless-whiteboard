import { expect, test } from '@playwright/test'
import {
	backToList,
	countShapes,
	createBoard,
	dblclickNode,
	drawNode,
	gotoFresh,
	openBoard,
	waitForPersistedShapes,
	skipFirstRunDemo,
} from './helpers'

test.describe('first run', () => {
	test('seeds a demo shopping board that totals its items live', async ({ page }) => {
		await gotoFresh(page)

		// Milestone 10: the first-run board reproduces the driving use case.
		await expect(page.locator('.tl-canvas')).toBeVisible()
		await expect(page.locator('.lb-item').first()).toBeVisible()

		// Milestone 6 acceptance: the rollup shows a real total, computed from item fields.
		// 2399 + 850 + 240 + 320 + 120 + 480 = 4409
		await expect(page.locator('.lb-rollup__value')).toHaveText('₾4,409')

		// The grouped rollup breaks the same items down by category.
		const table = page.locator('.lb-rollup__table')
		await expect(table).toBeVisible()
		await expect(table).toContainText('desk')
		await expect(table).toContainText('₾3,489')
		await expect(table).toContainText('lighting')
	})

	test('totals update when an item is deleted', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.lb-rollup__value')).toHaveText('₾4,409')

		// Delete the ₾2,399 desk through the store, then assert the derived total followed.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const desk = editor
				.getCurrentPageShapes()
				.find((s) => s.type === 'node.item' && (s.props as { title?: string }).title === 'Standing desk')
			if (!desk) throw new Error('demo desk item not found')
			editor.deleteShapes([desk.id])
		})

		await expect(page.locator('.lb-rollup__value')).toHaveText('₾2,010')
	})
})

test.describe('board CRUD and persistence', () => {
	test('two boards hold independent content across a reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await createBoard(page, 'Board A')
		await openBoard(page, 'Board A')
		await drawNode(page, 'Markdown', { x: 400, y: 300 })
		await expect(page.locator('.lb-md')).toHaveCount(1)
		await backToList(page)

		await createBoard(page, 'Board B')
		await openBoard(page, 'Board B')
		await drawNode(page, 'Item', { x: 400, y: 300 })
		await drawNode(page, 'Item', { x: 700, y: 300 })
		await expect(page.locator('.lb-item')).toHaveCount(2)

		// Reload: tldraw's per-board persistenceKey must bring back exactly this board's content.
		// Wait for the write to actually land first — tldraw throttles persists by 350 ms and does
		// not flush on unload, so an immediate reload would legitimately lose the edits.
		await waitForPersistedShapes(page, 2)
		await page.reload()
		await expect(page.locator('.lb-item')).toHaveCount(2)
		await expect(page.locator('.lb-md')).toHaveCount(0)

		await backToList(page)
		await openBoard(page, 'Board A')
		await expect(page.locator('.lb-md')).toHaveCount(1)
		await expect(page.locator('.lb-item')).toHaveCount(0)
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

		await drawNode(page, 'Markdown', { x: 400, y: 250 }, { w: 360, h: 240 })
		await expect(page.locator('.lb-md')).toHaveCount(1)

		// Double-click to edit, type markdown, then leave editing.
		await dblclickNode(page, 'node.markdown')
		const textarea = page.locator('.lb-md__textarea')
		await expect(textarea).toBeFocused()
		await textarea.fill('# Chores\n\n- morning care\n- workout')
		await textarea.press('Escape')

		// Display mode shows rendered markdown, not source.
		await expect(page.locator('.lb-md__body h1')).toHaveText('Chores')
		await expect(page.locator('.lb-md__body li')).toHaveCount(2)

		// One editing session = one undo entry, so a single undo clears the whole text.
		await page.keyboard.press('ControlOrMeta+z')
		await expect(page.locator('.lb-md__body h1')).toHaveCount(0)
	})

	test('canvas does not pan while typing in a node', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)
		await drawNode(page, 'Markdown', { x: 400, y: 250 }, { w: 360, h: 240 })

		await dblclickNode(page, 'node.markdown')
		const cameraBefore = await page.evaluate(() =>
			(window as unknown as { editor: EditorHandle }).editor.getCamera()
		)

		// Space and arrow keys pan the canvas when it has focus — they must not while editing.
		const textarea = page.locator('.lb-md__textarea')
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

	test('item fields drive a rollup total that updates live', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Two items with prices, created through the store so the test stays about the rollup.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const mk = (title: string, price: number, x: number) => ({
				type: 'node.item',
				x,
				y: 100,
				props: {
					w: 220,
					h: 260,
					title,
					imageAssetId: null,
					tags: ['furniture'],
					fields: [
						{ key: 'price', type: 'currency', value: price, unit: 'GEL' },
						{ key: 'category', type: 'select', value: 'desk' },
					],
				},
			})
			editor.createShapes([mk('Desk', 1000, 100), mk('Chair', 500, 400)])
		})

		await drawNode(page, 'Rollup', { x: 700, y: 500 }, { w: 280, h: 180 })
		await expect(page.locator('.lb-rollup')).toHaveCount(1)

		// A fresh rollup has no field selected yet, so configure it through its editing UI.
		await dblclickNode(page, 'node.rollup')
		await page.locator('.lb-rollup__config').getByLabel('Field', { exact: true }).selectOption('price')
		await page.keyboard.press('Escape')

		await expect(page.locator('.lb-rollup__value')).toHaveText('₾1,500')

		// Editing an item's price must flow through to the total.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const chair = editor
				.getCurrentPageShapes()
				.find((s) => s.type === 'node.item' && (s.props as { title?: string }).title === 'Chair')
			if (!chair) throw new Error('chair not found')
			editor.updateShape({
				id: chair.id,
				type: 'node.item',
				props: {
					fields: [
						{ key: 'price', type: 'currency', value: 700, unit: 'GEL' },
						{ key: 'category', type: 'select', value: 'desk' },
					],
				},
			})
		})
		await expect(page.locator('.lb-rollup__value')).toHaveText('₾1,700')
	})

	test('the item editor panel is fully visible above other shapes', async ({ page }) => {
		await gotoFresh(page)
		// The demo board is deliberately crowded: neighbouring cards are what used to paint over the
		// panel, and the node's own `overflow: hidden` is what used to clip it to one row.
		await expect(page.locator('.lb-item').first()).toBeVisible()
		await dblclickNode(page, 'node.item')

		const panel = page.locator('.lb-popover')
		await expect(panel).toBeVisible()
		// Every control must be reachable, not just present — `toBeVisible` alone passed while the
		// panel was clipped, because the elements were laid out but painted nowhere.
		await expect(panel.getByRole('button', { name: 'Add' })).toBeVisible()
		await expect(panel.getByRole('button', { name: 'Save as template' })).toBeVisible()
		await expect(panel.getByPlaceholder('Add tag (e.g. desk)')).toBeVisible()

		// Nothing paints over it: the point at the panel's centre must hit the panel itself.
		const box = (await panel.boundingBox())!
		const onTop = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('.lb-popover') !== null,
			{ x: box.x + box.width / 2, y: box.y + box.height / 2 }
		)
		expect(onTop).toBe(true)

		// Editing a price *through the panel* updates the live rollup — the panel is wired to the
		// store, not just rendered. The first demo item is the ₾2,399 desk: 4409 - 2399 + 1000 = 3010.
		const priceInput = panel.getByLabel('Value of price')
		await priceInput.fill('1000')
		await expect(page.locator('.lb-rollup__value')).toHaveText('₾3,010')
	})

	test('all three node types appear in the toolbar from the registry', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// §7: registry-driven UI. These exist because the definitions are registered, not because
		// anything in the toolbar names them.
		await expect(page.getByTestId('tools.node-markdown')).toBeVisible()
		await expect(page.getByTestId('tools.node-item')).toBeVisible()
		await expect(page.getByTestId('tools.node-rollup')).toBeVisible()
	})

	test('item nodes survive copy-paste with fields intact', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{
						type: 'node.item',
					x: 200,
					y: 200,
					props: {
						w: 220,
						h: 260,
						title: 'Original',
						imageAssetId: null,
						tags: ['furniture'],
						fields: [{ key: 'price', type: 'currency', value: 99, unit: 'GEL' }],
					},
				},
			])
		})
		await expect(page.locator('.lb-item')).toHaveCount(1)

		// Duplicate rather than clipboard copy: it exercises the same props round-trip without
		// depending on headless clipboard permissions.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.selectAll()
			editor.duplicateShapes(editor.getSelectedShapeIds(), { x: 300, y: 0 })
		})

		await expect(page.locator('.lb-item')).toHaveCount(2)
		const values = await page.locator('.lb-item__value--money').allTextContents()
		expect(values).toEqual(['₾99', '₾99'])
		expect(await countShapes(page, 'node.item')).toBe(2)
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
		await expect(page.locator('.lb-item')).toHaveCount(1)
		await backToList(page)

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
		const fileChooserPromise = page.waitForEvent('filechooser')
		await page.getByRole('button', { name: 'Import backup' }).click()
		const fileChooser = await fileChooserPromise
		await fileChooser.setFiles(zipPath!)

		await expect(page.locator('.lb-settings__message')).toContainText('Imported')
		await expect(page.locator('.lb-list__board', { hasText: 'Backed up' })).toHaveCount(1)

		// Open the restored board: its content came back through tldraw's snapshot loader.
		await openBoard(page, 'Backed up')
		await expect(page.locator('.lb-item')).toHaveCount(1)
		await expect(page.locator('.lb-item__value--money')).toHaveText('₾1,234')
	})
})

interface EditorHandle {
	getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
	getCamera(): { x: number; y: number; z: number }
	createShapes(shapes: unknown[]): void
	updateShape(shape: unknown): void
	deleteShapes(ids: string[]): void
	selectAll(): void
	getSelectedShapeIds(): string[]
	duplicateShapes(ids: string[], offset: { x: number; y: number }): void
}
