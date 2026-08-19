import { react, type Editor, type TLShape, type TLShapeId, type TLShapePartial } from 'tldraw'
import { propertyMap, readPropertyRegistry } from '../../../properties/schema'
import type { PropertyDef } from '../../../properties/types'
import { TABLE_NODE_TYPE } from '../definition'
import { getTableResult } from '../engine'
import type { TableResult } from '../query'
import type { TableNodeProps } from '../spec'
import { getViewDefinition } from './index'
import type { LaneMember } from './kanbanLayout'
import { hasViewHome, isPlaceableBy, readViewHome, viewHomePatch } from './ownership'

/**
 * The pass that makes a kanban — or a calendar — part of the board rather than a picture of one.
 *
 * A placing view's members are the real shapes that matched its query, and this is what moves them into
 * their lanes: change a sticky's status anywhere on the board and it leaves where it was and joins the
 * lane; change its date and it walks to that day. That is the behaviour these views exist for, and the
 * reverse of it — drag a card into a lane and its status changes — is the drop gesture, which writes a
 * property and lets this pass do the moving.
 *
 * It knows nothing about lanes or days. It decides *which* shapes may be moved — ownership, locks, what
 * is currently in hand — and asks the view itself for coordinates (`ViewDefinition.placement`).
 *
 * ### Position is an output, never an input
 *
 * This writes x/y. It must therefore never *read* x/y to decide membership — that comes from
 * `queryTable`, which is built on facts, and facts "deliberately exclude anything positional" so that
 * dragging cannot invalidate a query (`facts.ts`). If containment ever decided membership, this write
 * would change the answer, the answer would change the write, and the board would oscillate every
 * frame. Geometry is read here only as *layout input*: how tall a card is, where the view is.
 *
 * Split in two, for the reason `query.ts` and `engine.ts` are: `placementPatches` is pure and carries
 * every rule, `placeViewMembers` is the reactive shell that feeds it a live editor.
 */

/** What the pure pass needs from the world it is placing shapes in. */
export interface PlacementEnv {
	/** Every shape on the page, in any order. */
	shapes: readonly TLShape[]
	/** The query result for a view — its cache entry, so the card and this pass agree on the lanes. */
	resultFor(viewId: string): TableResult
	properties: ReadonlyMap<string, PropertyDef>
	/** How tall a shape stands on the page, whatever kind of shape it is. */
	heightOf(shape: TLShape): number
	/** A shape-space point on `view`, expressed in `member`'s own parent space. */
	place(view: TLShape, member: TLShape, local: { x: number; y: number }): { x: number; y: number }
	/**
	 * Shapes a drag currently owns. Their positions are not ours to set, and they are not adopted
	 * either — recording a home mid-flight would remember a spot the shape was merely passing through.
	 */
	held: ReadonlySet<string>
}

/**
 * Every write the board needs to look like its views say it does — or nothing, which is the normal case.
 *
 * Returns at most one patch per shape (see {@link PatchSet}) and only for shapes that are actually in
 * the wrong place, which is what makes this safe to run on every store change: it converges after one
 * pass and writes nothing thereafter.
 */
export function placementPatches(env: PlacementEnv): TLShapePartial[] {
	const views: TLShape[] = []
	const owned: TLShape[] = []
	const filling: TLShape[] = []
	for (const shape of env.shapes) {
		if (isPlacingView(shape)) views.push(shape)
		else if (isFillingView(shape)) filling.push(shape)
		// Collected even when nothing is placing any more: a shape whose view has been deleted, or
		// switched back to a table, still has to be let go of — see the release pass below.
		else if (hasViewHome(shape)) owned.push(shape)
	}
	if (!views.length && !owned.length && !filling.length) return []

	const patches = new PatchSet()
	/** Members this pass positioned. Everything else that is owned gets released. */
	const placed = new Set<string>()

	/*
	 * A view that lays itself out against the card's box needs the box to be a box, so the height
	 * measurement is pinned off wherever one is found without it.
	 *
	 * Repaired here as well as in `mode.ts` because that is only the *user's* door: `node.configure`
	 * writes props directly, as does an imported board, and a calendar left measuring its own content
	 * collapses to the height of its title strip.
	 */
	for (const shape of [...views, ...filling]) {
		if ((shape.props as { autoHeight?: boolean }).autoHeight === false) continue
		patches.add({ id: shape.id, type: shape.type, props: { autoHeight: false } } as TLShapePartial)
	}

	for (const view of views) {
		const props = view.props as unknown as TableNodeProps
		const definition = getViewDefinition(props.layout.mode)
		const result = env.resultFor(view.id)

		/*
		 * Which shapes may be moved is decided here; *where they go* is the view's business.
		 *
		 * So this groups the query's own buckets — a lane value for a kanban, an ISO day for a calendar —
		 * filters them to the shapes this pass is allowed to touch, and hands them over. Nothing in this
		 * file knows what a lane or a day is, which is what let the calendar become a placing view without
		 * touching the pass at all.
		 */
		const membersByKey = new Map<string, LaneMember[]>()
		for (const group of result.groups) {
			if (group.key === null) continue
			const members: LaneMember[] = []
			for (const row of group.rows) {
				const shape = env.shapes.find((s) => s.id === row.shapeId)
				if (!shape || !canPlace(shape) || !isPlaceableBy(shape, view.id)) continue
				if (env.held.has(shape.id)) continue
				members.push({ id: shape.id, height: env.heightOf(shape) })
			}
			membersByKey.set(group.key, members)
		}

		const laid = definition?.placement?.({
			props,
			properties: env.properties,
			result,
			width: (view.props as { w: number }).w,
			membersByKey,
		})
		// Nothing to arrange by yet — no lanes, no date. The view's members are released below, and the
		// card says why on its own face (`blockedReason`).
		if (!laid) continue
		const { slots, height } = laid

		const byId = new Map(env.shapes.map((shape) => [shape.id as string, shape]))

		for (const [id, slot] of slots) {
			const member = byId.get(id)
			if (!member) continue
			placed.add(id)

			// Recorded from where the shape is standing *now*, before the first move, so releasing it later
			// can put it back. Which is why this is checked before the patch below, not after.
			if (!hasViewHome(member)) {
				patches.add(
					viewHomePatch(member, { viewId: view.id, x: member.x, y: member.y, adopted: 'query' })
				)
			}

			const target = env.place(view, member, slot)
			if (isAt(member, target)) continue
			patches.add({ id: member.id, type: member.type, x: target.x, y: target.y })
		}

		// The card is as tall as the view says it needs to be, and this is the only thing allowed to say
		// so — which is why the measurement is pinned off above. With both writing, they disagree by the
		// card's 2px border and grow the shape on every pass, forever.
		if (Math.abs((view.props as { h: number }).h - height) > TOLERANCE) {
			patches.add({ id: view.id, type: view.type, props: { h: height } } as TLShapePartial)
		}
	}

	/*
	 * Letting go.
	 *
	 * A shape stops being a member when its property changes, when a filter stops matching it, when the
	 * view switches to a table, and when the view is deleted. All four look identical from here: it has a
	 * home, and nobody placed it.
	 *
	 * One adopted *by query* goes back where it came from — the view took it, and taking implies giving
	 * back; without that, changing a status would permanently rearrange someone's board and people would
	 * stop changing statuses. One dropped in by hand stays put: it was handed over deliberately, and
	 * moving it back to a spot the user dragged it away from would be the view overruling a gesture.
	 */
	for (const shape of owned) {
		if (placed.has(shape.id) || env.held.has(shape.id)) continue
		const home = readViewHome(shape)
		if (!home) continue
		patches.add(viewHomePatch(shape, null))
		if (home.adopted === 'query' && !isAt(shape, home)) {
			patches.add({ id: shape.id, type: shape.type, x: home.x, y: home.y })
		}
	}

	return patches.all()
}

/**
 * Installs the pass on a live board. Returns a disposer, like `deleteRelationsWithShapes`.
 *
 * A reaction, and the same shape as `deselectHiddenShapes` (`canvas/relationVisibility.ts`): read the
 * signals, write only the difference. The write re-triggers this effect, which then finds every member
 * already in place and writes nothing — so it settles in two runs rather than looping.
 *
 * Writes are `history: 'ignore'`. A lane position is derived state; ⌘Z should take back *the status you
 * changed*, and then the card walks out of the lane on its own.
 */
export function placeViewMembers(editor: Editor): () => void {
	return react('lifeboard:view-placement', () => {
		const shapes = editor.getCurrentPageShapes()
		// The cheap gate, before touching the property registry or any query: the overwhelming majority of
		// boards have no view that manages its own geometry, and this effect runs on every change to the
		// ones that do.
		if (!shapes.some((shape) => isManagedView(shape) || hasViewHome(shape))) return

		/*
		 * `getIsDragging` is atom-backed, so this effect re-runs the moment a drag ends and the held
		 * shapes snap into their lanes then. The *selection* is what identifies them: tldraw's translate
		 * session moves the selection, so "held" and "selected while dragging" are the same set.
		 */
		const held: ReadonlySet<string> = editor.inputs.getIsDragging()
			? new Set<string>(editor.getSelectedShapeIds())
			: EMPTY_HELD

		const patches = placementPatches({
			shapes,
			held,
			properties: propertyMap(readPropertyRegistry(editor)),
			resultFor: (viewId) => getTableResult(editor, viewId as TLShapeId),
			heightOf: (shape) => editor.getShapePageBounds(shape)?.height ?? 0,
			// Through the view's own transform, so a rotated kanban still lines its cards up; then into the
			// member's parent space, because `x`/`y` are parent-relative and a card may sit inside a frame.
			place: (view, member, local) =>
				editor.getPointInParentSpace(member, editor.getShapePageTransform(view).applyToPoint(local)),
		})

		if (!patches.length) return
		editor.run(() => editor.updateShapes(patches), { history: 'ignore' })
	})
}

const EMPTY_HELD: ReadonlySet<string> = new Set()

/** Half a pixel: below this a "move" is float noise, and writing it would never settle. */
const TOLERANCE = 0.5

function isAt(shape: { x: number; y: number }, point: { x: number; y: number }): boolean {
	return Math.abs(shape.x - point.x) < TOLERANCE && Math.abs(shape.y - point.y) < TOLERANCE
}

export function isPlacingView(shape: TLShape): boolean {
	return viewOf(shape)?.placesMembers === true
}

/** A view that lays itself out against the card's box, and so must own the card's height. */
function isFillingView(shape: TLShape): boolean {
	return viewOf(shape)?.fills === true
}

/** Either kind: a view this pass has something to say about. */
function isManagedView(shape: TLShape): boolean {
	return isPlacingView(shape) || isFillingView(shape)
}

function viewOf(shape: TLShape) {
	if (shape.type !== TABLE_NODE_TYPE) return undefined
	return getViewDefinition((shape.props as unknown as TableNodeProps).layout.mode)
}

/**
 * Whether a shape may be moved into a lane at all.
 *
 * Three exclusions, each about a shape whose position is not simply its own:
 *
 * - **A view never places another view.** Two of them arranging each other is the one failure with no
 *   way out — you could not drag either free of the other.
 * - **Containers** (a frame, a group) carry their contents with them, so filing one is a far larger
 *   action than filing a card, and not one anybody asked for by setting a property.
 * - **Arrows** are relations. An arrow's `x`/`y` is where its tail starts, so moving a bound one either
 *   drags the shapes it joins or tears it off them.
 *
 * A locked shape is left alone for the reason it is locked.
 */
export function canPlace(shape: TLShape): boolean {
	if (shape.isLocked) return false
	if (shape.type === TABLE_NODE_TYPE) return false
	return shape.type !== 'frame' && shape.type !== 'group' && shape.type !== 'arrow'
}

/**
 * One patch per shape, merged.
 *
 * `updateShapes` applies each partial against the record as it was, so two entries for the same shape
 * would leave only the last one's fields — a card given both a position and a home would silently lose
 * one of them. Merging here is cheaper than reasoning about which.
 */
class PatchSet {
	private readonly byId = new Map<string, TLShapePartial>()

	add(patch: TLShapePartial): void {
		const existing = this.byId.get(patch.id)
		if (!existing) {
			this.byId.set(patch.id, patch)
			return
		}
		this.byId.set(patch.id, {
			...existing,
			...patch,
			...(existing.meta || patch.meta ? { meta: { ...existing.meta, ...patch.meta } } : {}),
			...(existing.props || patch.props ? { props: { ...existing.props, ...patch.props } } : {}),
		} as TLShapePartial)
	}

	all(): TLShapePartial[] {
		return [...this.byId.values()]
	}
}
