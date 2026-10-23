/**
 * The light lines of a tree view (docs/skill-tree-layout-plan.md, "Structure"). A skill node has a
 * spoke to each of its entries; an entry's works hang from it in a chain, in track order: the entry
 * to its first work, each work to the next. Pure: what is drawn, by layout key.
 */

/** Layout keys of items: skill nodes go by node id, items prefixed, as /mu/core gives a family and its node the same id. */
export const itemKey = (itemId: string) => `item:${itemId}`

export function lineEnds(items: Iterable<readonly [string, { parent: string; variant: 'entry' | 'work' }]>): { from: string; to: string }[] {
	const out: { from: string; to: string }[] = []
	const last = new Map<string, string>()
	for (const [id, at] of items) {
		if (at.variant === 'entry') {
			out.push({ from: at.parent, to: itemKey(id) })
			continue
		}
		// The next in its parent's chain: from the work before it, or from the parent itself.
		const before = last.get(at.parent)
		out.push({ from: before ?? itemKey(at.parent), to: itemKey(id) })
		last.set(at.parent, itemKey(id))
	}
	return out
}

/**
 * How much a line between two neighbouring works bends to follow the arc round their entry at
 * `centre`: the canvas's `bend`, the middle of the line pushed off its chord to the right of the way
 * it runs. 0 when the two aren't about as far from the entry, as when a chain steps out to the next arc.
 */
export function arcBend(from: { x: number; y: number }, to: { x: number; y: number }, centre: { x: number; y: number }): number {
	const ra = Math.hypot(from.x - centre.x, from.y - centre.y)
	const rb = Math.hypot(to.x - centre.x, to.y - centre.y)
	if (Math.abs(ra - rb) > 0.35 * Math.min(ra, rb)) return 0
	const r = (ra + rb) / 2
	const chord = Math.hypot(to.x - from.x, to.y - from.y)
	if (chord < 1 || chord / 2 >= r) return 0
	const sagitta = r - Math.sqrt(r * r - (chord / 2) ** 2)
	const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
	const away = Math.hypot(mid.x - centre.x, mid.y - centre.y) || 1
	const n = { x: (mid.x - centre.x) / away, y: (mid.y - centre.y) / away }
	const u = { x: (to.x - from.x) / chord, y: (to.y - from.y) / chord }
	// The canvas puts the middle at the chord's middle plus per(u) × −bend, with per(u) = (u.y, −u.x).
	return -sagitta * (n.x * u.y - n.y * u.x)
}
