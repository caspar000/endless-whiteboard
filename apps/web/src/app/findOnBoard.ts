import { getNodeDefinition, getPageFacts } from '@lifeboard/node-kit'
import type { Editor, TLShapeId } from 'tldraw'
import type { BoardShapeRef } from './paletteItems'

/**
 * The open board's shapes, named and ranked, for the palette's `@` mode.
 *
 * The half of find-on-board that needs the editor: naming a shape, knowing where it is, and knowing
 * which icon its type draws. `paletteItems.ts` takes it from here and stays pure.
 *
 * Labels come from `getPageFacts`, which is already the board's answer to "what is this thing
 * called" — one `shapeLabel` ladder (`properties/labels.ts`) covering our node types *and* tldraw's
 * own stickies, text, frames and images, truncated, and cached per editor so this is usually a read
 * rather than a walk. `readPageFacts` would recompute the lot and leave nothing behind, which is the
 * wrong trade for a list the user is about to filter keystroke by keystroke.
 */
export function readBoardShapes(editor: Editor): BoardShapeRef[] {
	const viewportCenter = editor.getViewportPageBounds().center
	const ranked: { ref: BoardShapeRef; distance: number }[] = []

	for (const [id, facts] of getPageFacts(editor).get()) {
		// An unlabelled shape — a bare rectangle, a drawn line — has nothing to match against and
		// nothing to show in a row. Dropped rather than listed blank.
		if (!facts.label) continue
		const bounds = editor.getShapePageBounds(id as TLShapeId)
		if (!bounds) continue
		const dx = bounds.center.x - viewportCenter.x
		const dy = bounds.center.y - viewportCenter.y
		const icon = getNodeDefinition(facts.type)?.toolbarIcon
		ranked.push({
			ref: { id: id as TLShapeId, type: facts.type, label: facts.label, ...(icon ? { icon } : {}) },
			// Squared: the ordering is identical and it saves a square root per shape on a board that
			// may hold thousands.
			distance: dx * dx + dy * dy,
		})
	}

	// Nearest the middle of the view first, which is the useful answer to a bare `@` ("what is around
	// me") and a reasonable tie-break once something has been typed. Page order — the store's
	// insertion order — would mean the oldest shape on the board wins every tie, forever.
	ranked.sort((a, b) => a.distance - b.distance)
	return ranked.map((entry) => entry.ref)
}
