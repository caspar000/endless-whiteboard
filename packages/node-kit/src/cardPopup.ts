import { atom, type Editor } from '@lifeboard/canvas'
import { useEffect } from 'react'

/**
 * A menu that opens over a card: a ranking's tier menu, a randomizer's stamps (DARK-13).
 *
 * A node is clipped to its box while it isn't being edited (`registry.tsx`), so its corners stay
 * round and nothing it draws strays over the board. A menu near its bottom edge was clipped with it,
 * cut off half-way down. While a card says a menu is open, the factory lets it draw past its box and
 * lifts it over the shapes around it, and the GPU layer leaves it to the page.
 */

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
		return () => {
			setOpen(shapeId, false)
			editor.deleteOpenMenu(menuId)
		}
	}, [editor, shapeId, isOpen])
}
