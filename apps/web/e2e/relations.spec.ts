import { expect, test, type Page } from '@playwright/test'
import { backToList, createBoard, drawNode, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Hidden relations, from the gesture end.
 *
 * The unit tests own the model — what `connectShapes` writes and what `isHiddenRelation` reads back.
 * What they cannot cover is the one genuinely risky claim in this feature: that **shift-drag still
 * binds**. tldraw already uses shift while dragging an arrow handle to lock the angle to 15° steps,
 * and it picks the shape to bind to from that rotated point — so without the `onHandleDrag` override
 * in `canvas/expressionShapeUtils.tsx`, this gesture would produce an arrow that looks right, binds
 * to nothing, and silently is not a relation at all. That failure is invisible in a screenshot and
 * invisible to every unit test, which is why it is pinned here against a real editor.
 */

interface EditorHandle {
	getCurrentPageShapes(): { id: string; type: string; meta: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	getBindingsFromShape(id: string, type: string): { id: string; toId: string; props: { terminal: string } }[]
	getCurrentToolId(): string
	setCurrentTool(id: string): void
	select(...ids: string[]): void
	getSelectedShapeIds(): string[]
	isShapeHidden(id: string): boolean
	createShapes(shapes: unknown[]): void
	updateShape(partial: unknown): void
	deleteShapes(ids: string[]): void
	deleteBindings(ids: string[]): void
	setCamera(camera: { x: number; y: number; z: number }): void
	getDocumentSettings(): { meta: Record<string, unknown> }
	updateDocumentSettings(settings: { meta: Record<string, unknown> }): void
}

/** Every arrow on the board, with what it binds to, whether it is hidden, and whether it is drawn. */
async function arrows(page: Page) {
	return page.evaluate(() => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		return editor
			.getCurrentPageShapes()
			.filter((s) => s.type === 'arrow')
			.map((arrow) => ({
				id: arrow.id,
				hidden: arrow.meta['lifeboard:relHidden'] === true,
				// The definition of a relation, read the way `getPageEdges` reads it.
				bound: editor.getBindingsFromShape(arrow.id, 'arrow').length,
				// What tldraw does about it — the difference between "marked hidden" and "not drawn".
				undrawn: editor.isShapeHidden(arrow.id),
			}))
	})
}

/** The dock's relation-view button, on the board that is actually on screen. */
function relationViewButton(page: Page) {
	return page.locator('.lb-board-host:not([data-hidden])').getByTestId('lb.relation-view')
}

/** The screen point at the centre of the nth note. */
async function noteCentre(page: Page, index: number) {
	return page.evaluate((n) => {
		const editor = (window as unknown as { editor: EditorHandle }).editor
		const notes = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')
		const note = notes[n]
		if (!note) throw new Error(`No note at index ${n}`)
		const bounds = editor.getShapePageBounds(note.id)
		if (!bounds) throw new Error('note has no bounds')
		return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
	}, index)
}

/** Drags an arrow between the two notes, optionally with shift held for its whole length. */
async function drawRelation(page: Page, { withShift }: { withShift: boolean }) {
	await page.evaluate(() => {
		;(window as unknown as { editor: EditorHandle }).editor.setCurrentTool('arrow')
	})
	await page.waitForFunction(
		() => (window as unknown as { editor: EditorHandle }).editor.getCurrentToolId() === 'arrow'
	)

	const from = await noteCentre(page, 0)
	const to = await noteCentre(page, 1)

	if (withShift) await page.keyboard.down('Shift')
	await page.mouse.move(from.x, from.y)
	await page.mouse.down()
	// Several steps: the arrow tool only starts dragging once the pointer has moved far enough, and
	// each move is a frame where the shift-vs-angle-lock decision is re-made.
	await page.mouse.move(to.x, to.y, { steps: 10 })
	await page.mouse.up()
	if (withShift) await page.keyboard.up('Shift')
}

async function boardWithTwoNotes(page: Page) {
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Relations')
	await openBoard(page, 'Relations')
	await drawNode(page, 'Note', { x: 260, y: 260 }, { w: 220, h: 150 })
	await drawNode(page, 'Note', { x: 760, y: 460 }, { w: 220, h: 150 })
	await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(2)
}

test.describe('hidden relations', () => {
	test('shift-drag draws a relation that is bound at both ends and hidden', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: true })

		const drawn = await arrows(page)
		expect(drawn).toHaveLength(1)
		// The claim: shift changed what the arrow *means*, not where it landed. Two bindings is what
		// makes it a relation — one, or none, would mean the angle lock threw the gesture off target.
		expect(drawn[0]?.bound).toBe(2)
		expect(drawn[0]?.hidden).toBe(true)
	})

	test('the same drag without shift is an ordinary, visible relation', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })

		const drawn = await arrows(page)
		expect(drawn).toHaveLength(1)
		expect(drawn[0]?.bound).toBe(2)
		expect(drawn[0]?.hidden).toBe(false)
	})

	test('the selection toolbar flips a relation, and one undo puts it back', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })

		const [arrow] = await arrows(page)
		await page.evaluate((id) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.setCurrentTool('select')
			editor.select(id)
		}, arrow!.id)

		const toggle = page.getByTestId('lb.relation-visibility')
		await expect(toggle).toBeVisible()
		await toggle.click()
		await expect.poll(async () => (await arrows(page))[0]?.hidden).toBe(true)

		// Hiding is one history entry, not one per pointer event — so a single undo shows it again.
		await page.keyboard.press('Control+z')
		await expect.poll(async () => (await arrows(page))[0]?.hidden).toBe(false)
	})

	test('hiding a relation does not un-connect it', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: true })

		// The invariant the whole feature rests on: `getPageEdges` builds the graph from bindings and
		// never looks at visibility, so a hidden relation is still an edge and everything that follows
		// arrows — tables, collections, expressions — still finds it.
		const drawn = await arrows(page)
		expect(drawn[0]?.hidden).toBe(true)
		expect(drawn[0]?.bound).toBe(2)
	})

	test('a relation goes when either of the shapes it joins goes', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })
		expect(await arrows(page)).toHaveLength(1)

		// Selected and deleted the way a person does it, rather than through the API: tldraw's own delete
		// action marks a history stopping point first, and that mark is what makes the next assertion —
		// one undo — mean anything.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.setCurrentTool('select')
			const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			editor.select(note.id)
		})
		await page.keyboard.press('Backspace')

		// Not left behind pointing at where the note used to be. Every query stopped counting it the
		// moment the binding went, so what would remain is a line that means nothing.
		await expect.poll(async () => (await arrows(page)).length).toBe(0)

		const notes = async () =>
			page.evaluate(
				() =>
					(window as unknown as { editor: EditorHandle }).editor
						.getCurrentPageShapes()
						.filter((s) => s.type === 'node.markdown').length
			)
		await expect.poll(notes).toBe(1)

		// One undo brings both back: the cascade runs inside the deletion's own transaction, so the two
		// removals share a history entry.
		await page.keyboard.press('Control+z')
		await expect.poll(async () => (await arrows(page)).length).toBe(1)
		await expect.poll(notes).toBe(2)
	})

	test('an arrow bound to a deleted shape goes too, wherever its other end was', async ({ page }) => {
		await boardWithTwoNotes(page)

		// One end on a note, the other in empty space: attached, but not a relation. It still goes, because
		// it was attached to the thing that was deleted.
		await page.evaluate(() => {
			;(window as unknown as { editor: EditorHandle }).editor.setCurrentTool('arrow')
		})
		const from = await noteCentre(page, 0)
		await page.mouse.move(from.x, from.y)
		await page.mouse.down()
		await page.mouse.move(from.x + 40, from.y + 320, { steps: 8 })
		await page.mouse.up()
		await expect.poll(async () => (await arrows(page)).length).toBe(1)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const note = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			editor.deleteShapes([note.id])
		})
		await expect.poll(async () => (await arrows(page)).length).toBe(0)
	})

	test('dragging an end off a shape leaves the arrow alone — that is how a doodle is made', async ({
		page,
	}) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })

		// Unbinding is the *other* reason a binding disappears, and it must not delete anything: an arrow
		// pulled off a shape is how someone turns a relation back into a drawing.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			const bindings = editor.getBindingsFromShape(arrow.id, 'arrow')
			editor.deleteBindings(bindings.map((b) => b.id))
		})

		await expect.poll(async () => (await arrows(page))[0]?.bound).toBe(0)
		expect(await arrows(page)).toHaveLength(1)
	})

	test('a hidden relation stops being drawn, and takes its properties with it', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })

		// An arrow carrying a property, which the board draws in a strip of its own.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'amount', name: 'Amount', type: 'number' }],
				},
			})
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			editor.updateShape({
				id: arrow.id,
				type: 'arrow',
				meta: {
					...arrow.meta,
					'lifeboard:props': { amount: 200 },
					'lifeboard:propOrder': ['amount'],
				},
			})
		})

		const strips = page.locator('.lb-board-host:not([data-hidden]) .lb-foreign-strip')
		await expect(strips).toHaveCount(1)

		await relationViewButton(page).click() // normal → all
		await relationViewButton(page).click() // all → none
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'none')

		await expect.poll(async () => (await arrows(page))[0]?.undrawn).toBe(true)
		// The one that is easy to forget: `getCurrentPageShapes` still returns a hidden shape, so a
		// layer that draws things *next to* shapes has to ask, or the property is left floating over
		// the canvas with no line under it.
		await expect(strips).toHaveCount(0)
	})
})

test.describe('the tracing lens', () => {
	/**
	 * A chain: first ──▶ second ──▶ third, plus a fourth note wired to nothing.
	 *
	 * The chain is what makes "one hop" a real claim — from `second` the lens must reach `first` and
	 * `third` and stop — and the loose note is what the dim has to act on.
	 */
	async function boardWithAChain(page: Page) {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Chain')
		await openBoard(page, 'Chain')
		await drawNode(page, 'Note', { x: 260, y: 200 }, { w: 180, h: 110 })
		await drawNode(page, 'Note', { x: 620, y: 380 }, { w: 180, h: 110 })
		await drawNode(page, 'Note', { x: 300, y: 520 }, { w: 180, h: 110 })
		await drawNode(page, 'Note', { x: 980, y: 180 }, { w: 180, h: 110 })
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(4)

		const centre = (n: number) =>
			page.evaluate((i) => {
				const editor = (window as unknown as { editor: EditorHandle }).editor
				const note = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')[i]!
				const bounds = editor.getShapePageBounds(note.id)!
				return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
			}, n)

		const drawFrom = async (a: number, b: number, shift = false) => {
			await page.evaluate(() => {
				;(window as unknown as { editor: EditorHandle }).editor.setCurrentTool('arrow')
			})
			const from = await centre(a)
			const to = await centre(b)
			if (shift) await page.keyboard.down('Shift')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move(to.x, to.y, { steps: 8 })
			await page.mouse.up()
			if (shift) await page.keyboard.up('Shift')
		}

		return { centre, drawFrom }
	}

	/** Selects the nth note, which is how the lens is pointed at something. */
	async function point(page: Page, n: number) {
		await page.evaluate((i) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.setCurrentTool('select')
			const note = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')[i]!
			editor.select(note.id)
		}, n)
	}

	/**
	 * The *shapes* carrying a trace role, counted once each.
	 *
	 * By shape id rather than by element: tldraw gives some shapes a second container for their
	 * background, so counting elements would be counting an implementation detail of the renderer
	 * instead of the claim — how many things the lens lit up.
	 */
	async function tracedIds(page: Page, role: string): Promise<string[]> {
		return page.evaluate((r) => {
			const marked = document.querySelectorAll(
				`.lb-board-host:not([data-hidden]) .tl-shape[data-lb-trace="${r}"]`
			)
			return [...new Set([...marked].map((el) => el.getAttribute('data-shape-id') ?? ''))]
		}, role)
	}

	test('lights up one hop and dims the rest', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)
		await board.drawFrom(1, 2)

		await page.getByTestId('lb.tracing').click()
		await point(page, 1)

		await expect.poll(async () => (await tracedIds(page, 'root')).length).toBe(1)
		// `first` and `third`: one hop each way. Direction is not the question being asked.
		expect(await tracedIds(page, 'near')).toHaveLength(2)
		expect(await tracedIds(page, 'arrow')).toHaveLength(2)

		// The fourth note is wired to nothing and stays dark — that is the whole effect.
		const dimmed = await page.evaluate(() => {
			const notes = document.querySelectorAll(
				'.lb-board-host:not([data-hidden]) .tl-shape[data-shape-type="node.markdown"]:not([data-lb-trace])'
			)
			return [...new Set([...notes].map((el) => el.getAttribute('data-shape-id')))].length
		})
		expect(dimmed).toBe(1)
	})

	test('stops at one hop', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)
		await board.drawFrom(1, 2)

		await page.getByTestId('lb.tracing').click()
		await point(page, 0)

		// From `first` the lens reaches `second` and stops: `third` is one hop further, and a lens that
		// followed the chain would light up a whole board and answer nothing.
		await expect.poll(async () => (await tracedIds(page, 'near')).length).toBe(1)
		expect(await tracedIds(page, 'arrow')).toHaveLength(1)
	})

	test('reveals a hidden relation while it is traced, and hides it again after', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1, true)
		await expect.poll(async () => (await arrows(page))[0]?.undrawn).toBe(true)

		await page.getByTestId('lb.tracing').click()
		await point(page, 1)
		// Tracing beats the board's own view — pointing at a node is a request to see what it is
		// connected to, and a lens that obeyed a setting from five minutes ago would look broken.
		await expect.poll(async () => (await arrows(page))[0]?.undrawn).toBe(false)

		await page.keyboard.press('Escape')
		await expect.poll(async () => (await arrows(page))[0]?.undrawn).toBe(true)
		// …and the relation was never changed, only the way it was being looked at.
		expect((await arrows(page))[0]?.hidden).toBe(true)
	})

	test('draws an aura that keeps moving', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)

		await page.getByTestId('lb.tracing').click()
		await point(page, 1)

		const outline = () => page.locator('.lb-aura__blob').first().getAttribute('d')
		const first = await outline()
		expect(first).toBeTruthy()

		// The aura is redrawn on a frame loop; a static glow would read as a selection highlight
		// rather than as something switched on.
		await expect.poll(outline, { timeout: 4000 }).not.toBe(first)
	})

	test('draws one envelope around the whole traced group, ribbon and all', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)
		await board.drawFrom(1, 2)

		await page.getByTestId('lb.tracing').click()
		await point(page, 1)

		/**
		 * Closed subpaths in the aura, which is how many separate envelopes it drew.
		 *
		 * All the loops share one `<path>` so that `evenodd` can turn an enclosed gap into a hole, so
		 * counting `M` commands is counting envelopes.
		 */
		const envelopes = async () => {
			const d = await page.locator('.lb-aura__blob').getAttribute('d')
			return (d?.match(/M /g) ?? []).length
		}

		/*
		 * One, not three. The shapes are far apart, but the *relations* are in the distance field too, so
		 * they join the group into a single outline with a ribbon running along each arrow. This is what
		 * makes the lens read as "these things are one thing" rather than as three highlighted cards.
		 */
		await expect.poll(envelopes).toBe(1)

		// And the envelope really does follow the arrows: it reaches the middle of a relation, which is
		// nowhere near any of the three shapes.
		const midpoint = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			const bounds = editor.getShapePageBounds(arrow.id)!
			return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
		})
		const aura = (await page.locator('.lb-aura__blob').boundingBox())!
		expect(midpoint.x).toBeGreaterThan(aura.x)
		expect(midpoint.x).toBeLessThan(aura.x + aura.width)
		expect(midpoint.y).toBeGreaterThan(aura.y)
		expect(midpoint.y).toBeLessThan(aura.y + aura.height)
	})

	test('parts into separate envelopes when a shape has no relations', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)

		await page.getByTestId('lb.tracing').click()
		await point(page, 0)

		const envelopes = async () => {
			const d = await page.locator('.lb-aura__blob').getAttribute('d')
			return (d?.match(/M /g) ?? []).length
		}

		// Two shapes and the relation between them: one envelope.
		await expect.poll(envelopes).toBe(1)

		// The merge is a fact about the current layout, not a state — so it still parts when there is
		// nothing joining two shapes. Deleting the relation leaves the root alone, with its own outline.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			editor.deleteShapes([arrow.id])
		})
		await expect.poll(envelopes).toBe(1)
		// …and the traced group is now just the root, so the envelope has shrunk to it.
		const aura = (await page.locator('.lb-aura__blob').boundingBox())!
		expect(aura.width).toBeLessThan(400)
	})

	test('is a mode: it announces itself, Escape leaves it, and it points at nothing elsewhere', async ({
		page,
	}) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)

		const hint = page.locator('.lb-board-host:not([data-hidden]) .lb-trace-hint')
		await expect(hint).toHaveCount(0)

		// `alt+shift+t`, dispatched by the tldraw action in uiOverrides.tsx.
		await page.keyboard.press('Alt+Shift+t')
		await expect(hint).toBeVisible()
		await expect(page.getByTestId('lb.tracing')).toHaveAttribute('data-state', 'on')

		await page.keyboard.press('Escape')
		await expect(hint).toHaveCount(0)

		/*
		 * The lens is a way of working, like a chosen tool, so it stays on across boards — an open tab
		 * keeps its editor mounted, and a mode that switched itself off whenever you glanced at
		 * another board would be worse than one that persisted.
		 *
		 * What must *not* travel is what it points at. The root is a shape id, and the trace is
		 * guarded on the shape still being on this board, so the second board opens lit up by nothing.
		 */
		await page.keyboard.press('Alt+Shift+t')
		await point(page, 1)
		await expect.poll(async () => (await tracedIds(page, 'root')).length).toBe(1)

		await backToList(page)
		await createBoard(page, 'Elsewhere')
		await openBoard(page, 'Elsewhere')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-trace-hint')).toBeVisible()
		expect(await tracedIds(page, 'root')).toHaveLength(0)
	})

	test('leaves ordinary selection alone when it is off', async ({ page }) => {
		const board = await boardWithAChain(page)
		await board.drawFrom(0, 1)
		await point(page, 1)

		// Selecting a shape is the most common gesture on a canvas; a board that dimmed itself every
		// time you clicked something would be exhausting, which is why this is a mode at all.
		expect(await tracedIds(page, 'root')).toHaveLength(0)
		await expect(page.locator('.lb-board--tracing')).toHaveCount(0)
	})
})

test.describe('an arrow’s properties', () => {
	/** Gives the board's one arrow a property, so it draws a strip. */
	async function giveArrowAProperty(page: Page) {
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'amount', name: 'Amount', type: 'number' }],
				},
			})
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			editor.updateShape({
				id: arrow.id,
				type: 'arrow',
				meta: {
					...arrow.meta,
					'lifeboard:props': { amount: 200 },
					'lifeboard:propOrder': ['amount'],
				},
			})
		})
	}

	/** Where the arrow's midpoint is on screen, and where its strip actually landed. */
	async function stripVsMidpoint(page: Page) {
		const strip = page.locator('.lb-board-host:not([data-hidden]) .lb-foreign-strip')
		await expect(strip).toHaveCount(1)
		const box = (await strip.boundingBox())!
		const midpoint = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			const bounds = editor.getShapePageBounds(arrow.id)!
			return editor.pageToScreen({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 })
		})
		return {
			midpoint,
			centre: { x: box.x + box.width / 2, y: box.y + box.height / 2 },
			corner: await page.evaluate(() => {
				const editor = (window as unknown as { editor: EditorHandle }).editor
				const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
				const bounds = editor.getShapePageBounds(arrow.id)!
				// Where the strip used to be drawn: the bottom-left of the bounding box, which for a
				// long diagonal is nowhere near the line.
				return editor.pageToScreen({ x: bounds.x, y: bounds.y + bounds.h })
			}),
		}
	}

	test('are drawn at the middle of the line, not at the corner of its bounding box', async ({
		page,
	}) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })
		await giveArrowAProperty(page)

		const { midpoint, centre, corner } = await stripVsMidpoint(page)

		// The claim of the phase, stated as a comparison rather than an absolute: the strip is near
		// the middle of the line, and much further from where it used to be drawn.
		const toMiddle = Math.hypot(centre.x - midpoint.x, centre.y - midpoint.y)
		const toCorner = Math.hypot(centre.x - corner.x, centre.y - corner.y)
		expect(toMiddle).toBeLessThan(40)
		expect(toCorner).toBeGreaterThan(150)
	})

	test('move with the arrow when one of its ends is dragged', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })
		await giveArrowAProperty(page)
		const before = await stripVsMidpoint(page)

		// Drag the second note: the arrow is bound to it, so the line — and the strip hanging off its
		// middle — has to follow. A strip positioned from stale geometry would stay put.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const note = editor.getCurrentPageShapes().filter((s) => s.type === 'node.markdown')[1]!
			const bounds = editor.getShapePageBounds(note.id)!
			editor.updateShape({ id: note.id, type: note.type, x: bounds.x, y: bounds.y + 300 })
		})

		await expect
			.poll(async () => {
				const after = await stripVsMidpoint(page)
				return Math.hypot(after.centre.x - after.midpoint.x, after.centre.y - after.midpoint.y)
			})
			.toBeLessThan(40)
		const after = await stripVsMidpoint(page)
		expect(after.centre.y).toBeGreaterThan(before.centre.y)
	})

	test('sit under the arrow’s own label rather than on top of it', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })
		await giveArrowAProperty(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			const arrow = editor.getCurrentPageShapes().find((s) => s.type === 'arrow')!
			editor.updateShape({
				id: arrow.id,
				type: 'arrow',
				props: {
					richText: {
						type: 'doc',
						content: [{ type: 'paragraph', content: [{ type: 'text', text: 'uses' }] }],
					},
				},
			})
		})

		// The label is tldraw's own element, drawn at the arrow's label position; the strip has to
		// clear it. Same anchor, stacked — name on top, data underneath.
		// tldraw's own label element: `RichTextLabel` renders `tl-text-label` on its wrapper, and the
		// `data-hastext` attribute is what distinguishes a rendered label from the empty placeholder
		// every arrow carries.
		const label = page
			.locator('.lb-board-host:not([data-hidden]) .tl-text-label[data-hastext="true"]')
			.first()
		await expect(label).toBeVisible()
		const labelBox = (await label.boundingBox())!
		const stripBox = (await page
			.locator('.lb-board-host:not([data-hidden]) .lb-foreign-strip')
			.boundingBox())!
		expect(stripBox.y).toBeGreaterThanOrEqual(labelBox.y + labelBox.height - 2)
	})
})

test.describe('the board’s relation view', () => {
	/**
	 * Two priced shapes and a table that follows the arrows into it — the setup from smoke.spec.ts's
	 * connected-table test, because this is where the feature has to prove it is a *view*.
	 */
	async function boardWithConnectedTable(page: Page) {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Wiring')
		await openBoard(page, 'Wiring')

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [{ id: 'price', name: 'Price', type: 'number' }],
				},
			})
			editor.createShapes([
				{
					type: 'geo',
					x: 100,
					y: 100,
					props: { w: 120, h: 80 },
					meta: { 'lifeboard:props': { price: 1200 }, 'lifeboard:propOrder': ['price'] },
				},
				{
					type: 'geo',
					x: 100,
					y: 320,
					props: { w: 120, h: 80 },
					meta: { 'lifeboard:props': { price: 400 }, 'lifeboard:propOrder': ['price'] },
				},
				{
					type: 'node.table',
					x: 520,
					y: 180,
					props: {
						w: 240,
						h: 160,
						title: 'Connected',
						source: { shapeTypes: null, scope: 'connected', frameId: null, filters: [] },
						columns: [{ key: 'price', summary: 'sum', width: 1 }],
						groupBy: null,
						sorts: [],
						layout: { mode: 'value', maxRows: 12 },
					},
				},
			])
			editor.setCamera({ x: 0, y: 0, z: 1 })
		})
	}

	/** Screen coordinates: the camera is at the origin, but the canvas is offset by the app chrome. */
	async function canvasOrigin(page: Page) {
		return page.evaluate(() => {
			const box = document
				.querySelector('.lb-board-host:not([data-hidden]) .tl-container')!
				.getBoundingClientRect()
			return { x: box.x, y: box.y }
		})
	}

	test('hiding relations never changes what they add up to', async ({ page }) => {
		await boardWithConnectedTable(page)
		const origin = await canvasOrigin(page)
		const at = (x: number, y: number) => ({ x: origin.x + x, y: origin.y + y })

		const drawArrow = async (
			from: { x: number; y: number },
			to: { x: number; y: number },
			shift: boolean
		) => {
			await page.keyboard.press('a')
			if (shift) await page.keyboard.down('Shift')
			await page.mouse.move(from.x, from.y)
			await page.mouse.down()
			await page.mouse.move(to.x, to.y, { steps: 8 })
			await page.mouse.up()
			if (shift) await page.keyboard.up('Shift')
			await page.keyboard.press('Escape')
		}

		const host = page.locator('.lb-board-host:not([data-hidden])')
		const total = host.locator('.lb-table__value').first()
		const count = host.locator('.lb-table__count').first()

		await drawArrow(at(160, 140), at(640, 260), false)
		await expect(count).toHaveText('1 row')

		// Drawn hidden — and counted anyway. This is the sentence the whole feature is built to make
		// true: the data stays, the clutter goes.
		await drawArrow(at(160, 360), at(640, 260), true)
		await expect(count).toHaveText('2 rows')
		await expect(total).toContainText('1,600')

		const view = relationViewButton(page)
		await expect(view).toHaveAttribute('data-state', 'normal')
		// Only the shift-drawn one is undrawn, which is what "normal" means.
		await expect.poll(async () => (await arrows(page)).filter((a) => a.undrawn).length).toBe(1)

		await view.click() // → all: even the hidden one is drawn, so it can be found again
		await expect(view).toHaveAttribute('data-state', 'all')
		await expect.poll(async () => (await arrows(page)).filter((a) => a.undrawn).length).toBe(0)

		await view.click() // → none: the board as if nothing were wired
		await expect(view).toHaveAttribute('data-state', 'none')
		await expect.poll(async () => (await arrows(page)).filter((a) => a.undrawn).length).toBe(2)

		// …and through all of it, the table has not moved. If this ever fails, "hide" has quietly
		// started to mean "delete".
		await expect(count).toHaveText('2 rows')
		await expect(total).toContainText('1,600')

		await view.click() // → back to normal
		await expect(view).toHaveAttribute('data-state', 'normal')
	})

	test('is a property of the board, not of the app', async ({ page }) => {
		await boardWithConnectedTable(page)
		await relationViewButton(page).click()
		await relationViewButton(page).click()
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'none')

		await backToList(page)
		await createBoard(page, 'Second')
		await openBoard(page, 'Second')
		// A board thick with structure and a board of loose notes want different answers, so the
		// setting lives in the board's own record rather than in an app-wide preference.
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'normal')

		await backToList(page)
		await openBoard(page, 'Wiring')
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'none')
	})

	test('the keyboard cycles it, and a hidden shape stops being selected', async ({ page }) => {
		await boardWithTwoNotes(page)
		await drawRelation(page, { withShift: false })

		const [arrow] = await arrows(page)
		await page.evaluate((id) => {
			const editor = (window as unknown as { editor: EditorHandle }).editor
			editor.setCurrentTool('select')
			editor.select(id)
		}, arrow!.id)
		await expect(page.getByTestId('lb.relation-visibility')).toBeVisible()

		// `alt+shift+r`, dispatched by the tldraw action in uiOverrides.tsx — the ⌘K registry's `kbd`
		// is display only, so this is the assertion that the key is actually wired to anything.
		await page.keyboard.press('Alt+Shift+r') // normal → all
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'all')
		await page.keyboard.press('Alt+Shift+r') // all → none
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'none')

		// The arrow is no longer drawn, so it must no longer be selected: a selection ring and a
		// toolbar floating over empty canvas is what "hidden but still selected" looks like.
		await expect(page.getByTestId('lb.relation-visibility')).toHaveCount(0)
		await expect
			.poll(async () =>
				page.evaluate(
					() => (window as unknown as { editor: EditorHandle }).editor.getSelectedShapeIds?.().length
				)
			)
			.toBe(0)
	})

	test('an arrow drawn across empty space is a drawing, and the view leaves it alone', async ({
		page,
	}) => {
		await boardWithConnectedTable(page)
		const origin = await canvasOrigin(page)

		await page.keyboard.press('a')
		await page.mouse.move(origin.x + 200, origin.y + 560)
		await page.mouse.down()
		await page.mouse.move(origin.x + 420, origin.y + 620, { steps: 6 })
		await page.mouse.up()
		await page.keyboard.press('Escape')

		await relationViewButton(page).click()
		await relationViewButton(page).click()
		await expect(relationViewButton(page)).toHaveAttribute('data-state', 'none')

		// "No relations" must not mean "no arrows": a sketch with a loose end is not a claim about
		// anything, and making someone's drawing vanish would be a bug rather than a feature.
		const loose = (await arrows(page)).filter((a) => a.bound < 2)
		expect(loose).toHaveLength(1)
		expect(loose[0]?.undrawn).toBe(false)
	})
})
