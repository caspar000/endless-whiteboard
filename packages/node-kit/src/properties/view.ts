import { atom, type Editor, type TLShapeId, type TLShapePartial } from '@lifeboard/canvas'
import { isChoiceType, isListType, type PropertyDef, type PropertyValue } from './types'
import type { ShapeWithMeta } from './values'

/**
 * How a shape's property card reads: `display` (the designed card) or `source` (every property as a
 * labelled row). Per shape, and absent means `display`, so no existing board has to be written to.
 * See docs/property-display-plan.md.
 */
export type PropertyView = 'display' | 'source'

const VIEW_KEY = 'lifeboard:propView'

export function readPropertyView(shape: ShapeWithMeta): PropertyView {
	return shape.meta[VIEW_KEY] === 'source' ? 'source' : 'display'
}

/** Sets the view on several shapes in one undo entry. `display` writes `null` rather than the default. */
export function setPropertyView(editor: Editor, ids: readonly TLShapeId[], view: PropertyView): void {
	const patches: TLShapePartial[] = []
	for (const id of ids) {
		const shape = editor.getShape(id)
		if (!shape || readPropertyView(shape) === view) continue
		patches.push({
			id,
			type: shape.type,
			meta: { [VIEW_KEY]: view === 'source' ? 'source' : null },
		} as TLShapePartial)
	}
	if (patches.length) editor.run(() => editor.updateShapes(patches))
}

/**
 * The view a toggle should switch the selection to: `source` unless every shape is already showing it.
 * One command rather than two, the way the relation eye works.
 */
export function nextPropertyView(shapes: readonly ShapeWithMeta[]): PropertyView {
	return shapes.length && shapes.every((s) => readPropertyView(s) === 'source') ? 'display' : 'source'
}

/**
 * Flips the selection between source and display, and returns the view it switched to (or `null` with
 * nothing selected). The one implementation behind ⌘K, the shortcut and the context menu.
 */
export function togglePropertyView(editor: Editor): PropertyView | null {
	const shapes = editor.getSelectedShapes()
	if (!shapes.length) return null
	const view = nextPropertyView(shapes)
	setPropertyView(
		editor,
		shapes.map((s) => s.id),
		view
	)
	return view
}

/**
 * The role a property plays in the automatic layout, which is what display mode shows until a node has
 * a layout of its own.
 */
export type AutoRole = 'badge' | 'meta' | 'chips' | 'bar'

export function autoRoleFor(def: PropertyDef): AutoRole {
	if (isListType(def.type)) return 'chips'
	if (isChoiceType(def.type)) return 'badge'
	if (def.type === 'progress') return 'bar'
	return 'meta'
}

/** Whether a value counts as nothing, for hiding it in display mode. An unticked checkbox is empty. */
export function isEmptyPropertyValue(value: PropertyValue | undefined): boolean {
	if (value === null || value === undefined || value === '' || value === false) return true
	return Array.isArray(value) && value.length === 0
}

/**
 * Groups visible properties by role, groups ordered by where their first member sits in the panel.
 *
 * One badge row, one meta line, one chip row and the bars, rather than one line per property: the
 * automatic layout is a summary, and the panel order still decides which group leads.
 */
export function autoLayoutGroups<T extends { def: PropertyDef }>(
	rows: readonly T[]
): { role: AutoRole; rows: T[] }[] {
	const groups = new Map<AutoRole, T[]>()
	for (const row of rows) {
		const role = autoRoleFor(row.def)
		const group = groups.get(role)
		if (group) group.push(row)
		else groups.set(role, [row])
	}
	return [...groups].map(([role, members]) => ({ role, rows: members }))
}

/**
 * The property card's gap below its node, in page units. The card's own CSS and the lane layouts both
 * read it, so a stacked node and its card never overlap the next node down.
 */
export const PROPERTY_CARD_GAP = 6

/**
 * How tall each shape's property card is, measured by the card itself.
 *
 * A signal rather than store state: it is derived from the DOM, it must not sync or cost an undo
 * entry, and kanban and calendar placement read it reactively so a card that grows pushes the next
 * node down.
 */
const cardHeights = atom<ReadonlyMap<string, number>>('lifeboard:property-card-heights', new Map())

export function setPropertyCardHeight(id: string, height: number | null): void {
	const current = cardHeights.get()
	if (height === null ? !current.has(id) : current.get(id) === height) return
	const next = new Map(current)
	if (height === null) next.delete(id)
	else next.set(id, height)
	cardHeights.set(next)
}

/** The room a shape's card takes below it, gap included, or 0 when it has none. */
export function propertyCardSpace(id: string): number {
	const height = cardHeights.get().get(id)
	return height ? height + PROPERTY_CARD_GAP : 0
}
