import { expect, test, type Browser, type Page } from '@playwright/test'

/** Phase 5 on a real server: others' cursors (S4), who made a shape (S6), and comments (S7). */

interface EditorHandle {
	createShapes(shapes: unknown[]): void
	select(...ids: string[]): void
	pageToScreen(point: { x: number; y: number }): { x: number; y: number }
	setCamera(camera: { x: number; y: number; z: number }): void
	getContainer(): HTMLElement
}

async function newPage(browser: Browser): Promise<Page> {
	const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
	return context.newPage()
}

async function logIn(page: Page, username: string, password: string) {
	await page.goto('/login')
	await page.locator('input[name="username"]').fill(username)
	await page.locator('input[name="password"]').fill(password)
	await page.locator('input[name="password"]').press('Enter')
	await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

const editorReady = (page: Page) =>
	expect
		.poll(() =>
			page.evaluate(() => {
				const editor = (window as unknown as { editor?: EditorHandle }).editor
				return Boolean(editor?.getContainer().closest('.lb-board-host:not([data-hidden])'))
			})
		)
		.toBe(true)

const onEditor = (page: Page, source: string, arg: unknown = null) =>
	page.evaluate(
		({ source, arg }) => new Function('editor', 'arg', source)((window as unknown as { editor: EditorHandle }).editor, arg),
		{ source, arg }
	)

test('two people on one board see each other, who made what, and talk about it', async ({ browser }) => {
	// The owner, and Ann, invited into the owner's vault.
	const owner = await newPage(browser)
	await logIn(owner, 'owner', 'lifeboard-e2e-password')
	await expect(owner.locator('.tl-canvas:visible')).toBeVisible()
	await owner.goto('/#/settings/account')
	await owner.getByRole('button', { name: /^Invite someone to / }).click()
	await expect(owner.getByText('Invite link copied.')).toBeVisible()
	const invite = await owner.evaluate(() => navigator.clipboard.readText())

	const ann = await newPage(browser)
	await ann.goto(invite)
	await ann.getByLabel('Your name').fill('Ann')
	await ann.getByLabel('Username').fill('ann')
	await ann.getByLabel('Password, 12 characters or more').fill('ann’s long password')
	await ann.getByRole('button', { name: 'Create my account' }).click()
	await ann.waitForURL((url) => url.pathname === '/')

	// A board, with a box the owner makes.
	await owner.goto('/#/')
	await owner.getByRole('button', { name: 'New board' }).first().click()
	await owner.waitForURL(/#\/board\//)
	const boardUrl = owner.url()
	await editorReady(owner)
	await onEditor(owner, `editor.setCamera({ x: 0, y: 0, z: 1 }); editor.createShapes([{ id: 'shape:box', type: 'geo', x: 200, y: 150, props: { w: 200, h: 120 } }])`)

	await ann.goto(boardUrl)
	await editorReady(ann)
	await onEditor(ann, `editor.setCamera({ x: 0, y: 0, z: 1 })`)

	// S4: the owner's pointer shows on Ann's screen, named.
	const canvas = owner.locator('.tl-canvas:visible')
	const box = (await canvas.boundingBox())!
	await owner.mouse.move(box.x + 300, box.y + 300)
	await owner.mouse.move(box.x + 320, box.y + 310, { steps: 4 })
	await expect(ann.locator('.tl-nametag', { hasText: 'Owner' })).toBeVisible()
	// And the other way round.
	const annCanvas = (await ann.locator('.tl-canvas:visible').boundingBox())!
	await ann.mouse.move(annCanvas.x + 500, annCanvas.y + 350)
	await ann.mouse.move(annCanvas.x + 520, annCanvas.y + 360, { steps: 4 })
	await expect(owner.locator('.tl-nametag', { hasText: 'Ann' })).toBeVisible()

	// S6: Ann sees who made the box.
	await onEditor(ann, `editor.select('shape:box')`)
	await ann.getByRole('button', { name: 'More options' }).click()
	await expect(ann.getByTestId('lb.authorship')).toHaveText(/^Added by Owner, edited/)
	await ann.keyboard.press('Escape')

	// S7: Ann comments on the box; the owner reads it, answers, and resolves it.
	await ann.keyboard.press('c')
	const spot = await onEditor(ann, `return editor.pageToScreen({ x: 260, y: 200 })`) as { x: number; y: number }
	await ann.mouse.click(spot.x, spot.y)
	await ann.getByLabel('Add a comment').fill('Is this the right size?')
	await ann.getByLabel('Add a comment').press('Enter')
	await expect(ann.getByTestId('lb.comment')).toHaveText(/Is this the right size\?/)

	await expect(owner.getByTestId('lb.comment-pin')).toHaveCount(1)
	await owner.getByTestId('lb.comment-pin').click()
	await expect(owner.getByTestId('lb.comment').first()).toContainText('Ann')
	await owner.getByLabel('Reply').fill('Yes, it is.')
	await owner.getByLabel('Reply').press('Enter')
	await expect(ann.getByTestId('lb.comment')).toHaveCount(2)

	// The pin follows the box when it moves.
	const pinBefore = (await ann.getByTestId('lb.comment-pin').boundingBox())!
	await onEditor(owner, `editor.updateShapes([{ id: 'shape:box', type: 'geo', x: 400 }])`)
	await expect.poll(async () => Math.round((await ann.getByTestId('lb.comment-pin').boundingBox())!.x - pinBefore.x)).toBe(200)

	await owner.getByRole('button', { name: 'Resolve' }).click()
	await owner.keyboard.press('Escape')
	await expect(owner.getByTestId('lb.comment-pin')).toHaveCount(0)
	// Ann still has it open: it says so, and its pin goes when she closes it.
	await expect(ann.getByText('Resolved by Owner')).toBeVisible()
	await ann.keyboard.press('Escape')
	await expect(ann.getByTestId('lb.comment-pin')).toHaveCount(0)

	// The list keeps it, under Resolved.
	await ann.getByTestId('lb.comments-layer').waitFor({ state: 'attached' })
	await ann.keyboard.press('Shift+C')
	await ann.getByRole('tab', { name: 'Resolved' }).click()
	await expect(ann.getByTestId('lb.comments-panel')).toContainText('Is this the right size?')
})
