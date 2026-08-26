import { expect, test, type Page } from '@playwright/test'
import { countShapes, createBoard, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * The dice tray, and the two things about it that broke during development.
 *
 * Both were the same mistake in different clothes: taking a gesture away from tldraw more broadly
 * than intended. The first was a transparent full-viewport layer used to catch the throw, which also
 * became the hit-target for wheel events and silently disabled pan and zoom while a die was held. The
 * second was suppressing the board's context menu with listeners that were torn down *by* the very
 * action they performed, so the second `contextmenu` event of the gesture got through. Neither is
 * visible in a screenshot and neither would fail a unit test, which is exactly what an e2e suite is
 * for.
 */

const TRAY = '.lb-dice-tray'
const HELD = '.lb-dice-held'
const READOUT = '.lb-dice-readout'

/** A tray button, by the die it loads. Its label gains ", n loaded" once it is holding some. */
const die = (page: Page, kind: string) =>
	page.locator(`${TRAY} .lb-dice-tray__die[aria-label^="${kind}"]`)

const camera = (page: Page) =>
	page.evaluate(() => {
		const c = (window as unknown as { editor: { getCamera(): { x: number; y: number; z: number } } })
			.editor.getCamera()
		return { x: c.x, y: c.y, z: c.z }
	})

/** A board with the tray on it, and the canvas focused — tldraw ignores the wheel when it is not. */
async function boardWithTray(page: Page): Promise<void> {
	// Applied before anything is rolled: the overlay reads it at throw time.
	await page.emulateMedia({ reducedMotion: 'reduce' })
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page)
	await expect(page.locator(TRAY)).toBeVisible()
	// Click the empty canvas so the editor has focus: `useGestureEvents`'s wheel handler returns
	// immediately on `!isFocused`, which would make every camera assertion below vacuous.
	await page.mouse.click(500, 620)
	await page.waitForFunction(() =>
		(window as unknown as { editor: { getInstanceState(): { isFocused: boolean } } })
			.editor.getInstanceState().isFocused
	)
}

/*
 * The suite runs on the **reduced-motion path**, which skips the tumble.
 *
 * Not to dodge the animation but because it is the honest thing to test: the outcome is decided before
 * the roll is drawn (`three/simulate.ts`), so skipping the animation gives an identical result and the
 * assertions stop depending on how long a physics throw happened to take. Asserting on the pixels of a
 * WebGL tumble under software GL would be a flake generator.
 */
test.describe('dice', () => {
	test('loads dice onto the cursor and throws them where you click', async ({ page }) => {
		await boardWithTray(page)

		await die(page, 'd6').click()
		await die(page, 'd6').click()
		await die(page, 'd12').click()

		// The count lives on the button, as its state.
		await expect(die(page, 'd6')).toHaveAttribute('aria-label', 'd6, 2 loaded')
		await expect(die(page, 'd12')).toHaveAttribute('aria-label', 'd12, 1 loaded')
		await expect(page.locator(HELD)).toBeVisible()

		// Loading a die must not move focus off the canvas, or the board stops answering the keyboard.
		await expect(page.locator('.tl-container.tl-container__focused')).toBeVisible()

		await page.mouse.click(560, 420)

		// The dice are thrown in 3D and the card waits for them to land — see `RollSettlement`. On the
		// reduced-motion path that is the same tick, but the wait is what the assertion is really about.
		await expect(page.locator(READOUT)).toBeVisible()
		await expect(page.locator(`${READOUT} .lb-dice-readout__notation`)).toHaveText('2d6 + 1d12')
		await expect(page.locator(`${READOUT} .lb-dice-readout__face`)).toHaveCount(3)
		// The hand is spent by the throw: releasing dice is not copying them.
		await expect(page.locator(HELD)).toBeHidden()
	})

	test('a roll writes nothing to the board and costs no undo entry', async ({ page }) => {
		await boardWithTray(page)
		const before = await page.evaluate(() => ({
			shapes: (window as unknown as { editor: { getCurrentPageShapeIds(): Set<string> } })
				.editor.getCurrentPageShapeIds().size,
			canUndo: (window as unknown as { editor: { getCanUndo(): boolean } }).editor.getCanUndo(),
		}))

		await die(page, 'd20').click()
		await page.mouse.click(520, 400)
		await expect(page.locator(READOUT)).toBeVisible()

		// The whole premise of the ephemeral roll: the board you had before it is the board you have
		// after it. A click that landed on the canvas instead would have created or selected something.
		await expect
			.poll(() =>
				page.evaluate(() => ({
					shapes: (window as unknown as { editor: { getCurrentPageShapeIds(): Set<string> } })
						.editor.getCurrentPageShapeIds().size,
					canUndo: (window as unknown as { editor: { getCanUndo(): boolean } }).editor.getCanUndo(),
				}))
			)
			.toEqual(before)
		expect(
			await page.evaluate(
				() =>
					(window as unknown as { editor: { getSelectedShapeIds(): string[] } })
						.editor.getSelectedShapeIds().length
			)
		).toBe(0)
	})

	test('the wheel still pans and zooms the board while dice are held', async ({ page }) => {
		await boardWithTray(page)
		await page.mouse.move(600, 400)

		// Control first, so a wheel that does nothing in *either* case fails loudly here rather than
		// quietly passing the interesting half of the test.
		const emptyStart = await camera(page)
		await page.mouse.wheel(0, 240)
		await expect.poll(async () => (await camera(page)).y).not.toBe(emptyStart.y)

		await die(page, 'd12').click()
		await expect(page.locator(HELD)).toBeVisible()

		// Back over the board first. Clicking the tray left the pointer on the tray, and the wheel over
		// a floating panel is deliberately not the board's — the tray is not inside `.tl-canvas`, which
		// is where tldraw binds the gesture.
		await page.mouse.move(600, 400)

		// This is the regression. A hit-target over the board swallows these, and pan and zoom die.
		const heldStart = await camera(page)
		await page.mouse.wheel(0, 240)
		await expect.poll(async () => (await camera(page)).y).not.toBe(heldStart.y)

		const beforeZoom = await camera(page)
		await page.keyboard.down('Control')
		await page.mouse.wheel(0, -300)
		await page.keyboard.up('Control')
		await expect.poll(async () => (await camera(page)).z).not.toBe(beforeZoom.z)

		// And none of that dropped the dice — panning to aim is not throwing.
		await expect(page.locator(HELD)).toBeVisible()
	})

	test('right-click puts the dice back without opening the board menu', async ({ page }) => {
		await boardWithTray(page)

		// Control: with an empty hand the board's own context menu must be untouched.
		await page.mouse.click(600, 380, { button: 'right' })
		await expect(page.locator('.tlui-menu')).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.locator('.tlui-menu')).toBeHidden()

		await die(page, 'd20').click()
		await die(page, 'd20').click()
		await expect(page.locator(HELD)).toBeVisible()

		// One right-click puts back one die, from the tray.
		await die(page, 'd20').click({ button: 'right' })
		await expect(die(page, 'd20')).toHaveAttribute('aria-label', 'd20, 1 loaded')

		// Right-clicking the *board* puts them all down, and the menu stays shut.
		await page.mouse.click(600, 380, { button: 'right' })
		await expect(page.locator(HELD)).toBeHidden()
		await expect(page.locator('.tlui-menu')).toBeHidden()
	})

	test('Escape puts the dice back and leaves the undo stack alone', async ({ page }) => {
		await boardWithTray(page)
		const canUndo = await page.evaluate(
			() => (window as unknown as { editor: { getCanUndo(): boolean } }).editor.getCanUndo()
		)

		await die(page, 'd8').click()
		await expect(page.locator(HELD)).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(page.locator(HELD)).toBeHidden()
		await expect(page.locator(TRAY)).toBeVisible()

		// tldraw's own Escape calls `cancel()`, which marks a history stopping point — an empty undo
		// entry that makes the next ⌘Z do nothing. `markEventAsHandled` is what prevents it.
		expect(
			await page.evaluate(
				() => (window as unknown as { editor: { getCanUndo(): boolean } }).editor.getCanUndo()
			)
		).toBe(canUndo)
	})

	test('rolls real dice on the board, and the card agrees with them', async ({ page }) => {
		await boardWithTray(page)
		await die(page, 'd6').click()
		await die(page, 'd6').click()
		await page.mouse.click(520, 400)

		// The 3D stage is a lazily-imported chunk; its canvas appearing is the proof it loaded at all.
		await expect(page.locator('.lb-dice-stage')).toBeAttached()
		await expect(page.locator(READOUT)).toBeVisible()

		// Every face on the card is a face a d6 has. The dice themselves are pixels in a WebGL canvas and
		// deliberately not asserted on; what *is* worth pinning is that the numbers survive the round trip
		// through the simulation and the relabelling.
		const faces = await page.locator(`${READOUT} .lb-dice-icon text`).allTextContents()
		expect(faces).toHaveLength(2)
		for (const face of faces) expect(Number(face)).toBeGreaterThanOrEqual(1)
		for (const face of faces) expect(Number(face)).toBeLessThanOrEqual(6)

		const total = await page.locator('.lb-dice-readout__totalvalue').textContent()
		expect(Number(total)).toBe(faces.reduce((sum, f) => sum + Number(f), 0))
	})

	test('colours a roll from the die\'s lowest face to its highest', async ({ page }) => {
		await boardWithTray(page)
		// Twenty d20 is a wide enough spread that both ends of the ramp show up.
		for (let i = 0; i < 20; i++) await die(page, 'd20').click()
		await page.mouse.click(520, 400)
		await expect(page.locator(READOUT)).toBeVisible()

		const sides = await page.evaluate(() =>
			[...document.querySelectorAll('.lb-dice-readout__face .lb-dice-icon')].map((el) => ({
				value: Number(el.querySelector('text')?.textContent),
				side: el.getAttribute('data-side'),
			}))
		)
		expect(sides).toHaveLength(20)
		// Read off the die, not off the number: the middle of a d20 falls between 10 and 11.
		for (const { value, side } of sides) {
			expect(side, `d20 ${value}`).toBe(value > 10 ? 'max' : 'min')
		}
	})

	test('rolls a notation with a modifier typed straight into the palette', async ({ page }) => {
		await boardWithTray(page)

		await page.keyboard.press('ControlOrMeta+k')
		await expect(page.locator('.lb-palette__input')).toBeFocused()
		await page.locator('.lb-palette__input').fill('>roll 2d20 + 10')

		// One row, and it says what it will throw. A source that offered a row for every half-typed
		// expression would make the palette unusable.
		await expect(page.locator('.lb-palette__row')).toHaveCount(1)
		await expect(page.locator('.lb-palette__row .lb-palette__name')).toHaveText('Roll 2d20 + 10')
		await page.locator('.lb-palette__input').press('Enter')

		await expect(page.locator(READOUT)).toBeVisible()
		await expect(page.locator(`${READOUT} .lb-dice-readout__notation`)).toHaveText('2d20 + 10')
		await expect(page.locator('.lb-dice-readout__modifier')).toHaveText('+10')

		// The modifier is *in* the total, not merely printed beside it.
		const faces = await page.locator(`${READOUT} .lb-dice-icon text`).allTextContents()
		expect(faces).toHaveLength(2)
		const total = Number(await page.locator('.lb-dice-readout__totalvalue').textContent())
		expect(total).toBe(faces.reduce((sum, f) => sum + Number(f), 0) + 10)

		// Thrown, not loaded: someone who typed the whole expression has already decided.
		await expect(page.locator(HELD)).toBeHidden()
	})

	test('answers the bare word, and explains a notation it cannot roll', async ({ page }) => {
		await boardWithTray(page)
		await page.keyboard.press('ControlOrMeta+k')

		/*
		 * The word alone has to answer with something: a blank list is how you fail to discover that this
		 * command takes an argument at all.
		 *
		 * Scoped to *a* row rather than the only one, because `roll` also matches the generated "Add roll"
		 * command that the `node.roll` type brings with it — which is the registry being uniform, not a
		 * mistake.
		 */
		await page.locator('.lb-palette__input').fill('>roll')
		await expect(
			page.locator('.lb-palette__row').filter({ hasText: 'Roll a d20' })
		).toHaveCount(1)
		await expect(page.locator('.lb-palette__note')).toContainText('2d20 + 10')

		// A half-typed or impossible expression says why, and stays inert rather than being a dead Enter.
		await page.locator('.lb-palette__input').fill('>roll 2d7')
		await expect(page.locator('.lb-palette__note')).toContainText('no d7')
		await expect(page.locator('.lb-palette__row[data-dead]')).toHaveCount(1)
		await page.locator('.lb-palette__input').press('Enter')
		// Still open, and nothing thrown — being ejected mid-expression would be the opposite of helpful.
		await expect(page.locator('.lb-palette__panel')).toBeVisible()
		await expect(page.locator(READOUT)).toHaveCount(0)

		// And a word that merely starts the same way is not this command.
		await page.locator('.lb-palette__input').fill('>rollup 2d6')
		await expect(page.locator('.lb-palette__row')).toHaveCount(0)
	})

	test('colours the dice from its own panel on the extension page', async ({ page }) => {
		await boardWithTray(page)
		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Extensions', exact: true }).click()
		await page.getByRole('button', { name: 'Dice', exact: true }).click()

		// The extension's own controls, contributed through `Extension.settings` — the host owns the page,
		// the extension owns the panel.
		await expect(page.getByRole('heading', { level: 2, name: 'Appearance' })).toBeVisible()
		await expect(page.locator('.lb-dice-preview__die')).toHaveCount(7)

		// One colour for the set, then a colour per die — with a picker for each.
		const bodies = () =>
			page.evaluate(() =>
				[...document.querySelectorAll('.lb-dice-preview__die')].map(
					(die) => getComputedStyle(die).backgroundColor
				)
			)
		expect(new Set(await bodies()).size).toBe(1)
		await page.getByLabel('Colourful dice').check()
		expect(new Set(await bodies()).size).toBeGreaterThan(4)
		await expect(page.locator('.lb-dice-setting[data-indented]')).toHaveCount(7)

		/*
		 * The picker is one circle that opens a menu of swatches — the selection toolbar's gesture. The
		 * swatches are not on screen until it is clicked, and the hex editor is a further click behind
		 * Advanced, so neither is in the way of the other six dice.
		 */
		const d20 = page.locator('.lb-dice-setting[data-indented]').filter({ hasText: 'd20' })
		await expect(d20.locator('.lb-dice-picker__menu')).toHaveCount(0)
		await d20.getByRole('button', { name: 'd20 colour' }).click()
		await expect(d20.locator('.lb-dice-picker__menu')).toBeVisible()
		await expect(d20.locator('.lb-dice-picker__hex')).toHaveCount(0)

		await d20.locator('.lb-swatch[aria-label="#099268"]').click()
		// Choosing closes the menu, the way picking a colour on the toolbar does.
		await expect(d20.locator('.lb-dice-picker__menu')).toHaveCount(0)

		await d20.getByRole('button', { name: 'd20 colour' }).click()
		await d20.getByRole('button', { name: 'Advanced' }).click()
		await expect(d20.locator('.lb-dice-picker__hex')).toHaveValue('#099268')

		// And the numerals are never a third choice: each die's ink follows its own body.
		const inks = await page.evaluate(() =>
			[...document.querySelectorAll('.lb-dice-preview__die')].map((die) => getComputedStyle(die).color)
		)
		for (const ink of inks) expect(['rgb(34, 34, 42)', 'rgb(246, 244, 239)']).toContain(ink)

		// Survives a reload, like every other preference — including the per-die override.
		await page.reload()
		await expect(page.getByLabel('Colourful dice')).toBeChecked()
		const d20AfterReload = page
			.locator('.lb-dice-setting[data-indented]')
			.filter({ hasText: 'd20' })
		await d20AfterReload.getByRole('button', { name: 'd20 colour' }).click()
		await expect(d20AfterReload.locator('.lb-swatch[aria-label="#099268"]')).toHaveClass(
			/lb-swatch--active/
		)
	})

	test('keeps a roll as a card, with its total as a property, in one undo step', async ({ page }) => {
		await boardWithTray(page)
		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Extensions', exact: true }).click()
		await page.getByRole('button', { name: 'Dice', exact: true }).click()
		await page.getByLabel('Keep results').check()
		await page.getByRole('tab', { name: 'Untitled board' }).click()
		await expect(page.locator(TRAY)).toBeVisible()

		const shapes = () => countShapes(page, 'node.roll')
		expect(await shapes()).toBe(0)

		await page.keyboard.press('ControlOrMeta+k')
		await page.locator('.lb-palette__input').fill('>roll 2d20 + 5')
		await page.locator('.lb-palette__input').press('Enter')

		await expect(page.locator('.lb-roll-card')).toBeVisible()
		expect(await shapes()).toBe(1)
		// The card replaces the fading readout rather than joining it — the card *is* the result.
		await expect(page.locator(READOUT)).toHaveCount(0)

		const card = await page.evaluate(() => {
			const editor = (
				window as unknown as {
					editor: { getCurrentPageShapes(): { type: string; props: unknown; meta: unknown }[] }
				}
			).editor
			const roll = editor.getCurrentPageShapes().find((s) => s.type === 'node.roll')
			return roll ? JSON.parse(JSON.stringify({ props: roll.props, meta: roll.meta })) : null
		})
		expect(card.props.notation).toBe('2d20 + 5')
		expect(card.props.modifier).toBe(5)
		// The total is the faces plus the modifier, and it is *also* a property — which is the whole
		// reason for the card being a node rather than a picture.
		const values = card.meta['lifeboard:props'] as Record<string, number>
		expect(Object.values(values)).toContain(card.props.total)
		expect(card.meta['lifeboard:propDefs']).toEqual([
			{ id: 'roll_total', name: 'Roll total', type: 'number' },
		])

		// One entry, not two: the shape and its property are written inside a single history stop.
		await page.evaluate(() => (window as unknown as { editor: { undo(): void } }).editor.undo())
		await expect(page.locator('.lb-roll-card')).toHaveCount(0)
		expect(await shapes()).toBe(0)
	})

	test('switching the extension off takes the tray away, and back on returns it', async ({
		page,
	}) => {
		await boardWithTray(page)

		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Extensions', exact: true }).click()
		const toggle = page.getByLabel('Enable Dice')

		/*
		 * Counted rather than checked for visibility, because Settings hides the board host it is
		 * covering — the tray is *present but invisible* here either way. Presence is the right
		 * assertion anyway: the claim is that enablement removes the contribution from the registry,
		 * which is a question about the tree, not about paint.
		 *
		 * An open board keeps its editor mounted behind Settings, which is what makes this a test of
		 * enablement rather than of remounting: the tray goes without the board being rebuilt.
		 */
		await toggle.uncheck()
		await expect(page.locator(TRAY)).toHaveCount(0)

		await toggle.check()
		await expect(page.locator(TRAY)).toHaveCount(1)
	})
})
