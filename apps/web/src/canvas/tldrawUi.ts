import type { Editor, TLUiActionsContextType, TLUiToolsContextType } from 'tldraw'

/**
 * tldraw's own actions and tools, reachable from outside its React context.
 *
 * The keymap made this necessary and it fixes an older mistake at the same time. `edit.duplicate`
 * used to be `editor.duplicateShapes(selectedIds)` — while tldraw's ⌘D computes a side-by-side
 * offset (or the adjacent-shape margin when the camera is locked), marks a history stopping point,
 * and keeps `duplicateProps` so a held ⌘D walks copies across the board. So "Duplicate" in the
 * palette has never done what ⌘D does; `edit.delete` was likewise missing tldraw's history mark and
 * its can-I-apply-this guards.
 *
 * Reimplementing those faithfully would mean copying twenty-odd lines of tldraw's internals and
 * re-copying them on every upgrade. Delegating means there is one implementation and the palette,
 * the keymap and ⌘D are the same action by construction — which is the rule the command registry
 * exists to enforce, applied to a table we do not own.
 *
 * Keyed by editor, not a single holder: hidden tabs keep their editors mounted, so several bridges
 * are published at once and "the last one to mount" would be an arbitrary background board. An
 * action closes over its own editor, so running the wrong one would act on the wrong board.
 */
const uiByEditor = new WeakMap<Editor, { actions: TLUiActionsContextType; tools: TLUiToolsContextType }>()

export function setTldrawUi(
	editor: Editor,
	ui: { actions: TLUiActionsContextType; tools: TLUiToolsContextType }
): void {
	uiByEditor.set(editor, ui)
}

/**
 * Runs one of tldraw's actions by id, reporting whether it existed.
 *
 * `'kbd'` as the source because that is what this is: every caller is a key or a palette row
 * standing in for one, and tldraw's own analytics should not have to guess.
 */
export function runTldrawAction(editor: Editor, id: string): boolean {
	const action = uiByEditor.get(editor)?.actions[id]
	if (!action) return false
	action.onSelect('kbd')
	return true
}

/**
 * Runs one of tldraw's tools by id. Delegated rather than `editor.setCurrentTool(id)` for a reason
 * worth keeping: the select tool's own `onSelect` first leaves edit mode, because editing is a
 * sub-state of select and a locked text tool would otherwise strand the caret there.
 */
export function runTldrawTool(editor: Editor, id: string): boolean {
	const tool = uiByEditor.get(editor)?.tools[id]
	if (!tool) return false
	tool.onSelect('kbd')
	return true
}
