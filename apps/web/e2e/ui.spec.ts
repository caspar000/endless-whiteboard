import { expect, test } from '@playwright/test'
import {
	NOTE_EDITOR,
	backToList,
	dblclickNode,
	createBoard,
	gotoFresh,
	noteMarkdown,
	openBoard,
	skipFirstRunDemo,
} from './helpers'

test.describe('canvas chrome', () => {
	test('double-clicking empty canvas creates a note, already in editing mode', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 300)

		// Writing is the default action now — no picker, no text shape.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-note--editing')).toBeVisible()
		expect(await countByType(page, 'node.markdown')).toBe(1)
		expect(await countByType(page, 'text')).toBe(0)

		// The caret is already in the note, so you can just type.
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		const editing = await page.evaluate(
			() => (window as unknown as { editor: EditorLike }).editor.getEditingShapeId() !== null
		)
		expect(editing).toBe(true)
	})

	test('markdown renders inline as you leave each line, keeping the source intact', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 260)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		await page.keyboard.type('# Chores')
		// Raw while the caret is on the line — that is what makes it *live* preview rather than a
		// deferred render.
		await expect(page.locator(NOTE_EDITOR)).toContainText('# Chores')

		await page.keyboard.press('Enter')
		await page.keyboard.type('first prose line')
		// The heading now renders: its `#` is gone from the text even though the source still has it.
		await expect(page.locator(NOTE_EDITOR)).not.toContainText('# Chores')
		await expect(page.locator(NOTE_EDITOR)).toContainText('Chores')

		await page.keyboard.press('Escape')
		// Asserted on the source, because that is what every other feature reads. The markup was hidden,
		// never removed.
		expect(await noteMarkdown(page)).toBe('# Chores\nfirst prose line')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body h1')).toHaveText('Chores')
	})

	test('list markers auto-continue, and an empty one leaves the list', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		await page.keyboard.type('# Shopping')
		await page.keyboard.press('Enter')
		// Only the first marker is typed; the rest are prefilled.
		await page.keyboard.type('- [ ] standing desk')
		await page.keyboard.press('Enter')
		await page.keyboard.type('desk lamp')
		await page.keyboard.press('Enter')
		await page.keyboard.type('rug')
		await page.keyboard.press('Enter')
		// Enter on the now-empty marker leaves the list.
		await page.keyboard.press('Enter')
		await page.keyboard.type('**Budget:** 3000 GEL')
		await page.keyboard.press('Enter')
		await page.keyboard.type('1. first')
		await page.keyboard.press('Enter')
		await page.keyboard.type('second')
		await page.keyboard.press('Escape')

		const md = await page.evaluate(
			() =>
				(window as unknown as { editor: EditorLike }).editor
					.getCurrentPageShapes()
					.find((s) => s.type === 'node.markdown')!.props.md
		)
		// A blank line after "rug" — leaving a list has to insert one, or the Budget line is a lazy
		// continuation of the last item and renders indented under the bullet.
		expect(md).toBe(
			'# Shopping\n- [ ] standing desk\n- [ ] desk lamp\n- [ ] rug\n\n**Budget:** 3000 GEL\n1. first\n2. second'
		)

		// Three tasks, an ordered list that counted up, and Budget outside the list.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body input[type=checkbox]')).toHaveCount(3)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body ol li')).toHaveCount(2)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body ul strong')).toHaveCount(0)
	})

	test('a task shows only its checkbox, and plain bullets keep their marker', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 100,
					y: 100,
					props: { w: 300, h: 160, md: '- [ ] task\n- plain', autoHeight: true },
				},
			])
		})

		// A checkbox *is* the item's marker, so a bullet beside it reads as two markers for one item. GFM
		// puts task items and plain bullets in the same <ul>, so this has to be per-item.
		const task = page.locator('.lb-board-host:not([data-hidden]) .lb-md__body li.task-list-item')
		const plain = page.locator('.lb-board-host:not([data-hidden]) .lb-md__body li:not(.task-list-item)')
		await expect(task).toHaveCount(1)
		await expect(plain).toHaveCount(1)
		expect(await task.evaluate((el) => getComputedStyle(el).listStyleType)).toBe('none')
		expect(await plain.evaluate((el) => getComputedStyle(el).listStyleType)).toBe('disc')
	})

	test('a task can be ticked straight from the preview, without entering the editor', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 100,
					y: 100,
					props: { w: 300, h: 180, md: '# Chores\n- [ ] milk\n- [x] bread', autoHeight: true },
				},
			])
		})

		const readMd = () =>
			page.evaluate(
				() =>
					(window as unknown as { editor: EditorLike }).editor
						.getCurrentPageShapes()
						.find((s) => s.type === 'node.markdown')!.props.md
			)

		const boxes = page.locator('.lb-board-host:not([data-hidden]) .lb-md__task')
		await expect(boxes).toHaveCount(2)

		await boxes.first().click()
		await expect.poll(readMd).toBe('# Chores\n- [x] milk\n- [x] bread')

		// The second box unticks the one it belongs to — the mapping from checkbox to source line is by
		// position, so an off-by-one here would tick the wrong task.
		await boxes.nth(1).click()
		await expect.poll(readMd).toBe('# Chores\n- [x] milk\n- [ ] bread')

		// And ticking is not an edit gesture: the shape must not become selected or enter editing, or
		// every tick would fight the canvas.
		expect(
			await page.evaluate(() => {
				const editor = (window as unknown as { editor: EditorLike }).editor
				return {
					editing: editor.getEditingShapeId(),
					selected: editor.getSelectedShapeIds().length,
				}
			})
		).toEqual({ editing: null, selected: 0 })
	})

	test('the editor has Tab, formatting and list shortcuts', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		await page.keyboard.type('- milk')
		// Tab nests, Shift+Tab un-nests. In a note the canvas has nothing to tab to, and every outliner
		// binds Tab this way.
		await page.keyboard.press('Tab')
		await page.keyboard.press('Tab')
		await page.keyboard.press('Shift+Tab')
		// ⌘B wraps the word under the caret — no selecting first.
		await page.keyboard.press('ControlOrMeta+b')
		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe('  - **milk**')
	})

	test('a shortcut turns a whole selection into a checklist', async ({ page }) => {
		// Only possible because the editor is CodeMirror now: a selection can span lines, so a line-level
		// command can apply to all of them. The previous editor put one textarea on the caret's line and
		// could not express this at all.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('milk')
		await page.keyboard.press('Enter')
		await page.keyboard.type('bread')
		await page.keyboard.press('Enter')
		await page.keyboard.type('rug')

		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.press('ControlOrMeta+Shift+9')
		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe('- [ ] milk\n- [ ] bread\n- [ ] rug')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__task')).toHaveCount(3)
	})

	test('Tab indents every line of a selection at once', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 100,
					y: 100,
					props: { w: 320, h: 120, md: '- one\n- two\n- three', autoHeight: true },
				},
			])
		})
		await dblclickNode(page, 'node.markdown')
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		await page.keyboard.press('ControlOrMeta+a')
		await page.keyboard.press('Tab')
		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe('  - one\n  - two\n  - three')
	})

	test('leaving a list inserts the blank line markdown needs', async ({ page }) => {
		// Without it the next paragraph is a *lazy continuation* of the last item and renders inside its
		// bullet. This is the behaviour that ruled out the editor library tried before CodeMirror: it binds
		// Enter at the highest precedence and registers first, so its version could not be overridden.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('- [ ] rug')
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter')
		await page.keyboard.type('**Budget:** 3000 GEL')
		await page.keyboard.press('Escape')

		expect(await noteMarkdown(page)).toBe('- [ ] rug\n\n**Budget:** 3000 GEL')
		// And the paragraph really is outside the list.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body ul strong')).toHaveCount(0)
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body > p strong')).toHaveText('Budget:')
	})

	test('one undo reverts a whole editing session', async ({ page }) => {
		// Escape has to be claimed *before* CodeMirror and tldraw both see it. tldraw otherwise treats the
		// same Escape as "clear selection", which marks a history stopping point — an empty entry that sat on
		// top of the undo stack, so the first ⌘Z after writing a note did nothing at all.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('# Chores')
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body h1')).toHaveText('Chores')

		// Nothing between exiting and undoing: the point is that the *first* press does the work.
		await page.keyboard.press('ControlOrMeta+z')
		await expect.poll(async () => countByType(page, 'node.markdown')).toBe(0)
	})

	test('the caret starts at the end of an existing note, not the beginning', async ({ page }) => {
		// CodeMirror defaults the selection to offset 0, which made double-clicking a note and typing insert
		// the text *before* the content — `!# Existing note`.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 100,
					y: 100,
					props: { w: 320, h: 100, md: '# Existing note', autoHeight: true },
				},
			])
		})
		await dblclickNode(page, 'node.markdown')
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('!')
		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe('# Existing note!')
	})

	test('markdown markers hide once the caret leaves their line', async ({ page }) => {
		// The live-preview contract: the document is never transformed, only decorated — so the markers are
		// hidden from view while remaining in the source.
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			editor.createShapes([
				{
					type: 'node.markdown',
					x: 100,
					y: 100,
					props: {
						w: 340,
						h: 160,
						md: '# Heading\n\nsome **bold** text\n\n- [ ] a task\n- a bullet\n\ntail',
						autoHeight: true,
					},
				},
			])
		})
		await dblclickNode(page, 'node.markdown')
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		const editorText = () => page.locator(NOTE_EDITOR).innerText()
		// The caret lands on the last line, so every other line renders.
		expect(await editorText()).toContain('Heading')
		expect(await editorText()).not.toContain('# Heading')
		expect(await editorText()).not.toContain('**bold**')
		// A task's checkbox is a real control, and it replaces the bullet rather than joining it — one
		// checkbox for the task, one bullet for the plain item.
		await expect(page.locator('.lb-cm-task')).toHaveCount(1)
		await expect(page.locator('.lb-cm-bullet')).toHaveCount(1)

		// Move the caret onto the heading and its `#` comes back: that is what makes it *editable* rather
		// than merely rendered.
		await page.keyboard.press('ControlOrMeta+Home')
		await expect.poll(editorText).toContain('# Heading')

		// The source was untouched throughout — decorations are presentation only.
		await page.keyboard.press('Escape')
		expect(await noteMarkdown(page)).toBe(
			'# Heading\n\nsome **bold** text\n\n- [ ] a task\n- a bullet\n\ntail'
		)
	})

	test('double-clicking an existing note puts the caret straight in the text', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Make a note and leave it. Waiting for focus first is not optional: typing before the editor
		// has the caret sends the keystrokes to the canvas, where letters are tool shortcuts.
		await page.mouse.dblclick(560, 260)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('# Existing note')
		await page.keyboard.press('Escape')
		await page.mouse.click(900, 620)

		const point = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + 14 })
		})
		await page.mouse.dblclick(point.x, point.y)

		// One double-click is enough: tldraw focuses its own canvas container after React mounts the
		// editor, so without re-asserting focus the note looked active while keystrokes went nowhere
		// and you had to click a second time.
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()
		await page.keyboard.type('!')
		await page.keyboard.press('Escape')
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md__body h1')).toHaveText('Existing note!')
	})

	test('a note grows with its content, and a vertical drag pins the height', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 220)
		await expect(page.locator(NOTE_EDITOR)).toBeFocused()

		const readNote = () =>
			page.evaluate(() => {
				const s = (window as unknown as { editor: EditorLike }).editor
					.getCurrentPageShapes()
					.find((x) => x.type === 'node.markdown')!
				return { h: Math.round(s.props.h as number), auto: s.props.autoHeight as boolean }
			})

		const before = await readNote()
		await page.keyboard.type('# Title')
		await page.keyboard.press('Enter')
		await page.keyboard.type('a line\n\nanother line\n\nand a third')
		await page.keyboard.press('Escape')

		await expect.poll(async () => (await readNote()).h).toBeGreaterThan(before.h)
		expect((await readNote()).auto).toBe(true)

		// The height is a derived cache written with `history: 'ignore'`, so growing it must not have
		// added undo entries — one undo still reverts the whole editing session.
		const grown = await readNote()
		await page.keyboard.press('ControlOrMeta+z')
		await expect
			.poll(async () =>
				page.evaluate(
					() =>
						(window as unknown as { editor: EditorLike }).editor
							.getCurrentPageShapes()
							.filter((s) => s.type === 'node.markdown').length
				)
			)
			.toBe(0)
		await page.keyboard.press('ControlOrMeta+Shift+z')
		await expect.poll(async () => (await readNote()).h).toBe(grown.h)

		// Dragging the bottom edge is an explicit request for a fixed height.
		//
		// Selection first, in its own step: the edge handle only exists once tldraw has rendered the
		// selection foreground, and the bottom edge is only where it looks once auto-height has stopped
		// adjusting. Computing the coordinates in the same breath as selecting made this flaky — the
		// drag landed a pixel or two outside the handle and translated the shape instead of resizing it.
		await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const s = editor.getCurrentPageShapes().find((x) => x.type === 'node.markdown')!
			editor.select(s.id)
		})
		// Two frames for tldraw to render the selection foreground the handle lives in.
		await page.evaluate(
			() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
		)

		let settled = -1
		await expect
			.poll(async () => {
				const { h } = await readNote()
				const stable = h === settled
				settled = h
				return stable
			})
			.toBe(true)

		const handle = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			const s = editor.getCurrentPageShapes().find((x) => x.type === 'node.markdown')!
			const b = editor.getShapePageBounds(s.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h })
		})
		await page.mouse.move(handle.x, handle.y)
		await page.mouse.down()
		await page.mouse.move(handle.x, handle.y + 130, { steps: 8 })
		await page.mouse.up()

		await expect.poll(async () => (await readNote()).auto).toBe(false)
		expect((await readNote()).h).toBeGreaterThan(settled)
	})

	test('the context menu offers every node type so they stay discoverable', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		// Double-click is now "write", so right-click is what surfaces the other node types.
		await page.mouse.click(560, 300, { button: 'right' })
		for (const label of ['Add note', 'Add table']) {
			await expect(page.getByRole('menuitem', { name: label })).toBeVisible()
		}
		// Retired node types stay registered but must not be offered anywhere.
		await expect(page.getByRole('menuitem', { name: 'Add item' })).toHaveCount(0)
		await expect(page.getByRole('menuitem', { name: 'Add rollup' })).toHaveCount(0)

		await page.getByRole('menuitem', { name: 'Add table' }).click()
		expect(await countByType(page, 'node.table')).toBe(1)
	})

	test('double-clicking an existing node still edits it rather than offering to create', async ({
		page,
	}) => {
		await gotoFresh(page)
		// The demo board is full of nodes.
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-strip').first()).toBeVisible()

		const before = await countByType(page, 'node.markdown')
		const point = await page.evaluate(() => {
			const editor = (window as unknown as { editor: EditorLike }).editor
			// A rollup: the one remaining node type whose editor is a popover, so "did it edit rather
			// than create?" has an unambiguous answer on screen.
			const shape = editor.getCurrentPageShapes().find((s) => s.type === 'node.table')!
			const b = editor.getShapePageBounds(shape.id)!
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + 12 })
		})
		await page.mouse.dblclick(point.x, point.y)

		// It edits the node rather than creating a new one on top of it.
		await expect(page.locator('.lb-popover')).toBeVisible()
		expect(await countByType(page, 'node.markdown')).toBe(before)
	})

	test('the sticky note sits between the arrow and the node tools, on n', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		const dock = page.locator('.lb-board-host:not([data-hidden]) .lb-dock')
		const order = await dock.evaluate((el) =>
			[...el.children].map((child) =>
				child.classList.contains('lb-dock__sep')
					? '|'
					: (child.getAttribute('data-testid')?.replace('tools.', '') ?? '?')
			)
		)
		// tldraw's sticky is one of its own shapes, so it stays on the arrow's side of the separator and
		// leaves the group below purely registry-driven.
		expect(order.slice(0, 7)).toEqual([
			'select',
			'hand',
			'frame',
			'arrow',
			'note',
			'|',
			'node-markdown',
		])

		// `n` is tldraw's own shortcut for it. The markdown node used to take that key, which silently
		// left two tools claiming it; it is `m` now.
		await page.keyboard.press('n')
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { editor: EditorLike }).editor.getCurrentToolId()
				)
			)
			.toBe('note')

		// And it really makes a sticky, not one of our nodes.
		await page.mouse.move(700, 420)
		await page.mouse.down()
		await page.mouse.up()
		await expect.poll(() => countByType(page, 'note')).toBe(1)
		await page.keyboard.press('Escape')

		await page.keyboard.press('Escape')
		await page.locator('.lb-board-host:not([data-hidden])').getByTestId('tools.select').click()
		await page.keyboard.press('m')
		await expect
			.poll(() =>
				page.evaluate(
					() => (window as unknown as { editor: EditorLike }).editor.getCurrentToolId()
				)
			)
			.toBe('node-markdown')
	})

	test('a frame is a transparent outline, and its colour is one swatch that opens a palette', async ({
		page,
	}) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		const id = await page.evaluate(() => {
			const ed = (window as unknown as { editor: EditorLike }).editor
			const before = new Set(ed.getCurrentPageShapes().map((s) => s.id))
			// In view with room above: the toolbar and its palette float over the shape.
			ed.setCamera({ x: 0, y: 0, z: 1 })
			ed.createShapes([{ type: 'frame', x: 220, y: 380, props: { w: 380, h: 200, name: 'Group' } }])
			const made = ed.getCurrentPageShapes().find((s) => !before.has(s.id))!.id
			ed.select(made)
			return made
		})

		// No fill: you group things with a frame to say they belong together, not to hide the paper.
		const body = page.locator('.lb-board-host:not([data-hidden]) .tl-frame__body').first()
		await expect(body).toHaveAttribute('fill', 'transparent')
		// And a border thicker than tldraw's 1px default, since with no fill the border *is* the shape.
		expect(
			await body.evaluate((el) => Number.parseFloat(getComputedStyle(el).strokeWidth))
		).toBeGreaterThan(1)

		// One swatch, not a row — and a ring, because a frame paints no area.
		const swatch = page.locator('[data-testid="lb.color"]')
		await expect(swatch).toBeVisible()
		expect(await swatch.evaluate((el) => el.className)).toContain('lb-swatch--ring')

		// It opens a palette *above* the bar, the way the dock's pen button opens its settings row.
		await swatch.click()
		const palette = page.locator('.lb-seltb__palette')
		await expect(palette).toBeVisible()
		expect(await palette.locator('button').count()).toBeGreaterThan(5)
		const paletteBox = (await palette.boundingBox())!
		const swatchBox = (await swatch.boundingBox())!
		expect(paletteBox.y + paletteBox.height).toBeLessThanOrEqual(swatchBox.y + 2)

		await palette.locator('button[aria-label="Colour violet"]').click()
		await expect
			.poll(() =>
				page.evaluate((shapeId) => {
					const ed = (
						window as unknown as {
							editor: { getShape(id: string): { props: { color: string } } }
						}
					).editor
					return ed.getShape(shapeId).props.color
				}, id)
			)
			.toBe('violet')
		// Picking closes it, so the palette never outlives the choice.
		await expect(palette).toHaveCount(0)
	})

	test('the colour swatch is filled for a sticky and absent for a shape with no colour', async ({
		page,
	}) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		const select = (spec: Record<string, unknown>) =>
			page.evaluate((shape) => {
				const ed = (window as unknown as { editor: EditorLike }).editor
				ed.setCamera({ x: 0, y: 0, z: 1 })
				const before = new Set(ed.getCurrentPageShapes().map((s) => s.id))
				ed.createShapes([shape])
				ed.select(ed.getCurrentPageShapes().find((s) => !before.has(s.id))!.id)
			}, spec)

		// A sticky's colour fills it, so a filled dot is the truth rather than a ring.
		await select({ type: 'note', x: 240, y: 400, props: {} })
		const swatch = page.locator('[data-testid="lb.color"]')
		await expect(swatch).toBeVisible()
		expect(await swatch.evaluate((el) => el.className)).not.toContain('lb-swatch--ring')

		// A table carries no colour style at all, so the control must not appear — that comes from
		// tldraw's own `getSharedStyles`, not from a list of shape types we maintain.
		await select({ type: 'node.table', x: 700, y: 400, props: { w: 280, h: 160 } })
		await expect(page.locator('[data-testid="lb.color"]')).toHaveCount(0)
	})

	test('rounded corners reach both frames and images, and can be turned off', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		// On by default at `sm`: a slight radius is the look this exists for.
		await expect(page.locator('html')).toHaveAttribute('data-roundness', 'sm')

		await page.evaluate(async () => {
			const ed = (window as unknown as { editor: EditorLike }).editor
			ed.setCamera({ x: 0, y: 0, z: 1 })
			ed.createShapes([{ type: 'frame', x: 120, y: 300, props: { w: 300, h: 180, name: 'F' } }])
			const c = document.createElement('canvas')
			c.width = 180
			c.height = 120
			const x = c.getContext('2d')!
			x.fillStyle = '#d92b2b'
			x.fillRect(0, 0, 180, 120)
			const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
			await (
				window as unknown as { editor: { putExternalContent(o: unknown): Promise<void> } }
			).editor.putExternalContent({
				type: 'files',
				files: [new File([blob], 'i.png', { type: 'image/png' })],
				point: { x: 700, y: 380 },
			})
		})

		const frame = page.locator('.lb-board-host:not([data-hidden]) .tl-frame__body').first()
		const image = page.locator('.lb-board-host:not([data-hidden]) .tl-image-container').first()
		await expect(image).toBeVisible()

		// `rx` on the frame's rect, `border-radius` on the image's container — one variable reaches both.
		const radii = () =>
			Promise.all([
				frame.evaluate((el) => getComputedStyle(el).rx),
				image.evaluate((el) => getComputedStyle(el).borderTopLeftRadius),
				// Clipping as well as rounding, or a photo's own corners poke out of the rounded box.
				image.evaluate((el) => getComputedStyle(el).overflow),
			])
		expect(await radii()).toEqual(['6px', '6px', 'hidden'])

		// The scale moves both together, and `off` is genuinely square.
		await page.evaluate(() => {
			document.documentElement.dataset.roundness = 'xl'
		})
		expect(await radii()).toEqual(['24px', '24px', 'hidden'])
		await page.evaluate(() => {
			document.documentElement.dataset.roundness = 'off'
		})
		expect(await radii()).toEqual(['0px', '0px', 'hidden'])
	})

	test('the canvas has dotted paper and no style panel', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		// Dotted paper: rendered as the canvas background so it pans and zooms with the board.
		const paper = page.locator('.lb-paper')
		await expect(paper).toBeVisible()
		await expect(paper.locator('pattern')).not.toHaveCount(0)

		// The dots are anchored in page space, so panning must move the pattern offset.
		const before = await firstDotOffset(page)
		await page.evaluate(() => {
			;(window as unknown as { editor: EditorLike }).editor.setCamera({ x: 137, y: 61, z: 1 })
		})
		await expect.poll(() => firstDotOffset(page)).not.toBe(before)

		// The top-right colour/opacity panel is gone.
		await expect(page.locator('.tlui-style-panel')).toHaveCount(0)
	})
})

test.describe('home screen', () => {
	test('shows a sidebar with a live count and starred boards under Favourites', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Second board')

		const sidebar = page.locator('.lb-sidebar')
		await expect(sidebar.getByRole('button', { name: /All boards 2/ })).toBeVisible()
		await expect(page.locator('.lb-card')).toHaveCount(2)

		// The Favourites section only exists once something is starred, and then lists exactly
		// that board by name.
		await expect(sidebar.locator('.lb-sidebar__section')).toHaveCount(0)

		const card = page.locator('.lb-card', { hasText: 'Second board' })
		await card.hover()
		await card.getByRole('button', { name: 'Favourite Second board' }).click()

		const favourites = sidebar.locator('.lb-sidebar__section')
		await expect(favourites).toBeVisible()
		await expect(favourites.getByRole('button', { name: 'Second board' })).toBeVisible()
		await expect(favourites.getByRole('button')).toHaveCount(1)

		// Clicking a favourite opens that board directly.
		await favourites.getByRole('button', { name: 'Second board' }).click()
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText(
			'Second board'
		)
	})

	test('favourite state survives a reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const card = page.locator('.lb-card').first()
		await card.hover()
		await card.getByRole('button', { name: /^Favourite / }).click()
		await expect(page.locator('.lb-sidebar__section').getByRole('button')).toHaveCount(1)

		await page.reload()
		await expect(page.locator('.lb-sidebar__section').getByRole('button')).toHaveCount(1)
	})

	test('board cards show a thumbnail of the board once it has been closed', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Sketch')
		await openBoard(page, 'Sketch')

		await page.evaluate(() => {
			;(window as unknown as { editor: EditorLike }).editor.createShapes([
				{
					type: 'node.markdown',
					x: 0,
					y: 0,
					props: { w: 320, h: 160, md: '# Thumbnail me' },
				},
			])
		})
		await expect(page.locator('.lb-board-host:not([data-hidden]) .lb-md')).toHaveCount(1)
		await backToList(page)

		// The thumbnail is captured from the live editor as the board unmounts, so it appears shortly
		// after leaving rather than instantly.
		const card = page.locator('.lb-card', { hasText: 'Sketch' })
		await expect
			.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 })
			.toBe(1)

		// A real image, not a zero-byte placeholder.
		const size = await card.locator('.lb-card__image').evaluate((img) => {
			const el = img as HTMLImageElement
			return { w: el.naturalWidth, h: el.naturalHeight }
		})
		expect(size.w).toBeGreaterThan(50)
		expect(size.h).toBeGreaterThan(50)

		// And it stays put. A second export used to run from the editor's unmount path, while the board
		// was hidden for the persistence drain, and overwrote this one with a version missing every node
		// background and font — previews looked right for about a second and then decayed.
		const bytes = await thumbnailBytes(page)
		expect(bytes.length).toBeGreaterThan(0)
		await page.waitForTimeout(3000)
		expect(await thumbnailBytes(page)).toEqual(bytes)
	})

	test('the board title can be renamed by double-clicking its tab', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		const title = page.locator('.lb-tabs__tab--active .lb-tabs__label')
		await expect(title).toHaveText('Home office shopping')
		await title.dblclick()

		const input = page.getByLabel('Board name')
		await expect(input).toBeFocused()
		await input.fill('Autumn shopping')
		await input.press('Enter')

		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText(
			'Autumn shopping'
		)

		// The rename is persisted, not just local to the tab strip.
		await backToList(page)
		await expect(page.locator('.lb-card', { hasText: 'Autumn shopping' })).toHaveCount(1)
	})

	test('renaming on the tab can be abandoned with Escape', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		await page.locator('.lb-tabs__tab--active .lb-tabs__label').dblclick()
		const input = page.getByLabel('Board name')
		await input.fill('Discard me')
		await input.press('Escape')

		await expect(page.locator('.lb-tabs__tab--active .lb-tabs__label')).toHaveText(
			'Home office shopping'
		)
	})

	test('an unopened board shows a placeholder rather than a broken image', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		// Created through the index without ever opening it, so it has no thumbnail.
		await page.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve) => {
				const req = indexedDB.open('lifeboard-kv')
				req.onsuccess = () => resolve(req.result)
			})
			const boards = await new Promise<{ id: string }[]>((resolve) => {
				const q = db.transaction('kv', 'readonly').objectStore('kv').get('boards')
				q.onsuccess = () => resolve(q.result ?? [])
			})
			const now = Date.now()
			await new Promise<void>((resolve) => {
				const tx = db.transaction('kv', 'readwrite')
				tx.objectStore('kv').put(
					[...boards, { id: 'never-opened', name: 'Untouched', createdAt: now, updatedAt: now }],
					'boards'
				)
				tx.oncomplete = () => resolve()
			})
			db.close()
		})
		await page.reload()

		const card = page.locator('.lb-card', { hasText: 'Untouched' })
		await expect(card.locator('.lb-card__placeholder')).toBeVisible()
		await expect(card.locator('.lb-card__image')).toHaveCount(0)
	})

	test('deleting a board also removes its thumbnail', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const card = page.locator('.lb-card').first()
		await expect
			.poll(async () => card.locator('.lb-card__image').count(), { timeout: 15_000 })
			.toBe(1)
		await expect.poll(() => countThumbnails(page)).toBe(1)

		await card.hover()
		await card.getByRole('button', { name: 'Delete', exact: true }).click()
		await card.getByRole('button', { name: 'Delete for good' }).click()
		await expect(page.locator('.lb-card')).toHaveCount(0)

		// Left behind, the thumbnail would be an orphaned blob nothing can ever reach again.
		await expect.poll(() => countThumbnails(page)).toBe(0)
	})
})

test.describe('theme', () => {
	test('the toggle applies a theme, survives a reload, and re-themes the canvas', async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const html = page.locator('html')
		await page.getByRole('button', { name: 'Settings' }).click()

		await page.getByRole('button', { name: 'Light' }).click()
		await expect(html).toHaveAttribute('data-theme', 'light')

		// The preference has to outlive the tab, or the toggle is a per-session curiosity.
		await page.reload()
		await expect(html).toHaveAttribute('data-theme', 'light')

		// tldraw follows through its own user preference, not the `colorScheme` prop.
		await createBoard(page)
		await expect(page.locator('.tl-container.tl-theme__light')).toBeVisible()

		await backToList(page)
		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Dark', exact: true }).click()
		await expect(html).toHaveAttribute('data-theme', 'dark')
	})

	test('system follows the OS, without a reload', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const html = page.locator('html')
		// 'system' is the default, so the OS preference should already be showing.
		await expect(html).toHaveAttribute('data-theme', 'light')

		await page.emulateMedia({ colorScheme: 'dark' })
		await expect(html).toHaveAttribute('data-theme', 'dark')

		// Pinning a theme has to stop the app tracking the OS.
		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Light' }).click()
		await page.emulateMedia({ colorScheme: 'dark' })
		await expect(html).toHaveAttribute('data-theme', 'light')
	})

	test('switching theme re-exports open boards and drops the previews it cannot', async ({
		page,
	}) => {
		// Pinned so the switch below is a real change of the *resolved* theme: Playwright emulates a
		// light OS, so the default 'system' already resolves to light.
		await page.emulateMedia({ colorScheme: 'light' })
		await gotoFresh(page)
		// Leaves the demo board with a preview and its tab closed, so its editor is *not* mounted —
		// which is exactly the board that cannot be re-exported.
		await skipFirstRunDemo(page)
		await createBoard(page, 'Still open')

		await openBoard(page, 'Still open')
		await page.mouse.dblclick(560, 300)
		await page.locator(NOTE_EDITOR).fill('Something to preview')
		await backToList(page)

		await expect.poll(() => thumbnailSize(page, 'Still open')).toBeGreaterThan(2_000)
		await expect.poll(() => thumbnailSize(page, 'Home office shopping')).toBeGreaterThan(2_000)
		const before = await thumbnailSize(page, 'Still open')

		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Dark', exact: true }).click()

		// 'Still open' has a mounted (though hidden) editor, so it keeps a real preview, re-exported in
		// the new theme. Without `withExportableHost` this would silently be blank paper, which is why
		// the size floor matters as much as the inequality.
		await expect.poll(() => thumbnailSize(page, 'Still open')).not.toBe(before)
		expect(await thumbnailSize(page, 'Still open')).toBeGreaterThan(2_000)

		// The demo board has nothing to export from. Keeping its preview would show a light picture in
		// a dark well, so it goes back to the placeholder until next opened.
		await expect.poll(() => thumbnailSize(page, 'Home office shopping')).toBe(null)
	})

	test('re-picking the theme already showing keeps the thumbnails', async ({ page }) => {
		await page.emulateMedia({ colorScheme: 'light' })
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page)

		await page.mouse.dblclick(560, 300)
		await page.locator(NOTE_EDITOR).fill('Something to preview')
		await backToList(page)
		const before = await countThumbnails(page)
		expect(before).toBeGreaterThan(0)

		// 'system' already resolves to light here, so pinning light changes the stored preference but
		// not a single pixel — throwing away every preview for that would be gratuitous.
		await page.getByRole('button', { name: 'Settings' }).click()
		await page.getByRole('button', { name: 'Light' }).click()
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

		await expect.poll(() => countThumbnails(page)).toBe(before)
	})
})

test.describe('canvas grid', () => {
	/** Scoped to the visible board: inactive tabs keep their hidden editors, each with its own paper. */
	const ourPaper = (page: import('@playwright/test').Page) =>
		page.locator('.lb-board-host:not([data-hidden]) .lb-paper')
	const nativeGrid = (page: import('@playwright/test').Page) =>
		page.locator('.lb-board-host:not([data-hidden]) .tl-grid')

	/** Evaluated whole, in-page: the editor itself cannot cross the serialisation boundary. */
	const gridMode = (page: import('@playwright/test').Page) =>
		page.evaluate(
			() =>
				(
					window as unknown as { editor: { getInstanceState(): { isGridMode?: boolean } } }
				).editor.getInstanceState().isGridMode === true
		)

	async function openSettings(page: import('@playwright/test').Page) {
		await backToList(page)
		await page.getByRole('button', { name: 'Settings' }).click()
	}
	async function openDemoBoard(page: import('@playwright/test').Page) {
		await page.getByRole('tab', { name: /Home office/ }).click()
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
	}

	test('defaults to our grid, with snapping off', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		await expect(ourPaper(page)).toHaveCount(1)
		await expect(nativeGrid(page)).toHaveCount(0)
		expect(await gridMode(page)).toBe(false)
	})

	test('every open tab paints its own grid, not the first one it finds', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		// Three boards open at once. The shell keeps an editor mounted per tab, so all three papers share
		// one document — which is what made the SVG pattern ids collide.
		for (let i = 0; i < 2; i++) {
			await backToList(page)
			await page.getByRole('button', { name: 'New board' }).first().click()
			await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		}

		expect(await page.locator('.lb-paper').count()).toBeGreaterThanOrEqual(3)

		// Ids must be unique. A duplicate resolves to whichever copy is first in document order — and
		// since inactive boards are `visibility: hidden`, its dots paint nothing, so the visible board
		// silently loses its grid.
		const ids = await page
			.locator('pattern[id*="lb-paper-dots"]')
			.evaluateAll((els) => els.map((el) => el.id))
		expect(ids.length).toBeGreaterThan(0)
		expect(new Set(ids).size).toBe(ids.length)

		// And each tab in turn must resolve to a pattern inside its *own* svg, with dots actually painted.
		const tabs = await page.getByRole('tab').all()
		for (let i = 1; i < tabs.length; i++) {
			await tabs[i]!.click()
			await expect(page.locator('.tl-canvas:visible')).toBeVisible()
			const result = await page.evaluate(() => {
				const svg = document.querySelector('.lb-board-host:not([data-hidden]) .lb-paper')
				const ref = svg
					?.querySelector('rect')
					?.getAttribute('fill')
					?.match(/#(.+)\)/)?.[1]
				const target = ref ? document.getElementById(ref) : null
				const circle = target?.querySelector('circle')
				return {
					ownPattern: target ? svg!.contains(target) : false,
					visibility: circle ? getComputedStyle(circle).visibility : null,
				}
			})
			expect(result.ownPattern).toBe(true)
			expect(result.visibility).toBe('visible')
		}
	})

	test('grid style, grid visibility and snapping are independent, and persist', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		// Switching to tldraw's grid must not switch snapping on with it — that coupling is the whole
		// reason the grid is drawn from the Background slot rather than tldraw's own.
		await openSettings(page)
		await page.getByRole('button', { name: 'tldraw', exact: true }).click()
		await openDemoBoard(page)
		await expect(nativeGrid(page)).toHaveCount(1)
		await expect(ourPaper(page)).toHaveCount(0)
		expect(await gridMode(page)).toBe(false)

		// And snapping must not draw a second grid on top of the one already showing.
		await openSettings(page)
		await page.getByLabel('Snap to grid').check()
		await openDemoBoard(page)
		await expect(nativeGrid(page)).toHaveCount(1)
		expect(await gridMode(page)).toBe(true)

		// Hiding the grid leaves snapping alone.
		await openSettings(page)
		await page.getByLabel('Grid', { exact: true }).uncheck()
		await openDemoBoard(page)
		await expect(ourPaper(page)).toHaveCount(0)
		await expect(nativeGrid(page)).toHaveCount(0)
		expect(await gridMode(page)).toBe(true)

		// All three are app-wide preferences, so they outlive the tab — unlike tldraw's own per-board
		// flag, which is what let one board end up with a grid the others did not have.
		await page.reload()
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()
		await expect(ourPaper(page)).toHaveCount(0)
		await expect(nativeGrid(page)).toHaveCount(0)
		expect(await gridMode(page)).toBe(true)
	})

	test('snapping actually snaps a drag to the grid', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas:visible')).toBeVisible()

		// A plain geo shape drags predictably; a node card's body handles its own text.
		const id = await page.evaluate(() => {
			const ed = (window as unknown as { editor: EditorLike }).editor
			const before = new Set(ed.getCurrentPageShapes().map((s) => s.id))
			ed.createShapes([
				{ type: 'geo', x: 1400, y: 1400, props: { w: 100, h: 100, geo: 'rectangle', fill: 'solid' } },
			])
			ed.setCamera({ x: -1300, y: -1300, z: 1 })
			return ed.getCurrentPageShapes().find((s) => !before.has(s.id))!.id
		})

		const dragBy = async (dx: number) => {
			const p = await page.evaluate((shapeId) => {
				const ed = (window as unknown as { editor: EditorLike }).editor
				ed.select(shapeId)
				const b = ed.getShapePageBounds(shapeId)!
				return ed.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
			}, id)
			await page.mouse.move(p.x, p.y)
			await page.mouse.down()
			await page.mouse.move(p.x + dx, p.y, { steps: 10 })
			await page.mouse.up()
		}

		const shapeX = () =>
			page.evaluate(
				(shapeId) =>
					(window as unknown as { editor: { getShape(id: string): { x: number } } }).editor.getShape(
						shapeId
					).x,
				id
			)

		// 23px is deliberately not a multiple of the 10px grid step.
		await dragBy(23)
		const free = await shapeX()
		expect(free % 10).not.toBe(0)

		await openSettings(page)
		await page.getByLabel('Snap to grid').check()
		await openDemoBoard(page)

		await dragBy(23)
		const snapped = await shapeX()
		expect(snapped).not.toBe(free)
		expect(snapped % 10).toBe(0)
	})
})

// --- helpers ---------------------------------------------------------------

async function countByType(page: import('@playwright/test').Page, type: string): Promise<number> {
	return page.evaluate(
		(t) =>
			(window as unknown as { editor: EditorLike }).editor
				.getCurrentPageShapes()
				.filter((s) => s.type === t).length,
		type
	)
}

/** The dot pattern's first circle offset, which encodes the camera position. */
async function firstDotOffset(page: import('@playwright/test').Page): Promise<string> {
	return page
		.locator('.lb-paper circle')
		.first()
		.getAttribute('cx')
		.then((v) => v ?? '')
}

/** Sizes of every stored thumbnail, sorted — a cheap fingerprint for "did these change?". */
async function thumbnailBytes(page: import('@playwright/test').Page): Promise<number[]> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('lifeboard-kv')
			req.onsuccess = () => resolve(req.result)
		})
		const store = () => db.transaction('kv', 'readonly').objectStore('kv')
		const keys = await new Promise<IDBValidKey[]>((resolve) => {
			const q = store().getAllKeys()
			q.onsuccess = () => resolve(q.result)
		})
		const sizes: number[] = []
		for (const key of keys.filter((k) => String(k).startsWith('thumb:'))) {
			const blob = await new Promise<Blob | undefined>((resolve) => {
				const q = store().get(key)
				q.onsuccess = () => resolve(q.result)
			})
			sizes.push(blob?.size ?? 0)
		}
		db.close()
		return sizes.sort((a, b) => a - b)
	})
}

/** Byte size of one board's stored thumbnail, by board name, or null if it has none. */
async function thumbnailSize(
	page: import('@playwright/test').Page,
	boardName: string
): Promise<number | null> {
	return page.evaluate(async (name) => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('lifeboard-kv')
			req.onsuccess = () => resolve(req.result)
		})
		const read = <T>(key: string) =>
			new Promise<T | undefined>((resolve) => {
				const q = db.transaction('kv', 'readonly').objectStore('kv').get(key)
				q.onsuccess = () => resolve(q.result)
			})
		const boards = (await read<{ id: string; name: string }[]>('boards')) ?? []
		const board = boards.find((b) => b.name === name)
		if (!board) {
			db.close()
			return null
		}
		const blob = await read<Blob>(`thumb:${board.id}`)
		db.close()
		return blob instanceof Blob ? blob.size : null
	}, boardName)
}

async function countThumbnails(page: import('@playwright/test').Page): Promise<number> {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve) => {
			const req = indexedDB.open('lifeboard-kv')
			req.onsuccess = () => resolve(req.result)
		})
		const keys = await new Promise<IDBValidKey[]>((resolve) => {
			const q = db.transaction('kv', 'readonly').objectStore('kv').getAllKeys()
			q.onsuccess = () => resolve(q.result)
		})
		db.close()
		return keys.filter((k) => String(k).startsWith('thumb:')).length
	})
}

interface EditorLike {
	getCurrentPageShapes(): { id: string; type: string; props: Record<string, unknown> }[]
	getShapePageBounds(id: string): { x: number; y: number; w: number; h: number } | undefined
	pageToScreen(p: { x: number; y: number }): { x: number; y: number }
	getEditingShapeId(): string | null
	setCamera(c: { x: number; y: number; z: number }): unknown
	createShapes(s: unknown[]): unknown
	select(...ids: string[]): unknown
	getSelectedShapeIds(): string[]
	getCurrentToolId(): string
}
