import { Box2d, Editor, TLShape, Vec2d } from '@lifeboard/canvas-editor'

/**
 * Getting around the board without a pointer (docs/fork-parity.md A1): Tab and Shift+Tab step through
 * the shapes in reading order, ⌘/Ctrl+arrow jumps to the nearest shape that way, and Alt+Shift+arrow
 * resizes the selection. The view follows a selection that leaves the screen.
 */

/** What keyboard navigation steps between: shapes you could click on their own. */
function navigableShapes(editor: Editor): { shape: TLShape; bounds: Box2d }[] {
	const pageId = editor.getCurrentPageId()
	return editor
		.getCurrentPageShapes()
		.filter((shape) => {
			const parent = editor.getShape(shape.parentId)
			// On the page, or in a frame; a group's children are reached through the group.
			const reachable = shape.parentId === pageId || (parent && parent.type === 'frame')
			return reachable && !editor.isShapeOrAncestorLocked(shape) && !editor.isShapeHidden(shape)
		})
		.flatMap((shape) => {
			const bounds = editor.getShapePageBounds(shape)
			return bounds ? [{ shape, bounds }] : []
		})
}

/** Shapes in reading order: rows from the top, each from the left. */
export function readingOrder(items: { shape: TLShape; bounds: Box2d }[]) {
	const byTop = [...items].sort((a, b) => a.bounds.minY - b.bounds.minY || a.bounds.minX - b.bounds.minX)
	const rows: (typeof items)[] = []
	let rowEnd = -Infinity
	for (const item of byTop) {
		// A shape starting above the middle of the row's first shape belongs to that row.
		if (item.bounds.minY < rowEnd && rows.length) rows[rows.length - 1]!.push(item)
		else {
			rows.push([item])
			rowEnd = item.bounds.minY + item.bounds.height / 2
		}
	}
	return rows.flatMap((row) => row.sort((a, b) => a.bounds.minX - b.bounds.minX))
}

/** Selects the next shape in reading order, or the previous one with `step` -1. Wraps around. */
export function selectNextShape(editor: Editor, step: 1 | -1): boolean {
	const order = readingOrder(navigableShapes(editor))
	if (!order.length) return false
	const selected = editor.getSelectedShapeIds()
	const at = order.findIndex((item) => item.shape.id === selected[selected.length - 1])
	const next =
		at === -1 ? (step === 1 ? order[0]! : order[order.length - 1]!) : order[(at + step + order.length) % order.length]!
	select(editor, next.shape, next.bounds)
	return true
}

/**
 * Selects the nearest shape in a direction from the selection: ahead of it, and favouring the ones
 * straight ahead over the ones off to the side.
 */
export function selectShapeInDirection(editor: Editor, direction: { x: number; y: number }): boolean {
	const from = editor.getSelectionPageBounds()
	const items = navigableShapes(editor)
	if (!from) return selectNextShape(editor, 1)
	const selected = new Set(editor.getSelectedShapeIds())
	const centre = from.center
	let best: { item: (typeof items)[number]; score: number } | undefined
	for (const item of items) {
		if (selected.has(item.shape.id)) continue
		const offset = Vec2d.Sub(item.bounds.center, centre)
		const ahead = offset.x * direction.x + offset.y * direction.y
		const aside = Math.abs(offset.x * direction.y - offset.y * direction.x)
		// Within about 63° of straight ahead.
		if (ahead <= 0 || aside > ahead * 2) continue
		const score = ahead + aside * 2
		if (!best || score < best.score) best = { item, score }
	}
	if (!best) return false
	select(editor, best.item.shape, best.item.bounds)
	return true
}

/**
 * Grows or shrinks the selected shapes from their top-left corner: right and down grow, left and up
 * shrink, a step at a time (the grid's when it is on).
 */
export function resizeSelectionByKeyboard(editor: Editor, direction: { x: number; y: number }, mark: boolean) {
	const shapes = editor.getSelectedShapes().filter((shape) => !editor.isShapeOrAncestorLocked(shape))
	if (!shapes.length) return
	const step = editor.getInstanceState().isGridMode ? editor.getDocumentSettings().gridSize : 10
	if (mark) editor.mark('resize with keyboard')
	editor.batch(() => {
		for (const shape of shapes) {
			const bounds = editor.getShapePageBounds(shape)
			if (!bounds) continue
			const width = Math.max(1, bounds.width + direction.x * step)
			const height = Math.max(1, bounds.height + direction.y * step)
			editor.resizeShape(
				shape.id,
				{ x: width / Math.max(1, bounds.width), y: height / Math.max(1, bounds.height) },
				{ scaleOrigin: bounds.point, scaleAxisRotation: 0 }
			)
		}
	})
}

function select(editor: Editor, shape: TLShape, bounds: Box2d) {
	editor.mark('select with keyboard')
	editor.select(shape.id)
	// The view follows a selection that has left it.
	if (!editor.getViewportPageBounds().contains(bounds)) {
		editor.centerOnPoint(bounds.center, { duration: 200 })
	}
}

/**
 * Out a level (docs/fork-parity.md I8): the frames and groups the selected shapes are in. Shapes on
 * the page itself stay as they are.
 */
export function selectContainers(editor: Editor): void {
	const pageId = editor.getCurrentPageId()
	const containers = new Set(
		editor.getSelectedShapes().map((shape) => (shape.parentId === pageId ? shape.id : shape.parentId))
	)
	const ids = [...containers].filter((id) => id !== pageId) as TLShape['id'][]
	if (ids.length) editor.setSelectedShapes(ids)
}

/** The page before (`-1`) or after (`1`) this one, if there is one. */
export function goToPage(editor: Editor, step: number): void {
	const pages = editor.getPages()
	const at = pages.findIndex((page) => page.id === editor.getCurrentPageId())
	const next = pages[at + step]
	if (next) editor.setCurrentPage(next.id)
}
