import { expect, test, type Page } from '@playwright/test'
import { backToList, createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * A Zettelkasten box (docs/zettelkasten-plan.md): the board kind, the stack's own keys, and the
 * numbering. The keys are the part a unit test can't reach. The stack silences the board's keys by
 * counting as an open menu, and if that ever stops working a press of N would make a sticky or switch
 * tools instead of writing a note.
 */

type Card = { zid: string; text: string; x: number; y: number }

const cards = (page: Page): Promise<Card[]> =>
	page.evaluate(() => {
		type Shape = { type: string; x: number; y: number; props: { zid: string; richText: unknown } }
		const editor = (window as unknown as { editor: { getCurrentPageShapes(): Shape[] } }).editor
		const text = (node: unknown): string => {
			const n = node as { text?: string; content?: unknown[] }
			return (n.text ?? '') + (n.content ?? []).map(text).join('')
		}
		return editor
			.getCurrentPageShapes()
			.filter((shape) => shape.type === 'node.zettel')
			.map((shape) => ({ zid: shape.props.zid, text: text(shape.props.richText), x: shape.x, y: shape.y }))
			.sort((a, b) => (a.zid < b.zid ? -1 : 1))
	})

const front = (page: Page) => page.locator('.lb-zstack__front .lb-zcard__id')

/** To note 1: Home goes to the front of the box, which is its index, and note 1 is behind it. */
async function toFirstNote(page: Page): Promise<void> {
	await page.keyboard.press('Home')
	await expect(front(page)).toHaveText('Index')
	await page.keyboard.press('ArrowDown')
	await expect(front(page)).toHaveText('1')
}

async function write(page: Page, key: 'n' | 'N', text: string): Promise<void> {
	await page.keyboard.press(key === 'N' ? 'Shift+N' : 'n')
	await expect(page.locator('.lb-zstack__front .ProseMirror')).toBeFocused()
	await page.keyboard.type(text)
	await page.keyboard.press('Escape')
	await expect(page.locator('.lb-zstack__front .tl-rich-text-editor')).toHaveCount(0)
}

test.describe('zettelkasten', () => {
	test('a box numbers its notes by where they are written, and reads in that order', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()

		await write(page, 'n', 'one')
		await write(page, 'n', 'two')
		await toFirstNote(page)
		// 2 already follows 1, so a note behind 1 branches off it.
		await write(page, 'n', 'a branch')
		await toFirstNote(page)
		await write(page, 'N', 'another branch')

		expect((await cards(page)).map((card) => `${card.zid} ${card.text}`)).toEqual([
			'1 one',
			'1a a branch',
			'1b another branch',
			'2 two',
		])

		// The stack reads in box order: 1, 1a, 1b, 2.
		await toFirstNote(page)
		for (const zid of ['1a', '1b', '2']) {
			await page.keyboard.press('ArrowDown')
			await expect(front(page)).toHaveText(zid)
		}
		await page.keyboard.press('ArrowUp')
		await expect(front(page)).toHaveText('1b')

		// A digit starts "Go to".
		await page.keyboard.press('1')
		await page.keyboard.type('a')
		await page.keyboard.press('Enter')
		await expect(front(page)).toHaveText('1a')
	})

	test('a box keeps its own rules: no other shapes, no drawing tools, a deleted number stays retired', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()
		await write(page, 'n', 'one')
		await write(page, 'n', 'two')

		// Delete 2: it asks, then its number is never given out again.
		await page.keyboard.press('Backspace')
		await page.locator('.lb-zstack__confirm .lb-btn--danger').click()
		expect((await cards(page)).map((card) => card.zid)).toEqual(['1'])
		await write(page, 'n', 'three')
		expect((await cards(page)).map((card) => card.zid)).toEqual(['1', '1a'])

		// On the table the box lays the cards out, and keeps them there.
		await page.getByRole('button', { name: 'Table' }).click()
		const before = await cards(page)
		expect(before[1]!.y).toBeGreaterThan(before[0]!.y)

		// A drawing tool's key puts the board back on Select; a shape that isn't a card is taken off.
		await page.keyboard.press('r')
		await expect
			.poll(() => page.evaluate(() => (window as unknown as { editor: { getCurrentToolId(): string } }).editor.getCurrentToolId()))
			.toBe('select')
		await page.evaluate(() => {
			;(window as unknown as { editor: { createShape(shape: object): void } }).editor.createShape({ type: 'note', x: 0, y: 0 })
		})
		const types = await page.evaluate(() =>
			(window as unknown as { editor: { getCurrentPageShapes(): { type: string }[] } }).editor
				.getCurrentPageShapes()
				.map((shape) => shape.type)
		)
		expect(types.sort()).toEqual(['node.zettel', 'node.zettel', 'node.zettelIndex'])
	})

	test('a note longer than its card is written smaller rather than scrolled, and the pile shows more than three cards', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()

		const body = page.locator('.lb-zstack__front .lb-zcard__body')
		const fit = () =>
			body.evaluate((el) => ({
				scale: Number(getComputedStyle(el).getPropertyValue('--zfit') || 1),
				overflow: el.scrollHeight - el.clientHeight,
			}))

		await write(page, 'n', 'A short note.')
		expect((await fit()).scale).toBe(1)

		const sentence = 'Minim pariatur fugiat quis aute sint tempor officia veniam anim ea. '
		await page.keyboard.press('Enter')
		await expect(page.locator('.lb-zstack__front .ProseMirror')).toBeFocused()
		await page.keyboard.type(sentence.repeat(10))
		const typed = await fit()
		expect(typed.scale).toBeLessThan(1)
		expect(typed.overflow).toBeLessThanOrEqual(1)
		await page.keyboard.press('Escape')

		for (let i = 0; i < 6; i++) await write(page, 'n', `note ${i}`)
		await page.keyboard.press('Home')
		// The index in front, and all seven notes behind it, in sight.
		const shown = await page
			.locator('.lb-zstack__card[data-behind]')
			.evaluateAll((els) => els.filter((el) => getComputedStyle(el).opacity === '1').length)
		expect(shown).toBe(7)
	})

	test('notes link with [[, file under keywords in the index, and cite sources at the back', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()

		await write(page, 'n', 'Society, first.')
		// `[[` offers the box's notes; Enter writes the link.
		await page.keyboard.press('n')
		await expect(page.locator('.lb-zstack__front .ProseMirror')).toBeFocused()
		await page.keyboard.type('See [[')
		await expect(page.locator('.lb-suggest:visible')).toContainText('Society, first.')
		await page.keyboard.press('Enter')
		await page.keyboard.type(' for that.')
		await page.keyboard.press('Escape')
		expect((await cards(page)).find((card) => card.zid === '2')?.text).toBe('See [[1]] for that.')

		// Drawn as a chip, which goes to the note; that note says who links to it.
		const front = page.locator('.lb-zstack__front')
		await front.locator('.lb-zcard__text .lb-zlink', { hasText: '1' }).click()
		await expect(front.locator('.lb-zcard__id')).toHaveText('1')
		await expect(front.locator('.lb-zcard__from')).toHaveText('Linked from 2')

		// The + files the note under a keyword, and the index lists it.
		await front.locator('.lb-zchip--add').click()
		await page.keyboard.type('Society')
		await page.keyboard.press('Enter')
		await expect(front.locator('.lb-zchip[data-kind=keyword]')).toHaveText('Society')
		await front.locator('.lb-zchip[data-kind=keyword] .lb-zchip__go').click()
		await expect(front.locator('.lb-zcard__id')).toHaveText('Index')
		await expect(front.locator('.lb-zindex__row[data-picked]')).toContainText('Society')

		// A new source from the +, numbered c1 and at the back of the box, filled in on its card.
		await page.keyboard.press('ArrowDown')
		await expect(front.locator('.lb-zcard__id')).toHaveText('1')
		await front.locator('.lb-zchip--add').click()
		await page.keyboard.type('Social Systems')
		await page.locator('.lb-zpick__row', { hasText: 'New source' }).dispatchEvent('pointerdown')
		await front.locator('.lb-zchip[data-kind=cite] .lb-zchip__go').click()
		await expect(front.locator('.lb-zcard__id')).toHaveText('c1')
		await page.keyboard.press('Enter')
		await expect(page.getByLabel('Author')).toBeFocused()
		await page.keyboard.type('Niklas Luhmann')
		await page.keyboard.press('Escape')
		await expect(front.locator('.lb-zsource__author')).toHaveText('Niklas Luhmann')
		await expect(front.locator('.lb-zcard__from')).toHaveText('Cited by 1')
		await page.keyboard.press('End')
		await expect(front.locator('.lb-zcard__id')).toHaveText('c1')
		await page.keyboard.press('Home')
		await expect(front.locator('.lb-zcard__id')).toHaveText('Index')
	})

	test('the chain reads a train of thought and turns along its links', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()

		// A train 1, 1a, 1b, where 1a links to a second train, 2.
		await write(page, 'n', 'one')
		await write(page, 'n', 'two')
		await toFirstNote(page)
		await write(page, 'n', 'a branch, see [[2]]')
		await write(page, 'n', 'another branch')
		expect((await cards(page)).map((card) => card.zid)).toEqual(['1', '1a', '1b', '2'])

		// F follows from the front card: its train, in order, and nothing of the next train.
		await toFirstNote(page)
		await page.keyboard.press('f')
		const rows = page.locator('.lb-zchain__row[data-row] .lb-zchain__card .lb-zcard__id')
		await expect(rows).toHaveText(['1', '1a', '1b'])
		// Beside 1a, the note it links to; taking it cuts the path there and carries on from 2.
		const row1a = page.locator('.lb-zchain__row[data-row="1"]')
		await row1a.locator('.lb-zchain__peek').click()
		await expect(rows).toHaveText(['1', '1a', '2'])
		await expect(page.locator('.lb-zchain__turn')).toHaveText(['1', '2'])

		// Writing on a card in the chain.
		await page.locator('.lb-zchain__row[data-row="2"] .lb-zchain__card .lb-zcard__body').click()
		await expect(page.locator('.lb-zchain .ProseMirror')).toBeFocused()
		await page.keyboard.press('End')
		await page.keyboard.type(' and more')
		await page.keyboard.press('Escape')
		expect((await cards(page)).find((card) => card.zid === '2')?.text).toBe('two and more')

		// Backspace steps back a turn; Escape leaves for the stack it was opened over.
		await page.keyboard.press('Backspace')
		await expect(rows).toHaveText(['1', '1a', '1b'])
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-zchain')).toHaveCount(0)
		await expect(front(page)).toHaveText('1')
	})

	test('the graph draws the box, opens a note from it, and leaves for the stack', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()
		await write(page, 'n', 'one')
		await write(page, 'n', 'two, see [[1]]')

		await page.keyboard.press('g')
		const graph = page.locator('.lb-zgraph')
		await expect(graph.locator('canvas')).toBeVisible()
		// Drawn, not left blank: the canvas takes the screen's size once the layout has run.
		await expect.poll(() => graph.locator('canvas').evaluate((el: HTMLCanvasElement) => el.width)).toBeGreaterThan(300)
		const list = graph.getByRole('list', { name: 'Notes in the graph' })
		await expect(list.getByRole('button')).toHaveText(['1 one', '2 two, see [[1]]'])

		// Keywords are a layer of their own, off until asked for.
		const keywords = graph.getByRole('button', { name: 'Keywords', exact: true })
		await expect(keywords).toHaveAttribute('aria-pressed', 'false')
		await keywords.click()
		await expect(keywords).toHaveAttribute('aria-pressed', 'true')
		await keywords.click()

		// A dot opens its note in the stack, and the graph goes.
		// (The list is the graph for the keyboard and screen readers.)
		await list.getByRole('button', { name: '2 two' }).focus()
		await page.keyboard.press('Enter')
		await expect(graph).toHaveCount(0)
		await expect(front(page)).toHaveText('2')

		// Escape leaves it too.
		await page.keyboard.press('g')
		await expect(page.locator('.lb-zgraph')).toHaveCount(1)
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-zgraph')).toHaveCount(0)
	})

	test('a book on another board is cited in a box, once however often it is cited', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'New box' }).click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()
		await backToList(page)
		await createBoard(page, 'Reading')
		await openBoard(page, 'Reading')

		const cite = async () => {
			await page.evaluate(() => {
				const editor = (window as unknown as { editor: { getCurrentPageShapes(): { id: string; type: string }[]; createShape(s: object): void; select(id: string): void } }).editor
				let book = editor.getCurrentPageShapes().find((shape) => shape.type === 'node.book')
				if (!book) {
					editor.createShape({ type: 'node.book', x: 0, y: 0, props: { title: 'Social Systems', author: 'Niklas Luhmann' } })
					book = editor.getCurrentPageShapes().find((shape) => shape.type === 'node.book')!
				}
				editor.select(book.id)
			})
			await page.keyboard.press('ControlOrMeta+k')
			await page.locator('.lb-palette__input').fill('>Cite in a box')
			await page.locator('.lb-palette__input').press('Enter')
			const dialog = page.getByRole('dialog', { name: 'Cite in a box' })
			await expect(dialog).toContainText('Social Systems by Niklas Luhmann')
			await dialog.getByRole('button', { name: 'Untitled box' }).click()
			await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Untitled box')
			await expect(front(page)).toHaveText('c1')
		}

		await cite()
		await expect(page.locator('.lb-zstack__front .lb-zsource__author')).toHaveText('Niklas Luhmann')
		await expect(page.locator('.lb-zdock__notice')).toContainText('at the back of the box')

		// Again, from the same board: the box already has it.
		await backToList(page)
		await openBoard(page, 'Reading')
		await cite()
		await expect(page.locator('.lb-zdock__notice')).toContainText('already in this box, as c1')
		const sources = await page.evaluate(() =>
			(window as unknown as { editor: { getCurrentPageShapes(): { type: string }[] } }).editor
				.getCurrentPageShapes()
				.filter((shape) => shape.type === 'node.zettelSource').length
		)
		expect(sources).toBe(1)
	})

	test('a note put on another board stays in its box: followed there, and written through to it', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Desk')
		await page.getByRole('button', { name: 'New box' }).first().click()
		await expect(page.locator('.lb-zstack__empty')).toBeVisible()
		await write(page, 'n', 'one')
		await write(page, 'n', 'two')

		type Ref = { id: string; zid: string; text: string }
		const refs = (): Promise<Ref[]> =>
			page.evaluate(() => {
				type S = { id: string; type: string; props: { zid: string; richText: { content: { content?: { text: string }[] }[] } } }
				const editor = (window as unknown as { editor: { getCurrentPageShapes(): S[] } }).editor
				return editor
					.getCurrentPageShapes()
					.filter((shape) => shape.type === 'node.zettelRef')
					.map((shape) => ({
						id: shape.id,
						zid: shape.props.zid,
						text: shape.props.richText.content.map((block) => (block.content ?? []).map((t) => t.text).join('')).join('\n'),
					}))
			})

		// P on the card in front: pick the board, and the note is shown there.
		await page.keyboard.press('p')
		await page.getByRole('dialog', { name: 'Put on a board' }).getByRole('button', { name: 'Desk' }).click()
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText('Desk')
		await expect.poll(refs).toMatchObject([{ zid: '2', text: 'two' }])
		const card = page.locator('.lb-zcard--ref')
		await expect(card.locator('.lb-zcard__from')).toContainText('In Untitled box')

		// Written on here, written in the box.
		// By position: on the canvas the pointer goes to the canvas, which hands it to the shape.
		const box = (await card.boundingBox())!
		await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)
		await expect(page.locator('.lb-zcard--ref .ProseMirror')).toBeFocused()
		await page.keyboard.press('ControlOrMeta+End')
		await page.keyboard.type(' and more')
		await page.keyboard.press('Escape')
		await page.locator('.lb-tabs__tab', { hasText: 'Untitled box' }).click()
		await expect.poll(() => cards(page).then((all) => all.find((c) => c.zid === '2')?.text)).toBe('two and more')

		// Written in the box, followed here.
		await page.keyboard.press('Enter')
		await expect(page.locator('.lb-zstack__front .ProseMirror')).toBeFocused()
		await page.keyboard.press('ControlOrMeta+End')
		await page.keyboard.type(', from the box')
		await page.keyboard.press('Escape')
		await page.locator('.lb-tabs__tab', { hasText: 'Desk' }).click()
		await expect.poll(refs).toMatchObject([{ zid: '2', text: 'two and more, from the box' }])
	})
})
