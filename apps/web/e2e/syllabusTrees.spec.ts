import { expect, test, type Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, openBoard, openBoardFromSidebar, skipFirstRunDemo } from './helpers'

/**
 * Skill trees are made, not imported (docs/skill-tree-plan.md, "Trees are made, not imported"): a
 * syllabus arrives as lists only, even when its file has a tree and hangs it under Mastery; a tree is
 * made from it in Settings or ⌘K, shown on a board when asked, deleted from every board at once, and
 * goes with its syllabus.
 */

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const FILM = `goal: film
name: Film
tracks:
  - { id: craft, name: Film Craft, items: [ { id: shot, title: The shot, tags: [editing] } ] }
tree:
  id: film
  name: Film
  mount: mastery/practical
  nodes:
    - { id: root, name: Film, kind: root }
    - { id: editing, name: Editing, requires: [ { node: [root] } ] }
`

const READING = `goal: reading
name: Reading
tracks:
  - id: list
    name: Reading list
    items:
      - { id: homer, title: Homer, children: [ { id: iliad, title: Iliad }, { id: odyssey, title: Odyssey } ] }
      - { id: plato, title: Plato }
      - { id: dante, title: Dante }
`

const PALETTE = '.lb-palette__panel'
const INPUT = '.lb-palette__input'
const ROWS = '.lb-palette__row'

async function command(page: Page, title: string, ...answers: string[]): Promise<void> {
	await page.keyboard.press('ControlOrMeta+k')
	await page.locator(INPUT).fill(`>${title}`)
	await expect(page.locator('.lb-palette__row--on')).toContainText(title)
	await page.keyboard.press('Enter')
	for (const answer of answers) {
		await page.locator(INPUT).fill(answer)
		await expect(page.locator(ROWS).filter({ hasText: answer }).first()).toBeVisible()
		await page.keyboard.press('Enter')
	}
	await expect(page.locator(PALETTE)).toBeHidden()
}

async function importClipboard(page: Page, yaml: string): Promise<void> {
	await page.evaluate((text) => navigator.clipboard.writeText(text), yaml)
	await command(page, 'Import syllabus YAML from the clipboard')
	await page.getByRole('alertdialog', { name: 'Imported syllabus draft' }).getByRole('button', { name: 'Confirm' }).click()
}

const skillNames = (page: Page) =>
	page.evaluate(() =>
		(window as unknown as { editor: { getCurrentPageShapes(): { type: string; props: { name?: string } }[] } }).editor
			.getCurrentPageShapes()
			.filter((s) => s.type === 'node.skill')
			.map((s) => s.props.name)
			.sort()
	)

const treeHeaders = (page: Page) => countShapes(page, 'node.skillTree')

test('a syllabus arrives as lists, and its tree is made, shown and deleted when asked', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Life')
	await openBoard(page, 'Life')

	// Mastery on the board, so a tree hung under Practical would grow straight into it.
	await command(page, 'Add Mastery to this board')
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(6)

	await importClipboard(page, FILM)
	await expect.poll(() => countShapes(page, 'node.track')).toBe(1)
	// Nothing of Film's tree: not in Mastery, not on its own.
	await expect.poll(() => skillNames(page)).toEqual(['Mental', 'Physical', 'Practical', 'Social', 'Spiritual', 'You'])

	// Made from the syllabus in Settings: in the vault, on no board, under no pillar.
	await page.goto('/#/settings/extensions/lifeboard.skill-tree')
	await expect(page.getByRole('list', { name: 'Skill trees' })).toHaveCount(0)
	await page.getByRole('checkbox', { name: 'Film Craft' }).check()
	await page.getByRole('button', { name: 'Make the tree' }).click()
	// Made from one syllabus, it goes by that syllabus's name.
	await expect(page.getByRole('list', { name: 'Skill trees' })).toContainText(/Film Craft\s*2 nodes\s*from Film Craft/)
	await openBoardFromSidebar(page, 'Life')
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(6)

	// Shown when asked, and deleted from the board (and the vault) with one command.
	await command(page, 'Show a skill tree on this board', 'Film Craft')
	await expect.poll(() => skillNames(page)).toContain('Editing')
	await command(page, 'Delete a skill tree', 'Film Craft')
	await expect.poll(() => skillNames(page)).toEqual(['Mental', 'Physical', 'Practical', 'Social', 'Spiritual', 'You'])
	await expect.poll(() => treeHeaders(page)).toBe(1)
	// Re-calculating has nothing left of Film to stack.
	await command(page, 'Re-calculate the tree layout')
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(6)
})

test('a syllabus without a tree makes a path of its entries, which goes when the syllabus does', async ({ page }) => {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Reading')
	await openBoard(page, 'Reading')
	await importClipboard(page, READING)
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(0)

	await command(page, 'Make a skill tree', 'Reading list')
	await command(page, 'Show a skill tree on this board', 'Reading list')
	await expect.poll(() => skillNames(page)).toEqual(['Dante', 'Homer', 'Plato', 'Reading list'])

	// Deleting the syllabus takes its tree off the board too.
	await page.goto('/#/settings/extensions/lifeboard.syllabus')
	await page.getByRole('button', { name: 'Remove Reading list' }).click()
	await expect(page.locator('.lb-syllabi__question')).toContainText('the skill tree “Reading list” made from it')
	await page.getByRole('button', { name: 'Remove', exact: true }).click()
	await openBoardFromSidebar(page, 'Reading')
	await expect.poll(() => countShapes(page, 'node.skill')).toBe(0)
	await expect.poll(() => treeHeaders(page)).toBe(0)
})
