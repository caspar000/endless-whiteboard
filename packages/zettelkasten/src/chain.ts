import type { BoxEntry } from './box'
import { isCiteId, rootOf } from './ids'

/**
 * The chain view's path (docs/zettelkasten-plan.md, "Chain"): reading a train of thought from a note
 * and turning off it along its links, as one follows a thought through a drawer of cards.
 *
 * A path is built from turns. The first is where reading started; each later one is a link taken from
 * the card in row `at` of the path so far, which cuts the path after that card and goes on from the
 * note the link pointed at. Rows rather than ids, since a path can come back round to a note it has
 * already passed.
 */
export interface Turn {
	/** The row the link was taken from; `null` for where reading started. */
	at: number | null
	/** The note (or source) the path goes on from. */
	to: string
}

/**
 * A note's line as read from it: the note, then every note after it in the box that is still the same
 * train of thought (its top-level number), branches included, as they come. A source is a line of one.
 * Gaps are passed over.
 */
export function lineFrom(order: readonly Pick<BoxEntry, 'zid' | 'kind'>[], start: string): string[] {
	if (isCiteId(start)) return order.some((entry) => entry.zid === start) ? [start] : []
	const from = order.findIndex((entry) => entry.zid === start && entry.kind === 'note')
	if (from < 0) return []
	const root = rootOf(start)
	const line: string[] = []
	for (let i = from; i < order.length; i++) {
		const entry = order[i]!
		if (entry.kind === 'gap') continue
		if (entry.kind !== 'note' || rootOf(entry.zid) !== root) break
		line.push(entry.zid)
	}
	return line
}

/** The path the turns make, row by row. */
export function chainPath(order: readonly Pick<BoxEntry, 'zid' | 'kind'>[], turns: readonly Turn[]): string[] {
	let path: string[] = []
	for (const turn of turns) {
		if (turn.at !== null) path = path.slice(0, turn.at + 1)
		path = [...path, ...lineFrom(order, turn.to)]
	}
	return path
}
