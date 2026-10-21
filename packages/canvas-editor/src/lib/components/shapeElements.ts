import type { TLShapeId } from '@tldraw/tlschema'
import type { Editor } from '../editor/Editor'

/**
 * Each mounted shape's container element, by id, kept by `Shape` as it mounts and unmounts. Finding
 * one with `querySelector` walks the whole page; on a big board, doing that for every shape cost more
 * than everything else opening it did.
 */
const byEditor = new WeakMap<Editor, Map<TLShapeId, HTMLElement>>()

function elements(editor: Editor) {
	let map = byEditor.get(editor)
	if (!map) byEditor.set(editor, (map = new Map()))
	return map
}

/** A mounted shape's container (not its background's), or undefined if it isn't mounted. */
export function getShapeElement(editor: Editor, id: TLShapeId): HTMLElement | undefined {
	return byEditor.get(editor)?.get(id)
}

/** @internal */
export function setShapeElement(editor: Editor, id: TLShapeId, el: HTMLElement | null) {
	if (el) elements(editor).set(id, el)
	else byEditor.get(editor)?.delete(id)
}
