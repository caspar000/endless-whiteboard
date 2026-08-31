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

	const origin = new URL(page.url()).origin
	const cdp = await page.context().newCDPSession(page)
	// A live tldraw editor owns an IndexedDB connection. `deleteDatabase()` reports `blocked` while
	// that connection is open; treating that event as completion let its delayed persistence and
	// ResizeObserver work run into the freshly loaded app. A real cross-document navigation tears down
	// the React tree, editor, and module-scope atoms first. CDP can then clear the now-uncontended origin
	// atomically (this suite's only configured project is Chromium).
	await page.goto('about:blank')
	await cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
	await cdp.detach()
	await page.goto('/#/')
}

/** Waits for the demo board that first run seeds, then goes back to the board list. */
export async function skipFirstRunDemo(page: Page): Promise<void> {
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()
	await backToList(page)
	// Close the demo board's tab as well. An open tab keeps its editor mounted (that is what makes
	// tab switching instant), and the demo board's mounted-but-hidden nodes would otherwise leak
	// into every "count the shapes on the board" assertion that follows.
	await page.locator('.lb-tabs__close').click()
	await expect(page.locator('.lb-board-host')).toHaveCount(0, { timeout: 20_000 })
}

/** The settings rail's tabs. Each one is a page of its own now, so a test has to say which it wants. */
export type SettingsTab =
	| 'General'
	| 'Appearance'
	| 'Canvas'
	| 'Keyboard'
	| 'Storage'
	| 'Extensions'
	| 'Agents'

/** Opens Settings from the sidebar and lands on a tab — General being the one it opens on. */
export async function openSettings(page: Page, tab: SettingsTab = 'General'): Promise<void> {
	await page.getByRole('button', { name: 'Settings' }).click()
	if (tab !== 'General') await page.getByRole('button', { name: tab, exact: true }).click()
	await expect(page.getByRole('heading', { level: 1, name: tab })).toBeVisible()
}

export async function backToList(page: Page): Promise<void> {
	// The pinned "All boards" tab in the tab strip is the way back to the home screen.
	await page.getByRole('tab', { name: 'All boards' }).click()
	await expect(page.locator('.lb-home__header')).toBeVisible()
}

/**
 * Opens a board by name and waits until *that* board's editor is mounted.
 *
 * Waiting on `.tl-canvas` alone is not enough: `window.editor` still points at the previously
 * mounted (now disposed) editor until the new `onMount` runs, and shapes created on a disposed
 * editor silently never render. The board's tab becoming the active one only happens once the
 * right board is mounted, so that is the signal.
 */
export async function openBoard(page: Page, name: string): Promise<void> {
	await page.locator('.lb-list__board', { hasText: name }).getByText(name).click()
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()
	await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText(name)
	await page.waitForFunction(() => Boolean((window as unknown as { editor?: unknown }).editor))
}

export async function createBoard(page: Page, name?: string): Promise<void> {
	// Some callers get here immediately after clicking "All boards". That navigation first exports a
	// thumbnail, so the click can resolve while the previous board is still visible. Starting another
	// async create during that transition lets the two navigations race and can leave us on the canvas
	// with no corresponding card rendered on the home screen.
	await expect(page.locator('.lb-home__header')).toBeVisible()
	// 'New board' appears in both the sidebar and the section header on the home screen.
	await page.getByRole('button', { name: 'New board' }).first().click()
	await expect(page.locator('.tl-canvas:visible')).toBeVisible()
	await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Untitled board')
	if (name) {
		await backToList(page)
		// Target the *untitled* row, not "the first row". The list sorts by `updatedAt`, and leaving
		// a board bumps its timestamp asynchronously — so "first row" is genuinely racy and would
		// sometimes rename a previously-created board instead, silently making the rest of the test
		// operate on the wrong board.
		const row = page.locator('.lb-list__board', { hasText: 'Untitled board' }).first()
		await expect(row).toBeVisible()
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

/**
 * Opens the dock's node picker — the searchable grid every node tool now lives behind.
 *
 * Idempotent, because the button is a toggle and a second click would put the panel away.
 */
export async function openNodeMenu(page: Page): Promise<void> {
	// Scoped to the visible board: inactive tabs keep their (hidden) editors mounted, each with its
	// own dock, so a page-wide testid lookup can match more than one.
	const host = page.locator('.lb-board-host:not([data-hidden])')
	const button = host.getByTestId('lb.node-menu')
	if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
	await expect(host.locator('.lb-nodemenu__panel')).toBeVisible()
}

/** Selects a node tool from the registry-driven picker and drags out a shape. */
export async function drawNode(
	page: Page,
	label: 'Note' | 'Table',
	at: { x: number; y: number },
	size = { w: 240, h: 260 }
): Promise<void> {
	const toolId = labelToToolId(label)
	await openNodeMenu(page)
	await page.locator('.lb-board-host:not([data-hidden])').getByTestId(`tools.${toolId}`).click()
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

/**
 * Draws a markdown note and puts the caret in it.
 *
 * Most of these tests want "a note I can type into" rather than any particular gesture, and they used
 * to get one by double-clicking empty canvas. That shortcut is gone — the dock is the way in — so the
 * intent lives here instead of being spelled out ten times.
 */
export async function createNote(
	page: Page,
	at = { x: 480, y: 200 },
	size = { w: 320, h: 200 }
): Promise<void> {
	await drawNode(page, 'Note', at, size)
	// The tool may already have opened the editor; double-clicking again would close it.
	const editing = await page.evaluate(
		() => (window as unknown as { editor: EditorLike }).editor.getEditingShapeId() !== null
	)
	if (!editing) await dblclickNode(page, 'node.markdown')
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
export async function waitForStableHeight(page: Page, shapeType: string): Promise<void> {
	let last = -1
	let unchanged = 0
	for (let i = 0; i < 40; i++) {
		const h = await page.evaluate((type) => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === type)
			return shape ? Math.round((shape.props as { h?: number }).h ?? 0) : -1
		}, shapeType)
		if (h === last) {
			unchanged += 1
			// One equal pair can straddle the editor → preview hand-off while the new ResizeObserver
			// has not fired yet. Three quiet intervals cover that render and its deferred rAF write.
			if (unchanged === 3) return
		} else {
			unchanged = 0
		}
		last = h
		await page.waitForTimeout(50)
	}
}

/**
 * The note editor's focusable element.
 *
 * CodeMirror's `contenteditable` div, not a textarea — the editor is CM6 now. Named so the tests read as
 * "the editor" rather than naming an implementation detail twice over.
 */
export const NOTE_EDITOR = '.cm-content'

/**
 * The markdown of the first note on the board, as committed to the shape.
 *
 * Asserting on this rather than on the editor's DOM is deliberate: the live preview *hides* markup, so
 * the DOM shows `•milk` where the source says `- milk`. The committed source is both the truth and the
 * thing every other feature reads.
 */
export async function noteMarkdown(page: Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorLike }).editor
		const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')
		return (note?.props as { md?: string } | undefined)?.md ?? ''
	})
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
	getEditingShapeId(): string | null
	getCurrentPageShapes(): { type: string; id: string; props: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	select(...ids: string[]): void
}
