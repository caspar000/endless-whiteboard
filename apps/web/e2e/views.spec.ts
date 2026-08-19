import { expect, test, type Page } from '@playwright/test'
import { createBoard, dblclickNode, drawNode, gotoFresh, skipFirstRunDemo } from './helpers'

/**
 * The kanban view, from the board's end.
 *
 * The unit tests own the rules — which lane a card belongs in, what gets adopted, what gets let go of.
 * What they cannot cover is the claim the whole view rests on: that a **reaction over a live editor**
 * actually moves real shapes, and then goes quiet. Three things could only ever be checked here:
 *
 * 1. **It converges.** The pass writes positions, and writing re-triggers it. A missing no-op guard
 *    would look fine in a screenshot and pin the CPU at 100% forever.
 * 2. **It does not adopt the whole board.** `queryTable` keeps every match when a table has no property
 *    columns, so a kanban that failed to add its lane property as one would physically file every note
 *    on the page into a lane (the plan's gotcha 1). A unit test proves `columnsFor` returns the right
 *    list; only this proves the engine actually applies it.
 * 3. **Adoption is reversible.** Clear a status and the card goes back where it came from, from stored
 *    coordinates that were written before it was ever moved.
 */

interface EditorHandle {
	getCurrentPageShapes(): {
		id: string
		type: string
		parentId: string
		x: number
		y: number
		meta: Record<string, unknown>
		props: Record<string, unknown>
	}[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	getDocumentSettings(): { meta: Record<string, unknown> }
	updateDocumentSettings(settings: { meta: Record<string, unknown> }): void
	createShapes(shapes: unknown[]): void
	updateShape(partial: unknown): void
}

/** Where a note is, and what view (if any) has charge of it. */
async function cards(page: Page) {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		return editor
			.getCurrentPageShapes()
			.filter((shape) => shape.type === 'node.markdown')
			.map((shape) => ({
				id: shape.id,
				title: String((shape.props as { md?: string }).md ?? ''),
				x: Math.round(shape.x),
				y: Math.round(shape.y),
				/*
				 * Absent and empty are kept apart, and the distinction is load-bearing: a card carrying
				 * `status: null` is still a *member* (membership is "carries the lane property"), so it belongs
				 * in the empty lane — whereas one with no status at all has left the view. Defaulting the
				 * missing case to `null` would have made those two indistinguishable in every assertion below.
				 */
				status: (shape.meta['lifeboard:props'] as Record<string, unknown> | undefined)?.['status'],
				due: (shape.meta['lifeboard:props'] as Record<string, unknown> | undefined)?.['due'],
				home: shape.meta['lifeboard:viewHome'] as
					| { viewId: string; x: number; y: number; adopted: string }
					| false
					| undefined,
			}))
			.sort((a, b) => a.title.localeCompare(b.title))
	})
}

async function card(page: Page, title: string) {
	const found = (await cards(page)).find((c) => c.title.includes(title))
	if (!found) throw new Error(`No card titled ${title}`)
	return found
}

/** Sets one card's Status, the way the properties panel does — a meta write and nothing else. */
async function setStatus(page: Page, title: string, status: string | null): Promise<void> {
	await page.evaluate(
		({ title, status }) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor
				.getCurrentPageShapes()
				.find((s) => s.type === 'node.markdown' && String((s.props as { md?: string }).md ?? '').includes(title))
			if (!shape) throw new Error(`No card titled ${title}`)
			editor.updateShape({
				id: shape.id,
				type: shape.type,
				meta: { 'lifeboard:props': status === null ? {} : { status } },
			})
		},
		{ title, status }
	)
}

test.describe('collection views', () => {
	test('files cards into lanes, and lets them go again', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		/*
		 * A Status property with stages, two cards carrying it, and one carrying nothing.
		 *
		 * The third card is the point of the test as much as the other two: it must still be sitting at
		 * (900, 700) at the end. Set up through the store because the property system has its own tests
		 * and this one is about the view.
		 */
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{
							id: 'status',
							name: 'Status',
							type: 'status',
							options: ['To-do', 'Doing', 'Done'],
							stages: { 'To-do': 'todo', Doing: 'active', Done: 'done' },
						},
					],
				},
			})
			const mk = (title: string, y: number, props?: Record<string, string>) => ({
				type: 'node.markdown',
				x: 900,
				y,
				props: { w: 200, h: 80, md: `# ${title}`, autoHeight: false },
				meta: props ? { 'lifeboard:props': props } : {},
			})
			editor.createShapes([
				mk('Alpha', 300, { status: 'To-do' }),
				mk('Beta', 500, { status: 'Done' }),
				mk('Gamma', 700),
			])
		})

		// Well clear of the sidebar on the left, the dock at the bottom, and the three cards out at page
		// x=900 — a drag that starts on the chrome creates nothing at all.
		await drawNode(page, 'Table', { x: 400, y: 150 }, { w: 300, h: 200 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')
		// Group first, then switch: a kanban with nothing to make lanes from says so instead of drawing.
		await config.getByLabel('Group by').selectOption('status')
		await config.getByLabel('Show as').selectOption('kanban')
		await page.keyboard.press('Escape')

		const board = page.locator('.lb-board-host:not([data-hidden])')
		// One lane per option, in stage order. No `—` lane: the card with no status is not a member at all.
		await expect(board.locator('.lb-kanban__lane')).toHaveCount(3)
		await expect(board.locator('.lb-kanban__key')).toHaveText(['To-do', 'Doing', 'Done'])

		// Both members left where they were standing and joined the board; the third card did not move.
		await expect.poll(async () => (await card(page, 'Alpha')).x).not.toBe(900)
		const alpha = await card(page, 'Alpha')
		const beta = await card(page, 'Beta')
		const gamma = await card(page, 'Gamma')

		expect(gamma).toMatchObject({ x: 900, y: 700 })
		expect(gamma.home).toBeFalsy()

		// Same row, since each is the first card in its lane — and To-do is left of Done.
		expect(alpha.y).toBe(beta.y)
		expect(alpha.x).toBeLessThan(beta.x)
		expect(alpha.home).toMatchObject({ x: 900, y: 300, adopted: 'query' })
		expect(beta.home).toMatchObject({ x: 900, y: 500, adopted: 'query' })

		// Every card is inside the view it was filed into.
		const view = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.table')!
			return editor.getShapePageBounds(shape.id)!
		})
		for (const member of [alpha, beta]) {
			expect(member.x).toBeGreaterThanOrEqual(view.x)
			expect(member.x).toBeLessThan(view.x + view.w)
			expect(member.y).toBeGreaterThanOrEqual(view.y)
			expect(member.y).toBeLessThan(view.y + view.h)
		}

		/*
		 * The move that is the whole feature: a status set *away from* the kanban, with the card nowhere
		 * near it, and the card comes to the lane on its own.
		 */
		await setStatus(page, 'Beta', 'Doing')
		await expect.poll(async () => (await card(page, 'Beta')).x).toBeLessThan(beta.x)
		const moved = await card(page, 'Beta')
		expect(moved.x).toBeGreaterThan(alpha.x)
		// Still owned, and still remembering where it came from — the home survives a change of lane.
		expect(moved.home).toMatchObject({ x: 900, y: 500 })

		// And back out: no status, no lane, and the card returns to the spot it was taken from.
		await setStatus(page, 'Beta', null)
		await expect.poll(async () => (await card(page, 'Beta')).x).toBe(900)
		expect(await card(page, 'Beta')).toMatchObject({ x: 900, y: 500 })
		expect((await card(page, 'Beta')).home).toBeFalsy()

		/*
		 * It settles.
		 *
		 * The pass writes positions and every write re-triggers it, so a missing no-op guard is an
		 * infinite loop that looks perfectly fine on screen. Two samples a second apart: if the board is
		 * still churning, something has moved.
		 */
		const settled = await cards(page)
		await page.waitForTimeout(1000)
		expect(await cards(page)).toEqual(settled)

		/*
		 * And a gesture that is *not* dragging a card out must not be mistaken for one.
		 *
		 * tldraw sets `isDragging` for marquee-selecting and resizing too, and a card whose lane overflows
		 * can legitimately have its centre outside the card it belongs to — so without the
		 * "did it actually move" guard in `watchViewDragOut`, brushing a selection across the board would
		 * quietly strip the status off everything it touched.
		 */
		const brush = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.table')!
			const bounds = editor.getShapePageBounds(shape.id)!
			return {
				from: editor.pageToScreen({ x: bounds.x - 40, y: bounds.y - 40 }),
				to: editor.pageToScreen({ x: bounds.x + bounds.w + 40, y: bounds.y + bounds.h + 40 }),
			}
		})
		await page.mouse.move(brush.from.x, brush.from.y)
		await page.mouse.down()
		await page.mouse.move(brush.to.x, brush.to.y, { steps: 10 })
		await page.mouse.up()
		expect(await cards(page)).toEqual(settled)
	})

	/**
	 * The other direction: space as an *input*.
	 *
	 * Only an e2e can cover this at all. tldraw decides which shape a released drag was over
	 * (`getDraggingOverShape`), and it will only tell a shape about it if that shape's util has the drop
	 * hooks *and* answers `canReceiveNewChildrenOfType` — two conditions with a default that silently
	 * says no. A unit test of `applyViewDrop` proves the write; only this proves the write is reached.
	 */
	test('dropping a card in a lane sets its status', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'status', name: 'Status', type: 'status', options: ['To-do', 'Done'] },
					],
				},
			})
			// One card already in the board, so there are lanes to aim at, and one carrying nothing at all —
			// the sticky that is about to *become* a card by being dropped.
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 900,
					y: 300,
					props: { w: 160, h: 70, md: '# Alpha', autoHeight: false },
					meta: { 'lifeboard:props': { status: 'To-do' } },
				},
				{
					type: 'node.markdown',
					x: 900,
					y: 500,
					props: { w: 160, h: 70, md: '# Loose', autoHeight: false },
				},
			])
		})

		await drawNode(page, 'Table', { x: 400, y: 150 }, { w: 300, h: 200 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')
		await config.getByLabel('Group by').selectOption('status')
		await config.getByLabel('Show as').selectOption('kanban')
		await page.keyboard.press('Escape')

		const board = page.locator('.lb-board-host:not([data-hidden])')
		await expect(board.locator('.lb-kanban__lane')).toHaveCount(2)
		await expect.poll(async () => (await card(page, 'Alpha')).x).not.toBe(900)

		// Drag the loose sticky onto the *Done* lane. The pointer picks the lane, not the card's centre,
		// so aim the cursor at the second column.
		const { from, to } = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shapes = editor.getCurrentPageShapes()
			const loose = shapes.find((s) => String((s.props as { md?: string }).md ?? '').includes('Loose'))!
			const view = shapes.find((s) => s.type === 'node.table')!
			const looseBounds = editor.getShapePageBounds(loose.id)!
			const viewBounds = editor.getShapePageBounds(view.id)!
			return {
				// The sticky's own top-left corner area, which is a safe place to grab a note.
				from: editor.pageToScreen({ x: looseBounds.x + 20, y: looseBounds.y + 8 }),
				// Three quarters across the card: the right-hand lane of two, and below the title strip.
				to: editor.pageToScreen({
					x: viewBounds.x + viewBounds.w * 0.75,
					y: viewBounds.y + viewBounds.h * 0.6,
				}),
			}
		})

		await page.mouse.move(from.x, from.y)
		await page.mouse.down()
		// In steps, so tldraw's drag-and-drop manager gets pointer moves to resolve a target from — a
		// single jump can land the whole gesture in one frame and never register as a drag at all.
		await page.mouse.move(to.x, to.y, { steps: 12 })

		/*
		 * The lane that is about to receive it lights up — the only feedback that says *which column* a
		 * drop will write, read while the pointer is moving. Asserted mid-drag because that is the only
		 * moment it exists: `onDragShapesOver` sets it, and the drop clears it again.
		 */
		const lit = board.locator('.lb-kanban__lane--drop')
		await expect(lit).toHaveCount(1)
		await expect(lit.locator('.lb-kanban__key')).toHaveText('Done')

		await page.mouse.up()
		// Cleared on release, or a lane would stay highlighted for a drag that finished long ago.
		await expect(board.locator('.lb-kanban__lane--drop')).toHaveCount(0)

		// It gained the property it never had: that is what makes it a member.
		await expect.poll(async () => (await card(page, 'Loose')).status).toBe('Done')
		const filed = await card(page, 'Loose')
		expect(filed.home).toMatchObject({ adopted: 'drop' })
		// And it is in the *right* lane — to the right of the To-do card, in the same row.
		const alpha = await card(page, 'Alpha')
		expect(filed.x).toBeGreaterThan(alpha.x)
		expect(filed.y).toBe(alpha.y)

		// ⌘Z takes back the decision, and the card leaves the lane on its own: the property write is one
		// history entry, and the move that followed it was `history: 'ignore'`.
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
		await expect.poll(async () => (await card(page, 'Loose')).status).toBeUndefined()

		/*
		 * And the inverse gesture: dragging a card out of the lanes takes its property with it.
		 *
		 * Removed, not blanked — a card carrying an empty Status is still a member, so the view would pull
		 * it straight back into the empty lane. And it stays where it was dropped, because that is the
		 * point of dragging it somewhere.
		 */
		const inLane = await card(page, 'Alpha')
		const away = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor
				.getCurrentPageShapes()
				.find((s) => String((s.props as { md?: string }).md ?? '').includes('Alpha'))!
			const bounds = editor.getShapePageBounds(shape.id)!
			return {
				from: editor.pageToScreen({ x: bounds.x + 20, y: bounds.y + 8 }),
				to: editor.pageToScreen({ x: bounds.x + 20, y: bounds.y + 420 }),
			}
		})
		await page.mouse.move(away.from.x, away.from.y)
		await page.mouse.down()
		await page.mouse.move(away.to.x, away.to.y, { steps: 12 })
		await page.mouse.up()

		await expect.poll(async () => (await card(page, 'Alpha')).status).toBeUndefined()
		const freed = await card(page, 'Alpha')
		expect(freed.home).toBeFalsy()
		// Left where it was put, rather than sent back to the spot the view first took it from.
		expect(freed.y).toBeGreaterThan(inLane.y + 300)

		// ⌘Z gives the status back, and the card returns to its lane on its own.
		await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
		await expect.poll(async () => (await card(page, 'Alpha')).status).toBe('To-do')
		await expect.poll(async () => (await card(page, 'Alpha')).y).toBe(inLane.y)
	})

	/**
	 * The calendar, which is the other kind of view: it accepts drops without arranging anything.
	 *
	 * A month cell is a hundred pixels wide and a sticky is not, so the cards stay where they live on the
	 * board and the calendar draws them as chips. Dropping one on a day still writes that day — space as
	 * an input where it is deliberately not an output, which is the claim worth pinning.
	 */
	/**
	 * The calendar, which is a kanban whose lanes are days.
	 *
	 * Same two directions, so this checks both in one pass: a card whose date is set from *outside* walks
	 * onto its day, and a card dropped on a day gets that date and snaps into it.
	 */
	test('stands cards on their days, and files what is dropped on one', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'due', name: 'Due', type: 'date' }],
				},
			})
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 900,
					y: 300,
					props: { w: 120, h: 60, md: '# Dated', autoHeight: false },
					meta: { 'lifeboard:props': { due: '2026-08-12' } },
				},
				{
					type: 'node.markdown',
					x: 900,
					y: 500,
					props: { w: 120, h: 60, md: '# Loose', autoHeight: false },
				},
			])
		})

		await drawNode(page, 'Table', { x: 380, y: 130 }, { w: 320, h: 240 })
		await dblclickNode(page, 'node.table')
		const config = page.locator('.lb-tcfg')

		/*
		 * One choice — "a calendar" — and the card lands ready to use.
		 *
		 * The view fills in what it needs (`ViewDefinition.prepare`): the board's date property, bucketed by
		 * day, and a week as the span. A calendar that opened saying "group by a date" would be correct and
		 * useless when there is exactly one date property to mean.
		 */
		await config.getByLabel('Show as').selectOption('calendar')
		await expect(config.getByLabel('Group by')).toHaveValue('date:due')
		await expect(config.getByLabel('Calendar span')).toHaveValue('week')
		// And the date reads as today rather than blank — while staying *unpinned*, which is what keeps the
		// card on the current week next week too. The "Today" reset only appears once it is pinned.
		const today = new Date()
		const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
		await expect(config.getByLabel('Date to show')).toHaveValue(iso)
		await expect(config.getByRole('button', { name: 'Today' })).toHaveCount(0)

		// Now pin it to a day in a known week, so the assertions below are about specific columns rather
		// than about whatever week the test happens to run in.
		await config.getByLabel('Date to show').fill('2026-08-12')
		await expect(config.getByRole('button', { name: 'Today' })).toBeVisible()
		await page.keyboard.press('Escape')

		const board = page.locator('.lb-board-host:not([data-hidden])')
		// A week, which is what a calendar shows unless a month is asked for: one row of seven.
		await expect(board.locator('.lb-cal__day')).toHaveCount(7)
		await expect(board.locator('.lb-cal__weekday').first()).toHaveText('Mon')

		// The dated card left the far side of the board and stood on Wednesday, without anyone dragging it.
		await expect.poll(async () => (await card(page, 'Dated')).x).not.toBe(900)
		const dated = await card(page, 'Dated')
		expect(dated.home).toMatchObject({ x: 900, y: 300, adopted: 'query' })

		const view = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.table')!
			return editor.getShapePageBounds(shape.id)!
		})
		expect(dated.x).toBeGreaterThanOrEqual(view.x)
		expect(dated.x).toBeLessThan(view.x + view.w)

		// Now the other direction: drop the undated one on Friday.
		const from = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const loose = editor
				.getCurrentPageShapes()
				.find((s) => String((s.props as { md?: string }).md ?? '').includes('Loose'))!
			const bounds = editor.getShapePageBounds(loose.id)!
			return editor.pageToScreen({ x: bounds.x + 20, y: bounds.y + 8 })
		})
		// The fifth column of a week that starts on Monday 10 August is Friday the 14th. Read out of the
		// DOM, so the app and the test agree on where that day is drawn.
		const friday = await board.locator('.lb-cal__day').nth(4).evaluate((el) => el.getBoundingClientRect())
		await page.mouse.move(from.x, from.y)
		await page.mouse.down()
		await page.mouse.move(friday.x + friday.width / 2, friday.y + friday.height / 2, { steps: 12 })
		await expect(board.locator('.lb-cal__day--drop')).toHaveCount(1)
		await page.mouse.up()

		await expect.poll(async () => (await card(page, 'Loose')).due).toBe('2026-08-14')
		const filed = await card(page, 'Loose')
		// Friday is to the right of Wednesday, and both stand on the same row of a one-week calendar.
		expect(filed.x).toBeGreaterThan(dated.x)
		expect(filed.y).toBe(dated.y)

		// And it settles, exactly as the kanban does.
		const settled = await cards(page)
		await page.waitForTimeout(1000)
		expect(await cards(page)).toEqual(settled)

		/*
		 * The month is the same thing in four to six rows — six for August 2026, which begins on a
		 * Saturday. Asserted because the row count is derived rather than fixed, and a month that drew a
		 * fixed four would leave the last week of a long one with nowhere to stand its cards.
		 */
		await dblclickNode(page, 'node.table')
		await page.locator('.lb-tcfg').getByLabel('Calendar span').selectOption('month')
		await page.keyboard.press('Escape')
		await expect(board.locator('.lb-cal__day')).toHaveCount(42)
		// The cards kept their days across the switch: same column, further down the grid.
		await expect.poll(async () => (await card(page, 'Dated')).y).toBeGreaterThan(dated.y)
		expect((await card(page, 'Dated')).x).toBe(dated.x)
	})

	/**
	 * The guard on the factory's conditional attachment.
	 *
	 * tldraw picks its drop target by testing whether a shape's util *has* the drop hooks, so attaching
	 * them to every node — rather than only to one that declares `drop` — would make every note on the
	 * board a target. And a target shadows what is under it: the frame would stop adopting shapes dropped
	 * onto a note it contains. That failure is invisible on screen, which is why it is pinned here.
	 */
	test('a plain node does not stop a frame adopting what is dropped on it', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.createShapes([
				{ id: 'shape:frame' as never, type: 'frame', x: 300, y: 200, props: { w: 400, h: 300 } },
				{
					id: 'shape:inner' as never,
					type: 'node.markdown',
					parentId: 'shape:frame' as never,
					x: 60,
					y: 60,
					props: { w: 200, h: 100, md: '# Inner', autoHeight: false },
				},
				{
					id: 'shape:outer' as never,
					type: 'node.markdown',
					x: 900,
					y: 600,
					props: { w: 160, h: 70, md: '# Outer', autoHeight: false },
				},
			])
		})

		const points = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const outer = editor.getShapePageBounds('shape:outer')!
			const inner = editor.getShapePageBounds('shape:inner')!
			return {
				from: editor.pageToScreen({ x: outer.x + 20, y: outer.y + 8 }),
				// The middle of the note inside the frame — the note is the topmost shape at that point.
				to: editor.pageToScreen({ x: inner.x + inner.w / 2, y: inner.y + inner.h / 2 }),
			}
		})

		await page.mouse.move(points.from.x, points.from.y)
		await page.mouse.down()
		await page.mouse.move(points.to.x, points.to.y, { steps: 12 })
		await page.mouse.up()

		await expect
			.poll(async () =>
				page.evaluate(() => {
					const editor = (window as unknown as { editor: EditorHandle }).editor
					return editor.getCurrentPageShapes().find((s) => s.id === 'shape:outer')?.parentId
				})
			)
			.toBe('shape:frame')
	})
})

/**
 * The Help page's own section. Not a screenshot test — it checks the page renders and names the four
 * views, which is the one thing that goes stale silently when a view is added.
 */
test.describe('help', () => {
	test('documents every view the registry offers', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await page.getByRole('button', { name: 'Help' }).click()
		await page.getByRole('button', { name: 'Tables & views', exact: true }).click()
		await expect(page.getByRole('heading', { level: 1, name: 'Views of the board' })).toBeVisible()
		for (const view of ['a table', 'one big number', 'a kanban', 'a calendar']) {
			await expect(page.locator('.lb-help__page')).toContainText(view)
		}
		// The two demos that carry the claim nobody guesses — that these views move the real cards.
		await expect(page.locator('.lb-demo__lanes')).toBeVisible()
		await expect(page.locator('.lb-demo__week')).toBeVisible()
	})
})
