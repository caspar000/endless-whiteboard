import { atom, type TLShapeId } from '@lifeboard/canvas'

/**
 * Which shapes' card layout is open in the YAML editor, if any (several when a matching selection is
 * edited together). A signal for the same reason as
 * `propertiesTarget`: the command and the context menu that open it can't reach the `Board` that
 * renders it. Cleared when a board unmounts.
 */
const target = atom<readonly TLShapeId[] | null>('lifeboard:layoutEditorTarget', null)

export function getLayoutEditorTarget(): readonly TLShapeId[] | null {
	return target.get()
}

export function openLayoutEditor(ids: readonly TLShapeId[]): void {
	target.set(ids.length ? ids : null)
}

export function closeLayoutEditor(): void {
	target.set(null)
}
