/**
 * A node's scale: how much bigger than its own layout it is drawn (DARK-7).
 *
 * Dragging a handle resizes a node: its content lays itself out again in the new box. Dragging with
 * Shift held scales it instead, the way a sticky note scales: the box and everything in it grow
 * together, text and all. The two compose, so a scaled feed card still resizes normally afterwards,
 * its content laid out at `w / scale` and drawn `scale` times over.
 *
 * Kept in the shape's meta rather than its props, because every node type has it: a prop would
 * need a migration in each extension's sequence, and a meta key needs none. A shape without the key
 * is at 1, which is every node on every board from before.
 */

/** The meta key. Namespaced like the properties' keys (`lifeboard:props`), so it meets nothing else. */
export const SCALE_META_KEY = 'lifeboard:scale'

/** As small and as large as a node can be scaled: a tenth of its size up to ten times it. */
export const MIN_NODE_SCALE = 0.1
export const MAX_NODE_SCALE = 10

/** The node's scale, or 1 when it has none (or something unreadable came in from another device). */
export function nodeScale(shape: { meta?: Readonly<Record<string, unknown>> }): number {
	const value = shape.meta?.[SCALE_META_KEY]
	return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 1
}

/**
 * One Shift-drag's answer: the node's new scale, and the factor its box grows by to match.
 *
 * `scaleX`/`scaleY` are the drag's, against the box as it was when the drag began; Shift already
 * keeps them equal in size, and the smaller is taken as a sticky note takes it, so a node never ends
 * bigger than the drag. The factor is what's left of the drag once the scale is held within bounds,
 * so the box and the content always agree.
 */
export function scaleStep(start: number, scaleX: number, scaleY: number): { scale: number; factor: number } {
	const drag = Math.max(0.001, Math.min(Math.abs(scaleX), Math.abs(scaleY)))
	const scale = Math.min(MAX_NODE_SCALE, Math.max(MIN_NODE_SCALE, start * drag))
	return { scale, factor: scale / start }
}
