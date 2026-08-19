import { T, type TLShape, type TLShapePartial } from 'tldraw'
import type { ShapeWithMeta } from '../../../properties/values'

/**
 * Which view has taken charge of a shape's position, and where the shape was standing before it did.
 *
 * A kanban *moves real shapes*: change a sticky's status and it leaves wherever it was and joins the
 * lane. That is only safe if two things are recorded, and this is where both live.
 *
 * **Ownership**, so that two kanbans matching the same sticky cannot fight over it. A view places
 * shapes that are unowned or already its own, and leaves the rest alone; first to adopt wins. Without
 * this, two layout passes would each move the card to its own lane, forever, at sixty frames a second.
 *
 * **A home**, so that adoption is reversible. Clear the status and the card walks back to where it was
 * — because a view that could permanently rearrange your board by *reading* it would make changing a
 * property feel dangerous, and people would stop doing it.
 *
 * Stored on the **member**, not the view: it is a fact about that shape (where it came from), it has to
 * survive the view being deleted, and it travels with the shape in a copy. A flat, colon-namespaced
 * key like every other sidecar — `updateShape` merges `meta` exactly one level deep, so a nested
 * object would be replaced wholesale on any other write (see `properties/values.ts`).
 */
const HOME_KEY = 'lifeboard:viewHome'

export interface ViewHome {
	/** The view that owns this shape's position. */
	viewId: string
	/** Shape-space position (as `shape.x`/`shape.y`, i.e. relative to its parent) before adoption. */
	x: number
	y: number
	/**
	 * How the shape joined.
	 *
	 * `query` — its property changed and the view came and got it. On release it goes home, because the
	 * view took it and taking implies giving back.
	 *
	 * `drop` — someone dragged it in. On release it stays where it stands: it was handed over, and
	 * teleporting it back to a spot the user deliberately dragged it away from would be the view
	 * overruling a gesture. Written by the drop gesture (Phase 3); nothing produces it yet.
	 */
	adopted: 'query' | 'drop'
}

const homeValidator: T.Validatable<ViewHome> = T.object({
	viewId: T.string,
	x: T.number,
	y: T.number,
	adopted: T.literalEnum('query', 'drop'),
})

/** The home a shape carries, or `null`. Malformed meta reads as absent, never as a throw. */
export function readViewHome(shape: ShapeWithMeta): ViewHome | null {
	const raw = shape.meta[HOME_KEY]
	if (!raw) return null
	try {
		return homeValidator.validate(raw)
	} catch {
		return null
	}
}

/** Cheap enough to run over every shape on the page — no validation, just presence. */
export function hasViewHome(shape: ShapeWithMeta): boolean {
	return Boolean(shape.meta[HOME_KEY])
}

/**
 * Whether this view may position this shape.
 *
 * Unowned, or owned by us. A shape owned by another view is that view's business — it draws its lane
 * one card short rather than the two of them tearing the card in half.
 */
export function isPlaceableBy(shape: ShapeWithMeta, viewId: string): boolean {
	const home = readViewHome(shape)
	return home === null || home.viewId === viewId
}

/**
 * The patch that records or clears a home, without writing it.
 *
 * Split from the write so the placement pass can fold every shape it touches into one transaction —
 * see `collectionPatch` for the same shape of decision. `false` rather than a delete when clearing:
 * `undefined` is not a JSON value and meta is validated as one.
 */
export function viewHomePatch(shape: TLShape, next: ViewHome | null): TLShapePartial {
	return {
		id: shape.id,
		type: shape.type,
		meta: { [HOME_KEY]: next ? { ...next } : false },
	} as TLShapePartial
}
