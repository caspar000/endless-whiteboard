import { expect, test } from '@playwright/test'
import {
	NOTE_EDITOR,
	backToList,
	countShapes,
	createBoard,
	createNote,
	gotoFresh,
	skipFirstRunDemo,
} from './helpers'

const PALETTE = '.lb-palette__panel'
const INPUT = '.lb-palette__input'
const ROWS = '.lb-palette__row'
const CRUMBS = '.lb-palette__crumbs'
const ANSWER = '.lb-palette__row--answer .lb-palette__name'
const FOOTER = '.lb-palette__footer'

/** `ControlOrMeta` so the suite passes on whichever platform runs it. */
async function openPalette(page: import('@playwright/test').Page): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await expect(page.locator(PALETTE)).toBeVisible()
}

test.describe('command palette', () => {
	test('opens from the home screen and closes on Escape', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await openPalette(page)
		await expect(page.locator(INPUT)).toBeFocused()

		await page.keyboard.press('Escape')
		await expect(page.locator(PALETTE)).toBeHidden()
	})

	test('typing a board name and pressing Enter opens that board', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Kitchen plans')
		await backToList(page)

		await openPalette(page)
		await page.locator(INPUT).fill('kitchen')
		// Substring, case-insensitive: one board matches, so it is the highlighted row.
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		await expect(page).toHaveURL(/#\/board\//)
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Kitchen plans')
	})

	test('> switches to commands, and running one changes the app', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Both directions, rather than asserting a starting theme: the default is `system`, so which
		// one the app resolves to depends on the machine running the suite.
		for (const theme of ['dark', 'light'] as const) {
			await openPalette(page)
			await page.locator(INPUT).fill(`> ${theme}`)
			await expect(page.locator(ROWS)).toHaveCount(1)
			await page.keyboard.press('Enter')

			await expect(page.locator(PALETTE)).toBeHidden()
			await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
		}
	})

	test('`when` gates canvas commands on there being a board', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// No board open: Undo has no editor to act on, so it must not be offered.
		await openPalette(page)
		await page.locator(INPUT).fill('> undo')
		await expect(page.locator(ROWS)).toHaveCount(0)
		await page.keyboard.press('Escape')

		await createBoard(page)

		await openPalette(page)
		await page.locator(INPUT).fill('> undo')
		await expect(page.locator(ROWS)).toHaveCount(1)
	})

	test('inserts a node from the registry, at the middle of the view', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		expect(await countShapes(page, 'node.markdown')).toBe(0)

		await openPalette(page)
		// "Add note" is generated from the node registry, not written out anywhere.
		await page.locator(INPUT).fill('> add note')
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(1)
	})

	test('the Help page lists a command because the command exists', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await openPalette(page)
		await page.locator(INPUT).fill('help')
		await page.keyboard.press('Enter')

		// The help page shows one section at a time, and the shortcuts are not the landing one.
		await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()

		// Generated from the registry: "Zoom to fit" has no hand-written row anywhere on the page.
		const row = page.locator('.lb-help__keyrow', { hasText: 'Zoom to fit' })
		await expect(row).toHaveCount(1)
		// Either spelling — the keycap is rendered for whichever platform runs the suite.
		await expect(row.locator('.lb-kbd')).toHaveText(/^(⇧1|Shift\+1)$/)
	})

	test('@ finds a shape on the board by name and goes to it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Two notes, so the match has to be a search rather than "the only shape there is".
		for (const [at, text] of [
			[{ x: 420, y: 170 }, 'Kitchen budget'],
			[{ x: 420, y: 460 }, 'Holiday plans'],
		] as const) {
			await createNote(page, at)
			await expect(page.locator(NOTE_EDITOR)).toBeFocused()
			await page.keyboard.type(text)
			// Escape commits the markdown to the shape, which is what `shapeLabel` will read.
			await page.keyboard.press('Escape')
		}
		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(2)

		// Leaving the second note deselected the *first* one, so search for that: a pass here cannot
		// be the selection that was already there.
		await deselectAll(page)
		expect(await selectedNoteMarkdown(page)).toBe('')

		await openPalette(page)
		await page.locator(INPUT).fill('@ kitchen')
		// The label comes from `shapeLabel` reading the note's own text — nothing was indexed anywhere.
		await expect(page.locator(ROWS)).toHaveCount(1)
		await expect(page.locator(ROWS)).toContainText('Kitchen budget')
		await page.keyboard.press('Enter')

		await expect(page.locator(PALETTE)).toBeHidden()
		await expect.poll(async () => await selectedNoteMarkdown(page)).toContain('Kitchen budget')
	})

	test('@ says why it has nothing to search when no board is open', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		await openPalette(page)
		await page.locator(INPUT).fill('@')
		await expect(page.locator(ROWS)).toHaveCount(0)
		// Not "No matches": nothing was searched, and a prefix that silently does nothing on some
		// screens is worse than one that says why.
		await expect(page.locator('.lb-palette__empty')).toHaveText(
			'Open a board to search what is on it'
		)
	})

	test('a command that needs arguments opens pages instead of running', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openPalette(page)
		// Registered by projecting the `property.create` operation, not hand-written as a command.
		await page.locator(INPUT).fill('> define a property')
		await expect(page.locator(ROWS)).toHaveCount(1)
		// It says where it goes rather than showing a binding it could not have.
		await expect(page.locator(ROWS).first()).toContainText('→')
		await page.keyboard.press('Enter')

		// Still open, now on the first page. The pages follow the operation's declaration order, and
		// the prompt is the parameter's own description — neither is written down in the app.
		await expect(page.locator(PALETTE)).toBeVisible()
		await expect(page.locator(CRUMBS)).toContainText('Define a property')
		await expect(page.locator(INPUT)).toHaveAttribute('placeholder', /What it is called/)
		// A field page is empty until something is typed, and says what it wants rather than "No matches".
		await expect(page.locator(ROWS)).toHaveCount(0)
		await page.locator(INPUT).fill('Budget')
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		// Second page: the answer so far is in the breadcrumb, and the rows are the operation's own
		// `choices` — the palette never learned what a property type is.
		await expect(page.locator(CRUMBS)).toContainText('Budget')
		await expect(page.locator(INPUT)).toHaveAttribute('placeholder', /kind of value/)
		await expect(page.locator(ROWS).filter({ hasText: 'financial' })).toHaveCount(1)
		await page.locator(INPUT).fill('financial')
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		// Closed on success, and the property is really on the board.
		await expect(page.locator(PALETTE)).toBeHidden()
		await expect.poll(async () => await propertyNames(page)).toContain('Budget')
	})

	test('Backspace on an empty field goes back a page, then out of the drill-in', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openPalette(page)
		await page.locator(INPUT).fill('> define a property')
		await page.keyboard.press('Enter')
		await page.locator(INPUT).fill('Budget')
		await page.keyboard.press('Enter')
		await expect(page.locator(CRUMBS)).toContainText('Budget')

		// The field is empty on a fresh page, so Backspace means "back" rather than "delete".
		await page.keyboard.press('Backspace')
		await expect(page.locator(CRUMBS)).not.toContainText('Budget')
		// Once more and the drill-in is gone, but the palette is not: back is one step at a time.
		await page.keyboard.press('Backspace')
		await expect(page.locator(CRUMBS)).toHaveCount(0)
		await expect(page.locator(PALETTE)).toBeVisible()

		await page.keyboard.press('Escape')
		await expect(page.locator(PALETTE)).toBeHidden()
		// Nothing was created: leaving a drill-in half-answered must not run the operation.
		expect(await propertyNames(page)).toEqual([])
	})

	test('= asks the board a question, and can leave the question on it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await createNote(page, { x: 420, y: 170 })
		await page.keyboard.type('One')
		await page.keyboard.press('Escape')
		await createNote(page, { x: 420, y: 460 })
		await page.keyboard.type('Two')
		await page.keyboard.press('Escape')
		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(2)

		await openPalette(page)
		await page.locator(INPUT).fill('= count')
		// Answered against the whole board: `{count}` alone means "what points at me" inside a note,
		// and a question typed into the palette has no "me".
		await expect(page.locator(ANSWER)).toHaveText('2')

		// The second row writes the *question* down rather than the answer.
		await page.keyboard.press('ArrowDown')
		await page.keyboard.press('Enter')
		await expect(page.locator(PALETTE)).toBeHidden()

		await expect.poll(async () => await countShapes(page, 'text')).toBe(1)
		// Stored with its scope spelled out, so the shape keeps meaning what the palette previewed.
		expect(await textShapeProps(page)).toContain('count page')
	})

	test('= offers the expression vocabulary, and taking one keeps you typing', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openPalette(page)
		await page.locator(INPUT).fill('=')
		// The same words the `{…}` menu offers in a note — one vocabulary, two doors to it.
		await expect(page.locator(ROWS).filter({ hasText: 'sum' })).toHaveCount(1)
		await expect(page.locator(ROWS).filter({ hasText: 'count' })).toHaveCount(1)

		await page.locator(INPUT).fill('= su')
		await expect(page.locator(ROWS)).toHaveCount(1)
		await page.keyboard.press('Enter')

		// Completing rewrites the input instead of running something: the palette is still open and the
		// question has moved on a word.
		await expect(page.locator(PALETTE)).toBeVisible()
		await expect(page.locator(INPUT)).toHaveValue('= sum ')
	})

	test('a question can be given a name, and the name works everywhere', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await createNote(page, { x: 420, y: 170 })
		await page.keyboard.type('One')
		await page.keyboard.press('Escape')
		await expect.poll(async () => await countShapes(page, 'node.markdown')).toBe(1)

		await openPalette(page)
		await page.locator(INPUT).fill('= count')
		// The clause is taught in the footer: nobody would guess at it.
		await expect(page.locator(FOOTER)).toContainText('as <name>')

		await page.locator(INPUT).fill('= count as everything')
		const save = page.locator(ROWS).filter({ hasText: 'Save this question' })
		await expect(save).toHaveCount(1)
		await save.click()
		await expect(page.locator(PALETTE)).toBeHidden()

		// The name now *is* the question, and answers the same way.
		await openPalette(page)
		await page.locator(INPUT).fill('= everything')
		await expect(page.locator(ANSWER)).toHaveText('1')
		await page.keyboard.press('Escape')

		// ...and it survives a reload, because a shorthand you invented is one you keep.
		await page.reload()
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		await openPalette(page)
		await page.locator(INPUT).fill('= everything')
		await expect(page.locator(ANSWER)).toHaveText('1')

		// The line that is just its name offers to take it back again.
		const forget = page.locator(ROWS).filter({ hasText: 'Forget' })
		await expect(forget).toHaveCount(1)
		await forget.click()

		await openPalette(page)
		await page.locator(INPUT).fill('= everything')
		// Gone: an unknown name resolves to nothing, exactly as it did before it was taught.
		await expect(page.locator(ANSWER)).toHaveCount(0)
	})

	test('a name the grammar already uses is refused, and says why', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await openPalette(page)
		await page.locator(INPUT).fill('= count as sum')
		// No row to press, because a row that explained itself and then did nothing would be worse.
		await expect(page.locator(ROWS).filter({ hasText: 'Save this question' })).toHaveCount(0)
		await expect(page.locator(FOOTER)).toContainText('already means something')
	})

	test('typing in the palette does not reach the canvas', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		const toolBefore = await currentTool(page)
		expect(toolBefore).toBe('select')

		await openPalette(page)
		/*
		 * `r` and `d` are tldraw tool shortcuts. tldraw reads keys off the *document* and gates them on
		 * `editor.getIsFocused()`, so the only thing standing between these keystrokes and the canvas is
		 * App blurring the editors while the palette is open. This is the regression test for that.
		 */
		await page.locator(INPUT).pressSequentially('draw')
		expect(await currentTool(page)).toBe('select')

		await page.keyboard.press('Escape')
		// ...and the board takes keys again once the palette is gone.
		await page.keyboard.press('d')
		await expect.poll(async () => await currentTool(page)).toBe('draw')
	})
})

/** The first text shape's props as JSON, for asserting on what an expression was written down as. */
async function textShapeProps(page: import('@playwright/test').Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (
			window as unknown as {
				editor?: { getCurrentPageShapes(): { type: string; props: unknown }[] }
			}
		).editor
		if (!editor) throw new Error('window.editor is not exposed')
		const shape = editor.getCurrentPageShapes().find((s) => s.type === 'text')
		return shape ? JSON.stringify(shape.props) : ''
	})
}

/**
 * The names of the properties defined on the open board.
 *
 * Read from the document record the registry actually lives in (`lifeboard:properties` in the
 * document settings' meta), rather than from a panel — the assertion is about what was created, not
 * about which UI happens to show it.
 */
async function propertyNames(page: import('@playwright/test').Page): Promise<string[]> {
	return page.evaluate(() => {
		const editor = (
			window as unknown as {
				editor?: { getDocumentSettings(): { meta: Record<string, unknown> } }
			}
		).editor
		if (!editor) throw new Error('window.editor is not exposed')
		const defs = editor.getDocumentSettings().meta['lifeboard:properties']
		return Array.isArray(defs) ? defs.map((def) => String((def as { name?: unknown }).name)) : []
	})
}

/** The markdown of whichever note is selected, or `''` when nothing is. */
async function selectedNoteMarkdown(page: import('@playwright/test').Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (
			window as unknown as {
				editor?: {
					getSelectedShapeIds(): string[]
					getShape(id: string): { props: { md?: string } } | undefined
				}
			}
		).editor
		if (!editor) throw new Error('window.editor is not exposed')
		const id = editor.getSelectedShapeIds()[0]
		return id ? (editor.getShape(id)?.props.md ?? '') : ''
	})
}

async function deselectAll(page: import('@playwright/test').Page): Promise<void> {
	await page.evaluate(() => {
		const editor = (window as unknown as { editor?: { selectNone(): void } }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		editor.selectNone()
	})
}

async function currentTool(page: import('@playwright/test').Page): Promise<string> {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor?: { getCurrentToolId(): string } }).editor
		if (!editor) throw new Error('window.editor is not exposed')
		return editor.getCurrentToolId()
	})
}
