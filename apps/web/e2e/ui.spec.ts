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
		await expect(page.locator('.lb-note--editing')).toBeVisible()
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
		await expect(page.locator('.lb-md__body h1')).toHaveText('Chores')
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
		await expect(page.locator('.lb-md__body input[type=checkbox]')).toHaveCount(3)
		await expect(page.locator('.lb-md__body ol li')).toHaveCount(2)
		await expect(page.locator('.lb-md__body ul strong')).toHaveCount(0)
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
		const task = page.locator('.lb-md__body li.task-list-item')
		const plain = page.locator('.lb-md__body li:not(.task-list-item)')
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

		const boxes = page.locator('.lb-md__task')
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
		await expect(page.locator('.lb-md__task')).toHaveCount(3)
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
		await expect(page.locator('.lb-md__body ul strong')).toHaveCount(0)
		await expect(page.locator('.lb-md__body > p strong')).toHaveText('Budget:')
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
		await expect(page.locator('.lb-md__body h1')).toHaveText('Chores')

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
		await expect(page.locator('.lb-md__body h1')).toHaveText('Existing note!')
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
		await expect(page.locator('.lb-strip').first()).toBeVisible()

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

	test('the canvas has dotted paper and no style panel', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

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
	test('shows a sidebar with live counts and filters the grid', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Second board')

		const sidebar = page.locator('.lb-sidebar')
		await expect(sidebar.getByRole('button', { name: /All boards 2/ })).toBeVisible()
		await expect(sidebar.getByRole('button', { name: /Favourites 0/ })).toBeVisible()
		await expect(page.locator('.lb-card')).toHaveCount(2)

		// Favourites is empty until something is starred, and then contains exactly that board.
		await sidebar.getByRole('button', { name: /Favourites/ }).click()
		await expect(page.locator('.lb-card')).toHaveCount(0)
		await expect(page.getByText('No favourites yet.')).toBeVisible()

		await sidebar.getByRole('button', { name: /All boards/ }).click()
		const card = page.locator('.lb-card', { hasText: 'Second board' })
		await card.hover()
		await card.getByRole('button', { name: 'Favourite Second board' }).click()

		await expect(sidebar.getByRole('button', { name: /Favourites 1/ })).toBeVisible()
		await sidebar.getByRole('button', { name: /Favourites/ }).click()
		await expect(page.locator('.lb-card')).toHaveCount(1)
		await expect(page.locator('.lb-card', { hasText: 'Second board' })).toHaveCount(1)
	})

	test('favourite state survives a reload', async ({ page }) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)

		const card = page.locator('.lb-card').first()
		await card.hover()
		await card.getByRole('button', { name: /^Favourite / }).click()
		await expect(
			page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })
		).toBeVisible()

		await page.reload()
		await expect(
			page.locator('.lb-sidebar').getByRole('button', { name: /Favourites 1/ })
		).toBeVisible()
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
		await expect(page.locator('.lb-md')).toHaveCount(1)
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

	test('the board title can be renamed by double-clicking it on the canvas', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		const title = page.locator('.lb-board__name')
		await expect(title).toHaveText('Home office shopping')
		await title.dblclick()

		const input = page.getByLabel('Board name')
		await expect(input).toBeFocused()
		await input.fill('Autumn shopping')
		await input.press('Enter')

		await expect(page.locator('.lb-board__name')).toHaveText('Autumn shopping')

		// The rename is persisted, not just local to the chrome.
		await backToList(page)
		await expect(page.locator('.lb-card', { hasText: 'Autumn shopping' })).toHaveCount(1)
	})

	test('renaming on the canvas can be abandoned with Escape', async ({ page }) => {
		await gotoFresh(page)
		await expect(page.locator('.tl-canvas')).toBeVisible()

		await page.locator('.lb-board__name').dblclick()
		const input = page.getByLabel('Board name')
		await input.fill('Discard me')
		await input.press('Escape')

		await expect(page.locator('.lb-board__name')).toHaveText('Home office shopping')
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
}
