import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Every test starts from a clean origin. The app seeds a demo board on first run, so without this
 * the tests would inherit whichever boards a previous test left behind.
 */
export async function gotoFresh(page: Page): Promise<void> {
	await page.goto('/')

	// Wait for the app to settle *before* wiping. First run seeds a demo board asynchronously, and
	// wiping mid-flight loses the race in the worst possible way: the `demoSeeded` marker lands
	// after the wipe while the board index does not, so the next load sees "already seeded, no
	// boards" and shows an empty app forever.
	await page
		.locator('.tl-canvas, .lb-list__boards, .lb-list__empty')
		.first()
		.waitFor({ state: 'visible' })

	await page.evaluate(async () => {
		localStorage.clear()
		const dbs = (await indexedDB.databases?.()) ?? []
		await Promise.all(
			dbs.map(
				(db) =>
					new Promise<void>((resolve) => {
						if (!db.name) return resolve()
						const req = indexedDB.deleteDatabase(db.name)
						req.addEventListener('success', () => resolve())
						req.addEventListener('error', () => resolve())
						req.addEventListener('blocked', () => resolve())
					})
			)
		)
	})
	await page.goto('/#/')
	await page.reload()
}

/** Waits for the demo board that first run seeds, then goes back to the board list. */
export async function skipFirstRunDemo(page: Page): Promise<void> {
	await expect(page.locator('.tl-canvas')).toBeVisible()
	await backToList(page)
}

export async function backToList(page: Page): Promise<void> {
	await page.getByRole('button', { name: '← Boards' }).click()
	// The home screen's heading is the *section* name now ("All boards"); the app name lives in the
	// sidebar. Waiting on the sidebar nav is the stable signal that the home screen is up.
	await expect(page.locator('.lb-sidebar__nav')).toBeVisible()
}

/**
 * Opens a board by name and waits until *that* board's editor is mounted.
 *
 * Waiting on `.tl-canvas` alone is not enough: `window.editor` still points at the previously
 * mounted (now disposed) editor until the new `onMount` runs, and shapes created on a disposed
 * editor silently never render. The board name in the chrome only appears once the right board is
 * mounted, so that is the signal.
 */
export async function openBoard(page: Page, name: string): Promise<void> {
	await page.locator('.lb-list__board', { hasText: name }).getByText(name).click()
	await expect(page.locator('.tl-canvas')).toBeVisible()
	await expect(page.locator('.lb-board__name')).toHaveText(name)
	await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))
}

export async function createBoard(page: Page, name?: string): Promise<void> {
	// 'New board' appears in both the sidebar and the section header on the home screen.
	await page.getByRole('button', { name: 'New board' }).first().click()
	await expect(page.locator('.tl-canvas')).toBeVisible()
	if (name) {
		await backToList(page)
		// Target the *untitled* row, not "the first row". The list sorts by `updatedAt`, and leaving
		// a board bumps its timestamp asynchronously — so "first row" is genuinely racy and would
		// sometimes rename a previously-created board instead, silently making the rest of the test
		// operate on the wrong board.
		const row = page.locator('.lb-list__board', { hasText: 'Untitled board' }).first()
		await row.getByRole('button', { name: 'Rename' }).click()
		// Resolved globally, not within `row`: clicking Rename swaps that row's title button for the
		// input, so the row no longer contains the text "Untitled board" and a row-scoped locator
		// would never resolve. Only one row can be renaming at a time, so this is unambiguous.
		const input = page.getByLabel('Board name')
		await input.fill(name)
		await input.press('Enter')
		await expect(page.locator('.lb-list__board', { hasText: name })).toHaveCount(1)
	}
}

/** Selects a node tool from the registry-driven toolbar and drags out a shape. */
export async function drawNode(
	page: Page,
	label: 'Note' | 'Table',
	at: { x: number; y: number },
	size = { w: 240, h: 260 }
): Promise<void> {
	const toolId = labelToToolId(label)
	await page.getByTestId(`tools.${toolId}`).click()
	// Switching tools is asynchronous, and the click resolving is not the same as the tool being
	// current. Dragging too early is handled by the *select* tool, which draws a marquee and creates
	// nothing — a failure that looks like the node type being broken.
	await page.waitForFunction(
		(id) =>
			(
				window as unknown as { editor: { getCurrentToolId(): string } }
			).editor.getCurrentToolId() === id,
		toolId
	)
	await page.mouse.move(at.x, at.y)
	await page.mouse.down()
	await page.mouse.move(at.x + size.w, at.y + size.h, { steps: 8 })
	await page.mouse.up()
}

function labelToToolId(label: 'Note' | 'Table'): string {
	// Mirrors toolIdForNodeType(): tldraw tool ids cannot contain dots.
	return { Note: 'node-markdown', Table: 'node-table' }[label]
}

/**
 * Double-clicks a node at its position on the canvas, which is how a user enters edit mode.
 *
 * Clicking the node's DOM element does not work — and *should* not: in display mode the node
 * container has `pointer-events: none` so the shape drags and marquee-selects like any other shape
 * (§4.6). The double-click has to reach the canvas, which then routes it to the shape underneath.
 */
/**
 * Opens the properties panel for a shape, the way a user does: select it, then `alt+p`.
 *
 * Not ⌘-click — tldraw's select tool already uses `accelKey` on a shape click (select inside group), so
 * the app deliberately uses right-click and `alt+p` instead.
 */
export async function openProperties(page: Page, shapeType: string): Promise<void> {
	await page.evaluate((type) => {
		const editor = (window as unknown as { editor: EditorLike }).editor
		const shape = editor.getCurrentPageShapes().find((s) => s.type === type)
		if (!shape) throw new Error(`No shape of type ${type} on the page`)
		editor.select(shape.id)
	}, shapeType)
	await page.keyboard.press('Alt+p')
	await expect(page.locator('.lb-props')).toBeVisible()
}

/**
 * Waits until a node's auto-height has settled.
 *
 * Auto-height writes `h` from a ResizeObserver a frame or two after the shape first renders, so bounds
 * read immediately after creating one are stale. Clicking a point computed from them lands outside the
 * now-shorter shape and silently does nothing — which showed up as a config panel that never opened.
 */
async function waitForStableHeight(page: Page, shapeType: string): Promise<void> {
	let last = -1
	for (let i = 0; i < 40; i++) {
		const h = await page.evaluate((type) => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === type)
			return shape ? Math.round((shape.props as { h?: number }).h ?? 0) : -1
		}, shapeType)
		if (h === last) return
		last = h
		await page.waitForTimeout(50)
	}
}

export async function dblclickNode(page: Page, shapeType: string): Promise<void> {
	await waitForStableHeight(page, shapeType)
	const point = await page.evaluate((type) => {
		const editor = (window as unknown as { editor: EditorLike }).editor
		const shape = editor.getCurrentPageShapes().find((s) => s.type === type)
		if (!shape) throw new Error(`No shape of type ${type} on the page`)
		const bounds = editor.getShapePageBounds(shape.id)
		if (!bounds) throw new Error(`No bounds for shape ${shape.id}`)
		// Near the top of the shape: the middle of an item node is its image, and the middle of a
		// rollup is its value — the top edge is inert in every node type.
		return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + 12 })
	}, shapeType)
	await page.mouse.dblclick(point.x, point.y)
}

/**
 * Waits until the open board's shapes are actually in tldraw's IndexedDB.
 *
 * tldraw persists on a 350 ms throttle and does not flush on unload, so reloading straight after an
 * edit legitimately loses it. Rather than sleeping, this polls the database — which means the
 * persistence test asserts the thing it claims to (the data is on disk) instead of assuming it.
 */
export async function waitForPersistedShapes(page: Page, expected: number): Promise<void> {
	// Polled from Node with `page.evaluate`, deliberately not with `page.waitForFunction`:
	// `waitForFunction` evaluates the predicate for truthiness, and an *async* predicate returns a
	// Promise, which is always truthy — so it passed on the first poll while the database was still
	// empty, and the persistence assertion it was supposed to make silently never ran.
	const deadline = Date.now() + 15_000
	let last = -1
	for (;;) {
		last = await countPersistedShapes(page)
		if (last === expected) return
		if (Date.now() > deadline) {
			throw new Error(`Timed out waiting for ${expected} persisted shapes; last saw ${last}`)
		}
		await page.waitForTimeout(100)
	}
}

async function countPersistedShapes(page: Page): Promise<number> {
	return page.evaluate(async () => {
		const boardId = /#\/board\/([^?]+)/.exec(location.hash)?.[1]
		if (!boardId) return -1
		const dbName = `TLDRAW_DOCUMENT_v2lifeboard-${decodeURIComponent(boardId)}`
		const db = await new Promise<IDBDatabase | null>((resolve) => {
			const req = indexedDB.open(dbName)
			req.onsuccess = () => resolve(req.result)
			req.onerror = () => resolve(null)
			req.onblocked = () => resolve(null)
		})
		if (!db) return -1
		try {
			if (!db.objectStoreNames.contains('records')) return -1
			const records = await new Promise<unknown[]>((resolve) => {
				const q = db.transaction('records', 'readonly').objectStore('records').getAll()
				q.onsuccess = () => resolve(q.result as unknown[])
				q.onerror = () => resolve([])
			})
			return records.filter((r) => (r as { typeName?: string })?.typeName === 'shape').length
		} finally {
			db.close()
		}
	})
}

/** Reads how many shapes of a given type the open board currently holds. */
export async function countShapes(page: Page, type: string): Promise<number> {
	return page.evaluate((shapeType) => {
		const editor = (window as unknown as { editor?: EditorLike }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getCurrentPageShapes().filter((s) => s.type === shapeType).length
	}, type)
}

interface EditorLike {
	getCurrentPageShapes(): { type: string; id: string; props: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	select(...ids: string[]): void
}
