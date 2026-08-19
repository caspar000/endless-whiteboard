import type { Editor, TLShapeId, TLShapePartial } from 'tldraw'
import { readPropertyRegistry } from '../../../properties/schema'
import type { LayoutMode, TableNodeProps } from '../spec'
import { getViewDefinition } from './index'

/**
 * The minimum a switch needs, rather than `TLShape`.
 *
 * Both callers hold a different type for the same shape: the config panel has the structural
 * `NodeShape<TableNodeProps>` (whose `type` is `string`), while a command has tldraw's closed-union
 * `TLShape`. Neither is assignable to the other, so asking for only what is read is what lets both call
 * this without a cast — the same reasoning `ShapeWithMeta` is declared with in `properties/values.ts`.
 */
interface ViewShape {
	id: TLShapeId
	type: string
	props: object
}

/**
 * Switching a card's view — the one path, used by the config panel and the ⌘K commands alike.
 *
 * One function because switching is three writes that have to happen together, and a second copy of
 * them would drift the first time one was added to. Beyond the mode itself:
 *
 * - **A placing view turns `autoHeight` off**, because its height comes from the lanes it arranged
 *   rather than from the HTML it drew, and the placement pass is then the only writer (see
 *   `TableNodeProps.autoHeight` for what happens when both write).
 * - **A placing view is widened to fit its columns.** Column width is derived from the card's width, so
 *   a 360px card asked to hold seven days would give each of them fifty pixels and every card standing
 *   on one would overhang. The view itself says how wide (`defaultWidth`); only ever wider.
 * - **The view fills in what it needs to work.** A calendar switched onto a board with one date property
 *   groups by that date, by day; a kanban finds a status. A view that landed saying "group by something"
 *   would be correct and useless.
 * - **A placing view is sent to the back**, because its members are about to be positioned on top of
 *   it and a lane drawn over its own cards reads as the cards being behind glass. Once, here, rather
 *   than on every placement pass — reshuffling z-order sixty times a second would churn the index for
 *   no visible gain.
 */
export function setViewMode(editor: Editor, shape: ViewShape, mode: LayoutMode): void {
	// `w`/`h` are injected into every node's props by the factory, so they are there at runtime without
	// `TableNodeProps` declaring them (see `registry.tsx`).
	const props = shape.props as unknown as TableNodeProps & { w: number; h: number }
	if (props.layout.mode === mode) return

	const view = getViewDefinition(mode)
	const places = view?.placesMembers === true

	const next: Record<string, unknown> = {
		layout: { ...props.layout, mode },
		/*
		 * A `fills` view pins the measurement off, and the trigger is `fills` rather than `placesMembers`:
		 * such a view lays itself out against the card's *box*, so the box has to be a box. A calendar left
		 * measuring its own content collapsed to the height of its title strip and drew forty-two day cells
		 * one pixel tall — present in the DOM, invisible on screen, and impossible to drop on.
		 *
		 * Explicitly `true` on the way back out: absent means "on" (see `useAutoHeight`), but a table whose
		 * height stayed pinned after a trip through the kanban would look like it had forgotten how to fit
		 * its rows.
		 */
		autoHeight: view?.fills !== true,
	}
	/*
	 * The view says how wide it needs to be: three lanes, or seven days.
	 *
	 * Only ever wider — shrinking a card the user has sized is not a switch's business. Height is not
	 * set here at all, because a placing view works its own out from the cards it has arranged and writes
	 * it on the next pass; a minimum here would only be a number to fight with.
	 */
	const wanted = view?.defaultWidth?.(props)
	if (wanted !== undefined && props.w < wanted) next.w = wanted

	/*
	 * Whatever the view needs before it can draw — a date to make days from, a status to make lanes from.
	 *
	 * Part of this same write, so it is one undo entry: switching to a calendar and having it *work* is
	 * one action, and taking it back should not be two. The patch is merged over the settings above rather
	 * than under them, since a view asking for its own `layout` has just been handed the mode and is
	 * spreading it (see the calendar's `prepare`).
	 */
	const prepared = view?.prepare?.({ props, properties: readPropertyRegistry(editor) })
	if (prepared) {
		Object.assign(next, prepared)
		// The mode is ours to set, not the view's — a `layout` patch that spread stale props would undo it.
		if (prepared.layout) next.layout = { ...prepared.layout, mode }
	}

	editor.run(() => {
		editor.markHistoryStoppingPoint('table view')
		editor.updateShape({ id: shape.id, type: shape.type, props: next } as TLShapePartial)
		if (places) editor.sendToBack([shape.id])
	})
}
