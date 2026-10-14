import type { Editor, TLShape } from '@lifeboard/canvas'
import {
	SLOTS,
	readPropertyLayout,
	setPropertyLayout,
	type CardWidth,
	type LayoutElement,
	type LayoutRow,
	type PropertyLayout,
	type RowAlign,
	type Slot,
} from './layout'
import type { ShapeWithMeta } from './values'

/**
 * The edits the Display tab makes to a layout, as pure functions: each takes a layout and returns a
 * new one, so the panel stays a thin view and every rule here is testable without a board.
 */

/** Where an element sits: which row, which slot, which position in the slot. */
export interface ElementPath {
	row: number
	slot: Slot
	index: number
}

function withRows(layout: PropertyLayout, rows: LayoutRow[]): PropertyLayout {
	return { ...layout, rows }
}

export function setWidth(layout: PropertyLayout, width: CardWidth | undefined): PropertyLayout {
	const next = { ...layout }
	if (width === undefined) delete next.width
	else next.width = width
	return next
}

export function addRow(layout: PropertyLayout, row: LayoutRow = {}): PropertyLayout {
	return withRows(layout, [...layout.rows, row])
}

export function removeRow(layout: PropertyLayout, index: number): PropertyLayout {
	return withRows(
		layout,
		layout.rows.filter((_, i) => i !== index)
	)
}

/** Moves a row up (-1) or down (+1); out of range is a no-op. */
export function moveRow(layout: PropertyLayout, index: number, by: -1 | 1): PropertyLayout {
	const to = index + by
	if (to < 0 || to >= layout.rows.length) return layout
	const rows = [...layout.rows]
	const [row] = rows.splice(index, 1)
	rows.splice(to, 0, row!)
	return withRows(layout, rows)
}

export function setRowAlign(layout: PropertyLayout, index: number, align: RowAlign): PropertyLayout {
	return withRows(
		layout,
		layout.rows.map((row, i) => {
			if (i !== index) return row
			const next = { ...row }
			// Middle is the default, so it isn't stored.
			if (align === 'middle') delete next.align
			else next.align = align
			return next
		})
	)
}

function setSlot(row: LayoutRow, slot: Slot, elements: LayoutElement[]): LayoutRow {
	const next = { ...row }
	if (elements.length) next[slot] = elements
	else delete next[slot]
	return next
}

export function addElement(
	layout: PropertyLayout,
	row: number,
	slot: Slot,
	element: LayoutElement
): PropertyLayout {
	return withRows(
		layout,
		layout.rows.map((r, i) => (i === row ? setSlot(r, slot, [...(r[slot] ?? []), element]) : r))
	)
}

export function elementAt(layout: PropertyLayout, path: ElementPath): LayoutElement | undefined {
	return layout.rows[path.row]?.[path.slot]?.[path.index]
}

/** Replaces one element. The patch is the whole element, so clearing a field is just leaving it out. */
export function replaceElement(layout: PropertyLayout, path: ElementPath, element: LayoutElement): PropertyLayout {
	return withRows(
		layout,
		layout.rows.map((r, i) => {
			if (i !== path.row) return r
			const elements = [...(r[path.slot] ?? [])]
			if (path.index >= elements.length) return r
			elements[path.index] = element
			return setSlot(r, path.slot, elements)
		})
	)
}

export function removeElement(layout: PropertyLayout, path: ElementPath): PropertyLayout {
	return withRows(
		layout,
		layout.rows.map((r, i) =>
			i === path.row ? setSlot(r, path.slot, (r[path.slot] ?? []).filter((_, j) => j !== path.index)) : r
		)
	)
}

/**
 * Moves an element to another place: another slot, another row, or along its own slot. `to.index` is
 * where it lands in the destination as it reads *after* the element has been taken out, clamped to
 * the end.
 */
export function moveElement(layout: PropertyLayout, from: ElementPath, to: ElementPath): PropertyLayout {
	const element = elementAt(layout, from)
	if (!element || !layout.rows[to.row]) return layout
	const removed = removeElement(layout, from)
	return withRows(
		removed,
		removed.rows.map((r, i) => {
			if (i !== to.row) return r
			const elements = [...(r[to.slot] ?? [])]
			elements.splice(Math.min(to.index, elements.length), 0, element)
			return setSlot(r, to.slot, elements)
		})
	)
}

/** Every element with its path, in reading order. */
export function elementsOf(layout: PropertyLayout): { path: ElementPath; element: LayoutElement }[] {
	return layout.rows.flatMap((row, r) =>
		SLOTS.flatMap((slot) => (row[slot] ?? []).map((element, index) => ({ path: { row: r, slot, index }, element })))
	)
}

/** Whether every shape has the same layout (or every one has none), so one edit can go to all. */
export function layoutsMatch(shapes: readonly ShapeWithMeta[]): boolean {
	if (shapes.length < 2) return true
	const first = JSON.stringify(readPropertyLayout(shapes[0]!))
	return shapes.every((shape) => JSON.stringify(readPropertyLayout(shape)) === first)
}

/** Writes one layout (or `null` for automatic) to several shapes, as one undo step. */
export function setPropertyLayouts(editor: Editor, shapes: readonly TLShape[], layout: PropertyLayout | null): void {
	editor.run(() => {
		for (const shape of shapes) setPropertyLayout(editor, shape, layout)
	})
}
