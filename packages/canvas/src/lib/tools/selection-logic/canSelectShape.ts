import { Editor, TLShape } from '@lifeboard/canvas-editor'

/**
 * Whether a click or a brush may select the shape: anything not locked, and locked shapes too when
 * the person has asked for that (docs/fork-parity.md I10). Selected, a locked shape still doesn't
 * move or change; it can be copied, inspected and unlocked.
 */
export function canSelectShape(editor: Editor, shape: TLShape): boolean {
	return !editor.isShapeOrAncestorLocked(shape) || editor.user.getCanSelectLockedShapes()
}
