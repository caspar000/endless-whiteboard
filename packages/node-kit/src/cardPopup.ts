import { atom, getGpuScene, type Editor } from '@lifeboard/canvas'
import { useEffect } from 'react'

/**
 * A menu that opens over a card: a ranking's tier menu, a randomizer's stamps (DARK-13).
 *
 * A node is clipped to its box while it isn't being edited (`registry.tsx`), so its corners stay
 * round and nothing it draws strays over the board. A menu near its bottom edge was clipped with it,
 * cut off half-way down. While a card says a menu is open, the factory lets it draw past its box and
 * lifts it over the shapes around it, and the GPU layer leaves it to the page, along with any shape
 * it could draw that the card or its menu overlaps (the layer lies over the page, so it would draw
 * that shape over the menu). A menu marks itself `data-card-popup` so its box is measured.
 */

export type Box = { x: number; y: number; w: number; h: number }

/** Per editor, what each card with a menu open covers, in page space. */
const lifted = new WeakMap<Editor, Map<string, Box[]>>()

/** The card's box and its open menus', in page space. */
function measure(editor: Editor, shapeId: string): Box[] {
	const boxes: Box[] = []
	const bounds = editor.getShapePageBounds(shapeId as never)
	if (bounds) boxes.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h })
	const el = typeof document === 'undefined' ? null : document.getElementById(shapeId)
	for (const menu of Array.from(el?.querySelectorAll<HTMLElement>('[data-card-popup]') ?? [])) {
		const r = menu.getBoundingClientRect()
		const a = editor.screenToPage({ x: r.left, y: r.top })
		const b = editor.screenToPage({ x: r.right, y: r.bottom })
		boxes.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y })
	}
	return boxes
}

/**
 * Keeps what a card with a menu open covers up to date for as long as it is open: measured every frame,
 * and published only when it changed. One menu swapped for another (a tier's options, then another
 * tier's), a menu that grows, or the card moving all change it without the menu ever closing. A frame's
 * measure is a few rectangles of one card's menus, and the scene hears only of a real change, so a
 * menu standing open costs next to nothing. Returns the stop, which publishes `null`.
 */
export function watchLifted(measureNow: () => Box[], publish: (boxes: Box[] | null) => void): () => void {
	let last = ''
	let frame = 0
	const tick = () => {
		const boxes = measureNow()
		const key = JSON.stringify(boxes)
		if (key !== last) {
			last = key
			publish(boxes)
		}
		frame = requestAnimationFrame(tick)
	}
	frame = requestAnimationFrame(tick)
	return () => {
		cancelAnimationFrame(frame)
		publish(null)
	}
}

/** Tells the GPU layer what a card with a menu open covers now, or (`null`) that it covers nothing. */
function setLifted(editor: Editor, shapeId: string, boxes: Box[] | null): void {
	const mine = lifted.get(editor) ?? new Map<string, Box[]>()
	lifted.set(editor, mine)
	if (boxes) mine.set(shapeId, boxes)
	else mine.delete(shapeId)
	getGpuScene(editor).lifted.set([...mine.values()].flat())
}

const open = atom<ReadonlySet<string>>('lifeboard:card-popups', new Set())

/** Whether a shape has a menu open over it. Read reactively. */
export function hasCardPopup(shapeId: string): boolean {
	return open.get().has(shapeId)
}

/** The editor's name for a card's open menu, so the board's own keys stand aside while it is up. */
export const cardPopupMenuId = (shapeId: string) => `lb-card-popup:${shapeId}`

/** Marks a shape's menu open or closed. Each call to open is matched by one to close. */
function setOpen(shapeId: string, on: boolean): void {
	const next = new Set(open.get())
	if (on) next.add(shapeId)
	else next.delete(shapeId)
	open.set(next)
}

/**
 * Says a menu is open over this card while `isOpen` is. Also tells the editor, as an open menu, so
 * its keys stand aside while the menu is up.
 */
export function useCardPopup(editor: Editor, shapeId: string, isOpen: boolean): void {
	useEffect(() => {
		if (!isOpen) return
		const menuId = cardPopupMenuId(shapeId)
		setOpen(shapeId, true)
		editor.addOpenMenu(menuId)
		// A stand-in editor (a test's) has no store and no GPU layer to tell.
		const stop = (editor as Partial<Editor>).store
			? watchLifted(
					() => measure(editor, shapeId),
					(boxes) => setLifted(editor, shapeId, boxes)
				)
			: () => {}
		return () => {
			stop()
			setOpen(shapeId, false)
			editor.deleteOpenMenu(menuId)
		}
	}, [editor, shapeId, isOpen])
}
