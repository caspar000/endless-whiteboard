import {
	createProperty,
	propertyIdFromName,
	readShapeProperties,
	setShapePropertyHidden,
	type PropertyValue,
} from '@lifeboard/node-kit'
import type { Editor, TLShape, TLShapeId } from '@lifeboard/canvas'
import { ITEM_KINDS } from './model'
import { MEDIA } from './templates'

/**
 * The facts about an item that are ordinary properties (docs/skill-tree-plan.md, "Items").
 *
 * Properties rather than props, so a table can filter by Kind, a kanban can lane by Done and the
 * calendar can lay the log out by Done at, with no code of ours. Ids are the deterministic slugs of
 * the names (`done_at`), which is what lets a pasted item's values land on the right property on
 * another board.
 */
export const PROPS = {
	done: { name: 'Done', type: 'checkbox' },
	doneAt: { name: 'Done at', type: 'date' },
	kind: { name: 'Kind', type: 'select', options: [...ITEM_KINDS] },
	medium: { name: 'Medium', type: 'select', options: [...MEDIA] },
	method: { name: 'Method', type: 'select', options: [] as string[] },
	evidenceOf: { name: 'Evidence of', type: 'text' },
} as const

export type PropKey = keyof typeof PROPS

export const PROP_ID: Record<PropKey, string> = Object.fromEntries(
	Object.entries(PROPS).map(([key, spec]) => [key, propertyIdFromName(spec.name)])
) as Record<PropKey, string>

/** Registers the properties on this board if they are missing. Idempotent and cheap. */
export function ensureProperties(editor: Editor, keys: readonly PropKey[]): void {
	for (const key of keys) {
		const spec = PROPS[key]
		createProperty(editor, {
			name: spec.name,
			type: spec.type,
			...('options' in spec && spec.options.length ? { options: [...spec.options] } : {}),
		})
	}
}

/**
 * Keeps properties the card already shows off the property card under it. A card with nothing left
 * to show isn't drawn, so an item doesn't say "Study · book" twice. Presentation only: the values stay
 * attached, editable in the panel and counted by every table, and the panel can show them again.
 */
export function hideOnCard(editor: Editor, shapeId: TLShapeId, keys: readonly PropKey[]): void {
	for (const key of keys) {
		const shape = editor.getShape(shapeId)
		if (shape) setShapePropertyHidden(editor, shape, PROP_ID[key], true)
	}
}

export function readProp(shape: TLShape, key: PropKey): PropertyValue | undefined {
	return readShapeProperties(shape)[PROP_ID[key]]
}

export function isDone(shape: TLShape): boolean {
	return readProp(shape, 'done') === true
}

export function readText(shape: TLShape, key: PropKey): string {
	const value = readProp(shape, key)
	return typeof value === 'string' ? value : ''
}
