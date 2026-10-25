import { expect, test, type Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, openBoard, openBoardFromSidebar, skipFirstRunDemo } from './helpers'

/**
 * Mastery, built in Settings › Skill trees and put on a board (docs/skill-tree-plan.md, "Mastery"):
 * you and the pillars, a tree hung under two of them, and the view that shows it all.
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const CRAFT = `goal: craft
name: Craft
tree:
  id: craft
  nodes:
    - { id: root, name: Craft, kind: root }
    - { id: carve, name: Carving, requires: [ { node: [root] } ] }
`

async function command(page: Page, title: string): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await page.locator('.lb-palette__input').fill(`>${title}`)
	await expect(page.locator('.lb-palette__row--on')).toContainText(title)
	await page.keyboard.press('Enter')
}

const pillarNames = (page: Page) => page.getByLabel('Pillar name').evaluateAll((inputs) => inputs.map((i) => (i as HTMLInputElement).value))

test('builds Mastery in Settings and puts it on a board, a tree under two pillars drawn once', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Life')
	await openBoard(page, 'Life')

	// A tree in the vault to hang: a syllabus with only a tree, imported and confirmed.
	await page.evaluate((text) => navigator.clipboard.writeText(text), CRAFT)
	await command(page, 'Import syllabus YAML from the clipboard')
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(2)
	await command(page, 'Confirm draft')

	await page.goto('/#/settings/extensions/lifeboard.skill-tree')
	await page.getByRole('button', { name: 'Set up Mastery' }).click()
	await expect.poll(() => pillarNames(page)).toEqual(['Physical', 'Mental', 'Spiritual', 'Practical', 'Social'])

	// Pillars: one added, one renamed, one moved.
	await page.getByPlaceholder('New pillar').fill('Making')
	await page.getByRole('button', { name: 'Add pillar' }).click()
	await page.getByLabel('Pillar name').first().fill('Body')
	await page.getByRole('button', { name: 'Move Making up' }).click()
	await expect.poll(() => pillarNames(page)).toEqual(['Body', 'Mental', 'Spiritual', 'Practical', 'Making', 'Social'])

	// Craft under Practical and Making.
	await page.getByLabel('Pillar name').nth(3).click()
	await page.getByLabel('Add a tree').selectOption({ label: 'Craft' })
	await page.getByLabel('Pillar name').nth(4).click()
	await page.getByLabel('Add a tree').selectOption({ label: 'Craft' })
	await expect(page.locator('.lb-mastery__tree', { hasText: 'Craft' })).toContainText('also under Practical')

	await openBoardFromSidebar(page, 'Life')
	await command(page, 'Add Mastery to this board')
	// You, six pillars and Craft's two nodes, each drawn once.
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(9)
	const mountLines = () =>
		page.evaluate(
			() =>
				(window as unknown as { editor: { getCurrentPageShapes(): { type: string; meta: Record<string, unknown> }[] } }).editor
					.getCurrentPageShapes()
					.filter((s) => s.type === 'arrow' && s.meta['lifeboard:skillEdge'] === 'mount:craft').length
		)
	await expect.poll(mountLines).toBe(2)
})
