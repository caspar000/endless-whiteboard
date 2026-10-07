import { expect, test, type Page } from '@playwright/test'

/** A server board opens and takes edits offline, across reloads, and sends them when back (S5). */

interface EditorHandle {
	createShapes(shapes: unknown[]): void
	getShape(id: string): { x: number } | undefined
}

async function logIn(page: Page) {
	await page.goto('/login')
	await page.locator('input[name="username"]').fill('owner')
	await page.locator('input[name="password"]').fill('lifeboard-e2e-password')
	await page.locator('input[name="password"]').press('Enter')
	await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

/** Until the test handle is the editor of the board on screen (another may have mounted first). */
const editorReady = (page: Page) =>
	expect
		.poll(() =>
			page.evaluate(() => {
				const editor = (window as unknown as { editor?: { getContainer(): HTMLElement } }).editor
				return Boolean(editor?.getContainer().closest('.lb-board-host:not([data-hidden])'))
			})
		)
		.toBe(true)

const addBox = (page: Page, id: string, x: number) =>
	page.evaluate(
		([id, x]) => {
			;(window as unknown as { editor: EditorHandle }).editor.createShapes([
				{ id, type: 'geo', x, y: 100, props: { w: 120, h: 80 } },
			])
		},
		[id, x] as const
	)

const onBoard = (page: Page, id: string) =>
	page.evaluate((id) => Boolean((window as unknown as { editor: EditorHandle }).editor.getShape(id)), id)

/** The board as the server has it. */
async function onServer(page: Page, boardId: string, shapeId: string): Promise<boolean> {
	const response = await page.request.get(`/api/boards/${boardId}/snapshot`)
	const snapshot = (await response.json()) as { store: Record<string, unknown> }
	return shapeId in snapshot.store
}

test('a server board opens offline, keeps edits across a reload, and sends them when back', async ({ page, context }) => {
	await logIn(page)
	// The service worker has the app before anything goes offline.
	await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))

	// A server board, with a shape the server has.
	await page.goto('/#/')
	await page.getByRole('button', { name: 'New board' }).first().click()
	await page.waitForURL(/#\/board\//)
	await editorReady(page)
	const boardId = decodeURIComponent(/#\/board\/([^?]+)/.exec(page.url())![1]!)
	await addBox(page, 'shape:online', 100)
	await expect.poll(() => onServer(page, boardId, 'shape:online')).toBe(true)

	// Offline, and reloaded: the board opens from this device.
	await context.setOffline(true)
	await page.reload()
	await editorReady(page)
	expect(await onBoard(page, 'shape:online')).toBe(true)
	const pill = page.getByTestId('lb.sync-status')
	await expect(pill).toHaveText('Offline · opened from this device')

	// An edit made offline is kept on the device, and through another reload.
	await addBox(page, 'shape:offline', 300)
	await expect(pill).toHaveText('Offline · 1 change kept on this device')
	await page.reload()
	await editorReady(page)
	expect(await onBoard(page, 'shape:offline')).toBe(true)
	await expect(pill).toHaveText('Offline · 1 change kept on this device')

	// The board list says why, and still lists the board.
	await page.goto('/#/')
	await expect(page.getByTestId('lb.server-offline')).toBeVisible()
	await page.goto(`/#/board/${encodeURIComponent(boardId)}`)
	await editorReady(page)

	// Back online: the edit goes up.
	await context.setOffline(false)
	await expect(pill).toHaveText('Synced')
	await expect(pill).toBeHidden()
	await expect.poll(() => onServer(page, boardId, 'shape:offline')).toBe(true)
})
