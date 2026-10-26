import { depthOf, rootOf } from './ids'

/** Every card is the same size: a 5 × 8 inch index card, lying landscape. */
export const CARD_W = 560
export const CARD_H = (CARD_W * 5) / 8

/** Between cards down a column, and between columns. */
export const CARD_GAP = 40
/** How far right each branching steps a card within its column. */
export const BRANCH_INDENT = 56

/**
 * The table view's layout (docs/zettelkasten-plan.md, "Table"): a column per top-level note, that note's
 * whole line down the column in reading order, each branching stepped right by `BRANCH_INDENT`.
 *
 * A pure function of the ids, in box order, which is what makes it safe to write into the board: every
 * device computes the same positions from the same ids, so two writing them at once agree, and a card's
 * position changes only when a card is added or taken out, never because someone looked at it.
 */
export function tableLayout(zidsInOrder: readonly string[]): Map<string, { x: number; y: number }> {
	const positions = new Map<string, { x: number; y: number }>()
	let columnX = 0
	let columnRoot: string | null = null
	let columnWidth = 0
	let y = 0
	for (const zid of zidsInOrder) {
		const root = rootOf(zid)
		if (root !== columnRoot) {
			if (columnRoot !== null) columnX += columnWidth + CARD_GAP
			columnRoot = root
			columnWidth = 0
			y = 0
		}
		const indent = depthOf(zid) * BRANCH_INDENT
		positions.set(zid, { x: columnX + indent, y })
		columnWidth = Math.max(columnWidth, indent + CARD_W)
		y += CARD_H + CARD_GAP
	}
	return positions
}
