import { atom, type TLShapeId } from '@lifeboard/canvas'

/**
 * Which shape's card layout is open in the YAML editor, if any. A signal for the same reason as
 * `propertiesTarget`: the command and the context menu that open it can't reach the `Board` that
 * renders it. Cleared when a board unmounts.
 */
const target = atom<TLShapeId | null>('lifeboard:layoutEditorTarget', null)

export function getLayoutEditorTarget(): TLShapeId | null {
	return target.get()
}

export function openLayoutEditor(id: TLShapeId): void {
	target.set(id)
}

export function closeLayoutEditor(): void {
	target.set(null)
}
