import { atom, type TLShapeId } from 'tldraw'

/**
 * Which shape's properties panel is open, if any.
 *
 * A signal rather than React state because the two things that *open* the panel — a context-menu entry
 * and a keyboard action — both live inside tldraw's own UI components, which are supplied as
 * module-scope overrides and so cannot receive props from the `Board` that renders the panel. A signal
 * is the seam both sides already have access to, and `Board` subscribes to it with `useValue`.
 *
 * Module-scope, so it must be cleared when a board unmounts — otherwise switching boards would try to
 * open a panel for a shape id that belongs to the board you just left.
 */
const target = atom<TLShapeId | null>('lifeboard:propertiesTarget', null)

export function getPropertiesTarget(): TLShapeId | null {
	return target.get()
}

export function openProperties(id: TLShapeId): void {
	target.set(id)
}

export function closeProperties(): void {
	target.set(null)
}
