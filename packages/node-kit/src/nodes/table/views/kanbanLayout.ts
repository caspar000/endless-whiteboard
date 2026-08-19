/**
 * Where a kanban's lanes are, and where the cards in them go.
 *
 * Pure, and used by **both** the chrome and the placement pass — which is the whole reason it is its
 * own module. The cards are real shapes positioned in page space while the lanes are HTML inside the
 * node, so if the two derived their geometry separately they would drift, and a card would sit next to
 * the lane it claims to be in. Same reasoning as `canvas/arrowAnchor.ts`.
 *
 * Everything is in **shape space**: x/y from the node's top-left, unrotated. The placement converts to
 * page space through the node's own transform, so a rotated kanban still lines up.
 */

/**
 * The one place the kanban's dimensions are written down.
 *
 * The chrome applies these inline rather than reading them from a stylesheet, so the numbers the cards
 * are placed by and the numbers the lanes are drawn with cannot disagree — a font change or an edited
 * CSS rule would otherwise move the lanes and leave the cards behind. CSS keeps the colours.
 */
export const KANBAN_METRICS = {
	/** Around the lanes, inside the card's own border. */
	pad: 8,
	/** The title strip at the top: the view's name and its row count. */
	titleHeight: 26,
	/** A lane's heading: its value and how many cards are in it. */
	laneHeadHeight: 24,
	/** Between two lanes. */
	laneGap: 8,
	/** Between two cards in a lane. */
	cardGap: 8,
	/** A lane's drawn body when it holds nothing, so an empty lane is still a target. */
	emptyLaneHeight: 64,
	/** What a lane is given when the card is first switched to a kanban. */
	defaultLaneWidth: 200,
} as const

/** Shape-space y where the first card in any lane sits. */
export function contentTop(): number {
	return KANBAN_METRICS.titleHeight + KANBAN_METRICS.laneHeadHeight
}

export interface LaneBox {
	key: string
	/** Shape-space left edge. */
	x: number
	width: number
}

/**
 * Lane columns across the card's width.
 *
 * Width is **derived from the shape**, never stored: resizing a kanban is then ordinary `resizeBox`,
 * with no seam in the shape-util factory and no prop to migrate, and dragging a side handle widens
 * every lane — which is what a side handle looks like it should do. The cost is that adding a lane
 * narrows the others, which is why switching a card to this view widens it to fit
 * (`defaultLaneWidth` × lanes) instead of leaving a 360px card holding five columns.
 *
 * A lane is never narrower than 1px: at that point the card needs resizing, and NaN geometry would
 * take the board's rendering down rather than merely looking wrong.
 */
export function laneBoxes(keys: readonly string[], width: number): LaneBox[] {
	const { pad, laneGap } = KANBAN_METRICS
	if (!keys.length) return []
	const usable = width - pad * 2 - laneGap * (keys.length - 1)
	const laneWidth = Math.max(1, usable / keys.length)
	return keys.map((key, i) => ({ key, x: pad + i * (laneWidth + laneGap), width: laneWidth }))
}

/**
 * Which lane a point in the card falls in, or `null` for a point that is not offering to file anything.
 *
 * **Nearest lane, not strict containment.** The gutters between lanes and the padding at the edges are
 * a few pixels each, and a drop that landed in one and did nothing would read as the gesture being
 * unreliable — you aimed at a column and the board shrugged. Every x inside the card therefore belongs
 * to a lane.
 *
 * The title strip is the exception, and the reason there is a `null` at all: it is the card's own name,
 * not a column, so dropping on it is a miss rather than a guess.
 */
export function laneAt(
	lanes: readonly LaneBox[],
	local: { x: number; y: number }
): string | null {
	if (!lanes.length) return null
	if (local.y < KANBAN_METRICS.titleHeight) return null

	let nearest = lanes[0]!
	let best = Infinity
	for (const lane of lanes) {
		// Distance to the lane's interval, so a point inside it scores 0 and ties go to the earlier lane.
		const distance = Math.max(lane.x - local.x, 0, local.x - (lane.x + lane.width))
		if (distance < best) {
			best = distance
			nearest = lane
		}
	}
	return nearest.key
}

/** A member as the layout needs it: an id and how tall the shape is on the page. */
export interface LaneMember {
	id: string
	height: number
}

export interface KanbanSlots {
	/** Shape-space top-left per member id. */
	slots: Map<string, { x: number; y: number }>
	/** What the card's own height must be for the tallest lane to fit. */
	height: number
}

/**
 * Stacks each lane's members top to bottom and reports the height the card needs.
 *
 * Cards keep their own size — a sticky's dimensions are the user's, and shrinking one to fit a lane
 * would lose the text in it — so a card wider than its lane overhangs, visibly. That is the honest
 * failure and the hint to widen the card; silently scaling someone's note is not.
 *
 * There is deliberately no row cap. "+N more" is a thing a view can say about rows it is drawing; it
 * cannot say it about shapes that exist, so a lane with twenty cards makes a tall card on an infinite
 * canvas, and that is the right answer.
 */
export function kanbanSlots(
	lanes: readonly LaneBox[],
	membersByLane: ReadonlyMap<string, readonly LaneMember[]>
): KanbanSlots {
	const { cardGap, pad, emptyLaneHeight } = KANBAN_METRICS
	const top = contentTop()
	const slots = new Map<string, { x: number; y: number }>()
	// Annotated because `KANBAN_METRICS` is `as const`, so this would otherwise be the literal 64.
	let tallest: number = emptyLaneHeight

	for (const lane of lanes) {
		const members = membersByLane.get(lane.key) ?? []
		let y = top
		for (const member of members) {
			slots.set(member.id, { x: lane.x, y })
			y += member.height + cardGap
		}
		// The trailing gap is dropped: it is the space *between* cards, and counting it after the last one
		// leaves a lane that always looks like it is waiting for another.
		const used = members.length ? y - cardGap - top : emptyLaneHeight
		tallest = Math.max(tallest, used)
	}

	return { slots, height: top + tallest + pad }
}
