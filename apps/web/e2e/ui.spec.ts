import { expect, test } from '@playwright/test'
import { backToList, createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

test.describe('canvas chrome', () => {
	test('double-clicking empty canvas creates a note, already in editing mode', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 300)

		// Writing is the default action now — no picker, no text shape.
		await expect(page.locator('.lb-note--editing')).toBeVisible()
		expect(await countByType(page, 'node.markdown')).toBe(1)
		expect(await countByType(page, 'text')).toBe(0)

		// The caret is already in the note, so you can just type.
		await expect(page.locator('.lb-note__input')).toBeFocused()
		const editing = await page.evaluate(
			() => (window as unknown as { editor: EditorLike }).editor.getEditingShapeId() !== null
		)
		expect(editing).toBe(true)
	})

	test('markdown renders line by line as you leave each line', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 260)
		await expect(page.locator('.lb-note__input')).toBeFocused()

		await page.keyboard.type('# Chores')
		// Raw while the caret is on it — that is the point of live preview.
		await expect(page.locator('.lb-note__rendered h1')).toHaveCount(0)

		await page.keyboard.press('Enter')
		// Leaving the *line* renders it. Per-line, not per-block: previously nothing rendered until
		// you opened a whole new block, so a heading stayed raw while you typed the prose beneath it.
		await expect(page.locator('.lb-note__rendered h1')).toHaveText('Chores')
		await expect(page.locator('.lb-note__input')).toHaveCount(1)

		// A second line renders as soon as the caret leaves it, even though it is the same paragraph.
		await page.keyboard.type('first prose line')
		await page.keyboard.press('Enter')
		await expect(page.locator('.lb-note__rendered')).toContainText('first prose line')

		await page.keyboard.type('- morning care')
		await page.keyboard.press('Enter')
		// The bullet is prefilled by auto-continuation, so only the text is typed.
		await page.keyboard.type('workout')
		await page.keyboard.press('Escape')

		// Enter inserts a single newline every time — no block-type special cases.
		const md = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorLike }).editor
					.getCurrentPageShapes()
					.find((s) => s.type === 'node.markdown')!.props.md
		)
		expect(md).toBe('# Chores\nfirst prose line\n- morning care\n- workout')
		await expect(page.locator('.lb-md__body li')).toHaveCount(2)
	})

	test('list markers auto-continue, and an empty one leaves the list', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator('.lb-note__input')).toBeFocused()

		await page.keyboard.type('# Shopping')
		await page.keyboard.press('Enter')
		// Only the first marker is typed; the rest are prefilled.
		await page.keyboard.type('- [ ] standing desk')
		await page.keyboard.press('Enter')
		await page.keyboard.type('desk lamp')
		await page.keyboard.press('Enter')
		await page.keyboard.type('rug')
		await page.keyboard.press('Enter')
		// Enter on the now-empty marker leaves the list.
		await page.keyboard.press('Enter')
		await page.keyboard.type('**Budget:** 3000 GEL')
		await page.keyboard.press('Enter')
		await page.keyboard.type('1. first')
		await page.keyboard.press('Enter')
		await page.keyboard.type('second')
		await page.keyboard.press('Escape')

		const md = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorLike }).editor
					.getCurrentPageShapes()
					.find((s) => s.type === 'node.markdown')!.props.md
		)
		// A blank line after "rug" — leaving a list has to insert one, or the Budget line is a lazy
		// continuation of the last item and renders indented under the bullet.
		expect(md).toBe(
			'# Shopping\n- [ ] standing desk\n- [ ] desk lamp\n- [ ] rug\n\n**Budget:** 3000 GEL\n1. first\n2. second'
		)

		// Three tasks, an ordered list that counted up, and Budget outside the list.
		await expect(page.locator('.lb-md__body input[type=checkbox]')).toHaveCount(3)
		await expect(page.locator('.lb-md__body ol li')).toHaveCount(2)
		await expect(page.locator('.lb-md__body ul strong')).toHaveCount(0)
	})

	test('double-clicking an existing note puts the caret straight in the text', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Make a note and leave it. Waiting for focus first is not optional: typing before the editor
		// has the caret sends the keystrokes to the canvas, where letters are tool shortcuts.
		await page.mouse.dblclick(560, 260)
		await expect(page.locator('.lb-note__input')).toBeFocused()
		await page.keyboard.type('# Existing note')
		await page.keyboard.press('Escape')
		await page.mouse.click(900, 620)

		const point = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + 14 })
		})
		await page.mouse.dblclick(point.x, point.y)

		// One double-click is enough: tldraw focuses its own canvas container after React mounts the
		// editor, so without re-asserting focus the note looked active while keystrokes went nowhere
		// and you had to click a second time.
		await expect(page.locator('.lb-note__input')).toBeFocused()
		await page.keyboard.type('!')
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-md__body h1')).toHaveText('Existing note!')
	})

	test('a note grows with its content, and a vertical drag pins the height', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator('.lb-note__input')).toBeFocused()

		const readNote = () =>
			page.evaluate(() => {
				const s = (window as unknown as { editor: EditorLike }).editor
					.getCurrentPageShapes()
					.find((x) => x.type === 'node.markdown')!
				return { h: Math.round(s.props.h as number), auto: s.props.autoHeight as boolean }
			})

		const before = await readNote()
		await page.keyboard.type('# Title')
		await page.keyboard.press('Enter')
		await page.keyboard.type('a line\n\nanother line\n\nand a third')
		await page.keyboard.press('Escape')

		await expect.poll(async () => (await readNote()).h).toBeGreaterThan(before.h)
		expect((await readNote()).auto).toBe(true)

		// The height is a derived cache written with `history: 'ignore'`, so growing it must not have
		// added undo entries — one undo still reverts the whole editing session.
		const grown = await readNote()
		await page.keyboard.press('ControlOrMeta+z')
		await expect
			.poll(async () =>
				page.evaluate(
					() =>
						(window as unknown as { editor: EditorLike }).editor
							.getCurrentPageShapes()
							.filter((s) => s.type === 'node.markdown').length
				)
			)
			.toBe(0)
		await page.keyboard.press('ControlOrMeta+Shift+z')
		await expect.poll(async () => (await readNote()).h).toBe(grown.h)

		// Dragging the bottom edge is an explicit request for a fixed height.
		//
		// Selection first, in its own step: the edge handle only exists once tldraw has rendered the
		// selection foreground, and the bottom edge is only where it looks once auto-height has stopped
		// adjusting. Computing the coordinates in the same breath as selecting made this flaky — the
		// drag landed a pixel or two outside the handle and translated the shape instead of resizing it.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const s = editor.getCurrentPageShapes().find((x) => x.type === 'node.markdown')!
			editor.select(s.id)
		})
		// Two frames for tldraw to render the selection foreground the handle lives in.
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
		)

		let settled = -1
		await expect
			.poll(async () => {
				const { h } = await readNote()
				const stable = h === settled
				settled = h
				return stable
			})
			.toBe(true)

		const handle = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const s = editor.getCurrentPageShapes().find((x) => x.type === 'node.markdown')!
			const b = editor.getShapePageBounds(s.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h })
		})
		await page.mouse.move(handle.x, handle.y)
		await page.mouse.down()
		await page.mouse.move(handle.x, handle.y + 130, { steps: 8 })
		await page.mouse.up()

		await expect.poll(async () => (await readNote()).auto).toBe(false)
		expect((await readNote()).h).toBeGreaterThan(settled)
	})

	test('the context menu offers every node type so they stay discoverable', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Double-click is now "write", so right-click is what surfaces the other node types.
		await page.mouse.click(560, 300, { button: 'right' })
		for (const label of ['Add note', 'Add table']) {
			await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
		}
		// Retired node types stay registered but must not be offered anywhere.
		await expect(page.getByRole('menuitem', { name: 'Add item' })).toHaveCount(0)
		await expect(page.getByRole('menuitem', { name: 'Add rollup' })).toHaveCount(0)

		await page.getByRole('menuitem', { name: 'Add table' }).click()
		expect(await countByType(page, 'node.table')).toBe(1)
	})

	test('double-clicking an existing node still edits it rather than offering to create', async ({
		page,
	}) => {
		await gotoFresh(page)
		// The demo board is full of nodes.
		await expect(page.locator('.lb-strip').first()).toBeVisible()

		const before = await countByType(page, 'node.markdown')
		const point = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			// A rollup: the one remaining node type whose editor is a popover, so "did it edit rather
			// than create?" has an unambiguous answer on screen.
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.table')!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + 12 })
		})
		await page.mouse.dblclick(point.x, point.y)

		// It edits the node rather than creating a new one on top of it.
		await expect(page.locator('.lb-popover')).toBeVisible()
		expect(await countByType(page, 'node.markdown')).toBe(before)
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
		await expect(
			page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })
		).toBeVisible()

		await page.reload()
		await expect(
			page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })
		).toBeVisible()
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
		await expect
			.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 })
			.toBe(1)

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
		await expect
			.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 })
			.toBe(1)
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

/** The dot pattern's first circle offset, which encodes the camera position. */
async function firstDotOffset(page: import('@playwright/test').Page): Promise<string> {
	return page
		.locator('.lb-paper circle')
		.first()
		.getAttribute('cx')
		.then((v) => v ?? '')
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
	getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	getEditingShapeId(): string | null
	setCamera(c: { x: number; y: number; z: number }): unknown
	createShapes(s: unknown[]): unknown
	select(...ids: string[]): unknown
}
