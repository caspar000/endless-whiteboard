import { expect, test, type Page } from '@playwright/test'
import { gotoFresh, skipFirstRunDemo } from './helpers'

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
})
