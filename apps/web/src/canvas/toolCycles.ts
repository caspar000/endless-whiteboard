import { ArrowShapeKindStyle, GeoShapeGeoStyle, atom, react, type Atom, type Editor } from '@lifeboard/canvas'
import { isPhone, setNavMode } from './phoneMode'
import { runTldrawTool } from './tldrawUi'

/**
 * Pressing a tool's key again, or clicking its dock button again, switches its kind: Select and Hand,
 * a sticky and a pinned note, the pen and the eraser, the kinds of arrow and of shape. One dock button
 * stands for each pair or set, with a mark in its corner (`CanvasToolbar.tsx`, `PhoneDock.tsx`).
 *
 * "Again" is "while that tool is on", at any pace: there is no double-press timing to learn, and a
 * second press of a tool that is already on did nothing before.
 */

/** The tools whose dock button cycles, for the mark in its corner. */
export const CYCLING_TOOLS = ['select', 'note', 'draw', 'arrow', 'geo'] as const

/** The shapes, in the order the settings row shows them and a press steps through them. */
export const GEO_CYCLE = ['rectangle', 'ellipse', 'diamond', 'triangle', 'hexagon', 'heart'] as const
const ARROW_CYCLE = ['arc', 'elbow'] as const

const NOTES = ['note', 'pinned-note']
const PENS = ['draw', 'highlight']

/** The kind each pair was last left on, so a tool comes back as you last used it. */
export interface LastKinds {
	note: string
	pen: string
}
const lastKinds = new WeakMap<Editor, Atom<LastKinds>>()

/** Reactive, so an idle dock button can show the kind it will come back with. */
export function lastKindsOf(editor: Editor): Atom<LastKinds> {
	let kinds = lastKinds.get(editor)
	if (!kinds) {
		kinds = atom<LastKinds>('lb:last-tool-kinds', { note: 'note', pen: 'draw' })
		lastKinds.set(editor, kinds)
	}
	return kinds
}
const last = (editor: Editor) => lastKindsOf(editor).get()

/** Remembers the note and pen kinds as they are chosen, however they were chosen. */
export function trackToolKinds(editor: Editor): () => void {
	return react('lb:tool-kinds', () => {
		const id = editor.getCurrentToolId()
		const kinds = lastKindsOf(editor)
		if (NOTES.includes(id) && kinds.get().note !== id) kinds.update((k) => ({ ...k, note: id }))
		if (PENS.includes(id) && kinds.get().pen !== id) kinds.update((k) => ({ ...k, pen: id }))
	})
}

/** Goes to Select or Hand. On a phone that is also the mode the board goes back to (phoneMode.ts). */
function navigate(editor: Editor, id: 'select' | 'hand') {
	if (isPhone()) setNavMode(editor, id)
	else runTldrawTool(editor, id)
}

function next<T extends string>(cycle: readonly T[], current: string): T {
	return cycle[(cycle.indexOf(current as T) + 1) % cycle.length]!
}

/**
 * What a press of tool `id` does: switch to it, or, when it is already on, to the next kind. `id` is
 * the tool a key or a button names: `select` and `hand` are each other's other kind, so are `draw`
 * and `eraser`.
 */
export function pressTool(editor: Editor, id: string): void {
	const current = editor.getCurrentToolId()
	switch (id) {
		case 'select':
		case 'hand':
			return navigate(editor, current === id ? (id === 'select' ? 'hand' : 'select') : id)
		case 'note':
			if (NOTES.includes(current)) return void runTldrawTool(editor, current === 'note' ? 'pinned-note' : 'note')
			return void runTldrawTool(editor, last(editor).note)
		case 'draw':
			return void runTldrawTool(editor, PENS.includes(current) ? 'eraser' : last(editor).pen)
		case 'eraser':
			return void runTldrawTool(editor, current === 'eraser' ? last(editor).pen : 'eraser')
		case 'arrow':
			if (current === 'arrow') {
				editor.setStyleForNextShapes(ArrowShapeKindStyle, next(ARROW_CYCLE, editor.getStyleForNextShape(ArrowShapeKindStyle)))
				return
			}
			return void runTldrawTool(editor, 'arrow')
		case 'geo':
			// The kind is a style for the next shape, not a tool of its own; tldraw's tools map has one
			// tool per kind, so the geo tool is chosen directly.
			if (current === 'geo') {
				editor.setStyleForNextShapes(GeoShapeGeoStyle, next(GEO_CYCLE, editor.getStyleForNextShape(GeoShapeGeoStyle)))
				return
			}
			editor.setCurrentTool('geo')
			return
		default:
			runTldrawTool(editor, id)
	}
}
