import { atom, react, type Atom, type Editor, type TLEventInfo } from '@lifeboard/canvas'
import { PHONE_QUERY } from '../app/usePhone'

/**
 * Hand first, on a phone (docs/mobile-plan.md). Moving around a board with a thumb kept changing it by
 * accident, so a phone opens every board in the hand tool, and the board changes only once you ask for
 * Select. The two share one dock button (`NavToggle` in PhoneDock.tsx); which of them you chose is
 * the board's *mode*, and the board goes back to it when you are done making something.
 */
export type NavMode = 'hand' | 'select'

const modes = new WeakMap<Editor, Atom<NavMode>>()

export const isPhone = (): boolean => window.matchMedia(PHONE_QUERY).matches

/** The mode the board goes back to: Hand unless you chose Select. */
export function navModeOf(editor: Editor): Atom<NavMode> {
	let mode = modes.get(editor)
	if (!mode) {
		mode = atom<NavMode>('lb:nav-mode', 'hand')
		modes.set(editor, mode)
	}
	return mode
}

/** Chooses Hand or Select, and goes to it. */
export function setNavMode(editor: Editor, mode: NavMode): void {
	navModeOf(editor).set(mode)
	editor.setCurrentTool(mode)
}

/**
 * Shapes whose editing is reading: double-tapped in Hand, they open, since reading changes nothing on
 * the board. Links need no rule; a tap on one reaches the link itself.
 */
const READ_BY_OPENING = new Set(['node.book'])

/**
 * Three rules, all only on a phone and only in Hand mode:
 *
 * - **Back to Hand once you are done.** Placing a sticky, a shape or a frame ends in the select tool
 *   (after the typing, for a sticky or text), which on a phone is exactly where a stray drag moves what
 *   you just made. In Hand mode, arriving there means going back to Hand.
 * - **A long press is the way in.** It opens the shape's menu, which switches to Select as it opens.
 *   Holding a finger still is never an accident, so it chooses Select mode, with the shape under the
 *   finger selected, rather than being undone by the rule above.
 * - **A double tap on a book opens it.** Reading is not changing. It goes through the select tool, as
 *   opening one always has, and closing the book brings you back to Hand by the first rule. Caught as
 *   the tap comes up, before the hand tool's own double tap (zoom in) settles.
 *
 * The first two run a microtask later: the menu opens in a batch that also changes the tool, and the
 * decision needs the whole of it.
 */
export function installPhoneMode(editor: Editor): () => void {
	if (isPhone()) editor.setCurrentTool('hand')
	const mode = navModeOf(editor)

	const onEvent = (info: TLEventInfo) => {
		if (info.type !== 'click' || info.name !== 'double_click' || info.phase !== 'up') return
		if (!isPhone() || editor.getCurrentToolId() !== 'hand') return
		const shape = editor.getShapeAtPoint(editor.inputs.currentPagePoint, { hitInside: true })
		if (!shape || !READ_BY_OPENING.has(shape.type)) return
		editor.setCurrentTool('select')
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
	}
	editor.on('event', onEvent)

	const stopRules = react('lb:phone-mode', () => {
		const path = editor.getPath()
		const menuOpen = editor.getOpenMenus().some((menu) => menu.startsWith('context menu'))
		if (!isPhone() || mode.get() !== 'hand') return
		if (menuOpen) {
			queueMicrotask(() => {
				mode.set('select')
				const point = editor.inputs.currentPagePoint
				const shape = editor.getShapeAtPoint(point, { hitInside: true, margin: 4 })
				if (shape && !editor.getSelectedShapeIds().includes(shape.id)) editor.select(shape.id)
			})
			return
		}
		if (path === 'select.idle') {
			queueMicrotask(() => {
				if (mode.get() === 'hand' && editor.getPath() === 'select.idle' && !editor.getOpenMenus().length) {
					editor.setCurrentTool('hand')
				}
			})
		}
	})
	return () => {
		editor.off('event', onEvent)
		stopRules()
	}
}
