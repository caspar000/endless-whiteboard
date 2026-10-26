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
		await page.keyboard.press('Home')
		await expect(front(page)).toHaveText('1')
		// 2 already follows 1, so a note behind 1 branches off it.
		await write(page, 'n', 'a branch')
		await page.keyboard.press('Home')
		await write(page, 'N', 'another branch')

		expect((await cards(page)).map((card) => `${card.zid} ${card.text}`)).toEqual([
			'1 one',
			'1a a branch',
			'1b another branch',
			'2 two',
		])

		// The stack reads in box order: 1, 1a, 1b, 2.
		await page.keyboard.press('Home')
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
		expect(types).toEqual(['node.zettel', 'node.zettel'])
	})
})
