import { expect, test } from '@playwright/test'
import { backToList, createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

test.describe('canvas chrome', () => {
	test('double-clicking empty canvas asks which node to create, and creates it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Empty area of a blank board.
		await page.mouse.dblclick(760, 420)

		const menu = page.getByRole('menu', { name: 'Create a node' })
		await expect(menu).toBeVisible()
		// Registry-driven, so all three node types are offered — plus plain text, which is what the
		// gesture used to create outright.
		for (const label of ['Markdown', 'Item', 'Rollup', 'Text']) {
			await expect(menu.getByRole('menuitem', { name: new RegExp(label) })).toBeVisible()
		}

		// tldraw's default (silently creating a text shape) must be gone.
		expect(await countByType(page, 'text')).toBe(0)

		await menu.getByRole('menuitem', { name: /Item/ }).click()
		await expect(menu).toBeHidden()
		await expect(page.locator('.lb-item')).toHaveCount(1)
		expect(await countByType(page, 'node.item')).toBe(1)
		expect(await countByType(page, 'text')).toBe(0)

		// Created centred on the click and already in edit mode, so you can type straight away.
		const editing = await page.evaluate(
			() => (window as unknown as { editor: EditorLike }).editor.getEditingShapeId() !== null
		)
		expect(editing).toBe(true)
	})

	test('the picker dismisses without creating anything on Escape', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(760, 420)
		await expect(page.getByRole('menu', { name: 'Create a node' })).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.getByRole('menu', { name: 'Create a node' })).toBeHidden()

		expect(await countShapesTotal(page)).toBe(0)
	})

	test('double-clicking an existing node still edits it rather than offering to create', async ({
		page,
	}) => {
		await gotoFresh(page)
		// The demo board is full of nodes.
		await expect(page.locator('.lb-item').first()).toBeVisible()

		const point = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.item')!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + 12 })
		})
		await page.mouse.dblclick(point.x, point.y)

		await expect(page.getByRole('menu', { name: 'Create a node' })).toBeHidden()
		await expect(page.locator('.lb-popover')).toBeVisible()
	})

	test('the canvas has dotted paper and no style panel', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		// Dotted paper: rendered as the canvas background so it pans and zooms with the board.
		const paper = page.locator('.lb-paper')
		await expect(paper).toBeVisible()
		await expect(paper.locator('pattern')).not.toHaveCount(0)

		// The dots are anchored in page space, so panning must move the pattern offset.
		const before = await firstDotOffset(page)
		await page.evaluate(() => {
			;(window as unknown as { editor: EditorLike }).editor.setCamera({ x: 137, y: 61, z: 1 })
		})
		await expect.poll(() => firstDotOffset(page)).not.toBe(before)

		// The top-right colour/opacity panel is gone.
		await expect(page.locator('.tlui-style-panel')).toHaveCount(0)
	})
})

test.describe('home screen', () => {
	test('shows a sidebar with live counts and filters the grid', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Second board')

		const sidebar = page.locator('.lb-sidebar')
		await expect(sidebar.getByRole('button', { name: /All boards 2/ })).toBeVisible()
		await expect(sidebar.getByRole('button', { name: /Favourites 0/ })).toBeVisible()
		await expect(page.locator('.lb-card')).toHaveCount(2)

		// Favourites is empty until something is starred, and then contains exactly that board.
		await sidebar.getByRole('button', { name: /Favourites/ }).click()
		await expect(page.locator('.lb-card')).toHaveCount(0)
		await expect(page.getByText('No favourites yet.')).toBeVisible()

		await sidebar.getByRole('button', { name: /All boards/ }).click()
		const card = page.locator('.lb-card', { hasText: 'Second board' })
		await card.hover()
		await card.getByRole('button', { name: 'Favourite Second board' }).click()

		await expect(sidebar.getByRole('button', { name: /Favourites 1/ })).toBeVisible()
		await sidebar.getByRole('button', { name: /Favourites/ }).click()
		await expect(page.locator('.lb-card')).toHaveCount(1)
		await expect(page.locator('.lb-card', { hasText: 'Second board' })).toHaveCount(1)
	})

	test('favourite state survives a reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const card = page.locator('.lb-card').first()
		await card.hover()
		await card.getByRole('button', { name: /^Favourite / }).click()
		await expect(page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })).toBeVisible()

		await page.reload()
		await expect(page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })).toBeVisible()
	})

	test('board cards show a thumbnail of the board once it has been closed', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Sketch')
		await openBoard(page, 'Sketch')

		await page.evaluate(() => {
			;(window as unknown as { editor: EditorLike }).editor.createShapes([
				{
					type: 'node.markdown',
					x: 0,
					y: 0,
					props: { w: 320, h: 160, md: '# Thumbnail me' },
				},
			])
		})
		await expect(page.locator('.lb-md')).toHaveCount(1)
		await backToList(page)

		// The thumbnail is captured from the live editor as the board unmounts, so it appears shortly
		// after leaving rather than instantly.
		const card = page.locator('.lb-card', { hasText: 'Sketch' })
		await expect.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 }).toBe(1)

		// A real image, not a zero-byte placeholder.
		const size = await card.locator('.lb-card__image').evaluate((img) => {
			const el = img as HTMLImageElement
			return { w: el.naturalWidth, h: el.naturalHeight }
		})
		expect(size.w).toBeGreaterThan(50)
		expect(size.h).toBeGreaterThan(50)

		// And it stays put. A second export used to run from the editor's unmount path, while the board
		// was hidden for the persistence drain, and overwrote this one with a version missing every node
		// background and font — previews looked right for about a second and then decayed.
		const bytes = await thumbnailBytes(page)
		expect(bytes.length).toBeGreaterThan(0)
		await page.waitForTimeout(3000)
		expect(await thumbnailBytes(page)).toEqual(bytes)
	})

	test('the board title can be renamed by double-clicking it on the canvas', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		const title = page.locator('.lb-board__name')
		await expect(title).toHaveText('Home office shopping')
		await title.dblclick()

		const input = page.getByLabel('Board name')
		await expect(input).toBeFocused()
		await input.fill('Autumn shopping')
		await input.press('Enter')

		await expect(page.locator('.lb-board__name')).toHaveText('Autumn shopping')

		// The rename is persisted, not just local to the chrome.
		await backToList(page)
		await expect(page.locator('.lb-card', { hasText: 'Autumn shopping' })).toHaveCount(1)
	})

	test('renaming on the canvas can be abandoned with Escape', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		await page.locator('.lb-board__name').dblclick()
		const input = page.getByLabel('Board name')
		await input.fill('Discard me')
		await input.press('Escape')

		await expect(page.locator('.lb-board__name')).toHaveText('Home office shopping')
	})

	test('an unopened board shows a placeholder rather than a broken image', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Created through the index without ever opening it, so it has no thumbnail.
		await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve) => {
				const req = indexedDB.open('lifeboard-kv')
				req.onsuccess = () => resolve(req.result)
			})
			const boards = await new Promise<{ id: string }[]>((resolve) => {
				const q = db.transaction('kv', 'readonly').objectStore('kv').get('boards')
				q.onsuccess = () => resolve(q.result ?? [])
			})
			const now = Date.now()
			await new Promise<void>((resolve) => {
				const tx = db.transaction('kv', 'readwrite')
				tx.objectStore('kv').put(
					[...boards, { id: 'never-opened', name: 'Untouched', createdAt: now, updatedAt: now }],
					'boards'
				)
				tx.oncomplete = () => resolve()
			})
			db.close()
		})
		await page.reload()

		const card = page.locator('.lb-card', { hasText: 'Untouched' })
		await expect(card.locator('.lb-card__placeholder')).toBeVisible()
		await expect(card.locator('.lb-card__image')).toHaveCount(0)
	})

	test('deleting a board also removes its thumbnail', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const card = page.locator('.lb-card').first()
		await expect.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 }).toBe(1)
		await expect.poll(() => countThumbnails(page)).toBe(1)

		await card.hover()
		await card.getByRole('button', { name: 'Delete', exact: true }).click()
		await card.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-card')).toHaveCount(0)

		// Left behind, the thumbnail would be an orphaned blob nothing can ever reach again.
		await expect.poll(() => countThumbnails(page)).toBe(0)
	})
})

// --- helpers ---------------------------------------------------------------

async function countByType(page: import('@playwright/test').Page, type: string): Promise<number> {
	return page.evaluate(
		(t) =>
			(window as unknown as { editor: EditorLike }).editor
				.getCurrentPageShapes()
				.filter((s) => s.type === t).length,
		type
	)
}

async function countShapesTotal(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(
		() => (window as unknown as { editor: EditorLike }).editor.getCurrentPageShapes().length
	)
}

/** The dot pattern's first circle offset, which encodes the camera position. */
async function firstDotOffset(page: import('@playwright/test').Page): Promise<string> {
	return page.locator('.lb-paper circle').first().getAttribute('cx').then((v) => v ?? '')
}

/** Sizes of every stored thumbnail, sorted — a cheap fingerprint for "did these change?". */
async function thumbnailBytes(page: import('@playwright/test').Page): Promise<number[]> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('lifeboard-kv')
			req.onsuccess = () => resolve(req.result)
		})
		const store = () => db.transaction('kv', 'readonly').objectStore('kv')
		const keys = await new Promise<IDBValidKey[]>((resolve) => {
			const q = store().getAllKeys()
			q.onsuccess = () => resolve(q.result)
		})
		const sizes: number[] = []
		for (const key of keys.filter((k) => String(k).startsWith('thumb:'))) {
			const blob = await new Promise<Blob | undefined>((resolve) => {
				const q = store().get(key)
				q.onsuccess = () => resolve(q.result)
			})
			sizes.push(blob?.size ?? 0)
		}
		db.close()
		return sizes.sort((a, b) => a - b)
	})
}

async function countThumbnails(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('lifeboard-kv')
			req.onsuccess = () => resolve(req.result)
		})
		const keys = await new Promise<IDBValidKey[]>((resolve) => {
			const q = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys()
			q.onsuccess = () => resolve(q.result)
		})
		db.close()
		return keys.filter((k) => String(k).startsWith('thumb:')).length
	})
}

interface EditorLike {
	getCurrentPageShapes(): { id: string; type: string }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	getEditingShapeId(): string | null
	setCamera(c: { x: number; y: number; z: number }): unknown
	createShapes(s: unknown[]): unknown
}
