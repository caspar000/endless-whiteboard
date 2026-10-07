import { expect, test, type Browser, type Page } from '@playwright/test'

/** Accounts (phase 4): an invite makes a second account, and a view link shares one board with it. */

const OWNER_PASSWORD = 'lifeboard-e2e-password'

interface EditorHandle {
	createShapes(shapes: unknown[]): void
	getShape(id: string): unknown
	getInstanceState(): { isReadonly: boolean }
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

/** Until the test handle is the editor of the board on screen. */
const editorReady = (page: Page) =>
	expect
		.poll(() =>
			page.evaluate(() => {
				const editor = (window as unknown as { editor?: EditorHandle }).editor
				return Boolean(editor?.getContainer().closest('.lb-board-host:not([data-hidden])'))
			})
		)
		.toBe(true)

const editor = <T,>(page: Page, run: (editor: EditorHandle, arg: string) => T, arg = '') =>
	page.evaluate(
		({ source, arg }) => new Function('editor', 'arg', `return (${source})(editor, arg)`)((window as unknown as { editor: EditorHandle }).editor, arg),
		{ source: run.toString(), arg }
	) as Promise<T>

const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText())

test('an invite makes an account with its own vault, and a view link shares one board with it', async ({ browser }) => {
	const owner = await newPage(browser)
	await logIn(owner, 'owner', OWNER_PASSWORD)
	// A first visit opens the demo board; let it, so it doesn't take the screen later.
	await expect(owner.locator('.tl-canvas:visible')).toBeVisible()

	// An invite to a vault of their own, from Settings → Account.
	await owner.goto('/#/settings/account')
	await expect(owner.getByTestId('lb.account')).toBeVisible()
	await owner.getByRole('button', { name: 'Invite someone with a vault of their own' }).click()
	await expect(owner.getByText('Invite link copied.')).toBeVisible()
	const inviteLink = await clipboard(owner)
	expect(inviteLink).toMatch(/\/invite\//)

	// Bob takes it.
	const bob = await newPage(browser)
	await bob.goto(inviteLink)
	await bob.getByLabel('Your name').fill('Bob')
	await bob.getByLabel('Username').fill('bob')
	await bob.getByLabel('Password, 12 characters or more').fill('bob’s long password')
	await bob.getByLabel('Name your vault').fill('Bob’s boards')
	await bob.getByRole('button', { name: 'Create my account' }).click()
	await bob.waitForURL((url) => url.pathname === '/')

	// The owner makes a board, puts a shape on it, and shares it to view.
	await owner.goto('/#/')
	await owner.getByRole('button', { name: 'New board' }).first().click()
	await owner.waitForURL(/#\/board\//)
	await editorReady(owner)
	await editor(owner, (e) => {
		e.createShapes([{ id: 'shape:first', type: 'geo', x: 100, y: 100, props: { w: 120, h: 80 } }])
	})
	await owner.keyboard.press('ControlOrMeta+k')
	await owner.keyboard.type('Share this board')
	await owner.keyboard.press('Enter')
	await expect(owner.getByTestId('lb.share-dialog')).toBeVisible()
	await owner.getByRole('button', { name: 'New view-only link' }).click()
	await expect(owner.getByRole('button', { name: 'Copied' })).toBeVisible()
	const shareLink = await clipboard(owner)
	expect(shareLink).toMatch(/\/share\//)

	// Bob follows it: the board opens, view only.
	await bob.goto(shareLink)
	await bob.waitForURL(/#\/board\//)
	await editorReady(bob)
	await expect.poll(() => editor(bob, (e) => Boolean(e.getShape('shape:first')))).toBe(true)
	expect(await editor(bob, (e) => e.getInstanceState().isReadonly)).toBe(true)
	await expect(bob.getByTestId('lb.sync-status')).toHaveText('View only')

	// View only still lets Bob comment, and the owner reads it.
	await bob.keyboard.press('c')
	const spot = await bob.evaluate(() => (window as unknown as { editor: { pageToScreen(p: { x: number; y: number }): { x: number; y: number } } }).editor.pageToScreen({ x: 150, y: 130 }))
	await bob.mouse.click(spot.x, spot.y)
	await bob.getByLabel('Add a comment').fill('Could this be bigger?')
	await bob.getByLabel('Add a comment').press('Enter')
	await expect(owner.getByTestId('lb.comment-pin')).toHaveCount(1)

	// The owner's next change reaches Bob live.
	await owner.keyboard.press('Escape')
	await editor(owner, (e) => {
		e.createShapes([{ id: 'shape:second', type: 'geo', x: 300, y: 100, props: { w: 120, h: 80 } }])
	})
	await expect.poll(() => editor(bob, (e) => Boolean(e.getShape('shape:second')))).toBe(true)

	// In Bob's list, it says whose it is and how.
	await bob.goto('/#/')
	await expect(bob.locator('.lb-list__board', { hasText: 'Untitled board' }).locator('.lb-list__meta')).toHaveText('My vault · view only')
})

test('an owner makes an account, who chooses a password at first login, and is removed again', async ({ browser }) => {
	const owner = await newPage(browser)
	await logIn(owner, 'owner', OWNER_PASSWORD)
	await owner.goto('/#/settings/account')
	const members = owner.getByTestId('lb.account.members')
	await expect(members).toBeVisible()

	await owner.getByLabel('Name', { exact: true }).last().fill('Carol')
	await owner.getByLabel('Username', { exact: true }).last().fill('carol')
	await owner.getByLabel('Password', { exact: true }).fill('carol’s first password')
	await owner.getByRole('button', { name: 'Create account' }).click()
	await expect(owner.getByText('Made @carol.')).toBeVisible()
	await expect(members.getByRole('row', { name: /Carol/ })).toContainText('@carol')

	// Carol's first login asks for her own password before anything else.
	const carol = await newPage(browser)
	await carol.goto('/login')
	await carol.locator('input[name="username"]').fill('carol')
	await carol.locator('input[name="password"]').fill('carol’s first password')
	await carol.locator('input[name="password"]').press('Enter')
	await carol.waitForURL((url) => url.pathname === '/password')
	await carol.getByLabel('New password, 12 characters or more').fill('carol’s own password')
	await carol.getByLabel('Once more').fill('carol’s own password')
	await carol.getByRole('button', { name: 'Save and continue' }).click()
	await carol.waitForURL((url) => url.pathname === '/')
	// A member sees who's in the vault, and can't change it.
	await carol.goto('/#/settings/account')
	await expect(carol.getByTestId('lb.account.members')).toContainText('Owner')
	await expect(carol.getByRole('button', { name: 'Create account' })).toHaveCount(0)
	await expect(carol.getByRole('button', { name: 'Remove' })).toHaveCount(0)

	// The owner makes her an owner, then removes her.
	await owner.getByLabel('Role of Carol').selectOption('owner')
	await expect.poll(() => owner.getByLabel('Role of Carol').inputValue()).toBe('owner')
	await members.getByRole('row', { name: /Carol/ }).getByRole('button', { name: 'Remove' }).click()
	await owner.getByRole('button', { name: 'Remove Carol' }).click()
	await expect(owner.getByText('Removed Carol.')).toBeVisible()
	await expect(members.getByRole('row', { name: /Carol/ })).toHaveCount(0)

	await carol.reload()
	await carol.waitForURL((url) => url.pathname === '/login')
})
