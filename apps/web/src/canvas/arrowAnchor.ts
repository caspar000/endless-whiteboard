import { Group2d, Vec, type Geometry2d } from 'tldraw'

/**
 * Where an arrow's properties hang from.
 *
 * They used to be drawn at the bottom-left corner of the arrow's *bounding box*, which is the rule
 * every other shape follows and the wrong one for a line: the bounding box of a long diagonal has
 * four corners and the arrow passes through none of them. On a board with a dozen relations that
 * produced a scatter of `Amount` labels floating in empty space, each belonging to some arrow you
 * could not identify. The fix is to put them where the eye already looks for something written on a
 * line — the middle — and specifically **under the arrow's own label**, so a labelled relation reads
 * top to bottom as name, then data.
 *
 * The geometry is tldraw's, not ours, which is what makes this hold for all three kinds of arrow:
 *
 *  - `interpolateAlongEdge(t)` walks the *body* — a straight edge, an arc, or an elbow route — and
 *    is the one call that treats all three the same. A midpoint computed by hand would be wrong for
 *    an arc and badly wrong for an elbow, where the straight-line middle can lie off the route.
 *  - The **label box** arrives as a child of the arrow's geometry marked `isLabel`, present only
 *    when the arrow actually carries text. That is also where a *dragged* label ends up, so
 *    following it keeps the two together without reading `labelPosition` at all.
 *
 * Returns a point in the **shape's own space**; the caller maps it to the page.
 */
export function arrowStripAnchor(geometry: Geometry2d, labelPosition: number): Vec {
	const parts = geometry instanceof Group2d ? geometry.children : [geometry]

	// The label, when the arrow has one: hang the strip off the bottom edge of its box, centred, so
	// the two share a vertical line and neither is drawn over the other.
	const label = parts.find((part) => part.isLabel)
	if (label) return new Vec(label.bounds.midX, label.bounds.maxY)

	/*
	 * No label, so the anchor is the point on the line where a label *would* go.
	 *
	 * `labelPosition` is honoured rather than assuming the middle, for the case where someone
	 * labelled an arrow, dragged the label along it, and then deleted the text: the position they
	 * chose is still the position they chose, and adding text back must not make the strip jump.
	 */
	const body = parts.find((part) => !part.isLabel)
	if (!body) return new Vec(geometry.bounds.midX, geometry.bounds.midY)
	return body.interpolateAlongEdge(clampUnit(labelPosition))
}

/** `interpolateAlongEdge` wraps rather than clamps, so an out-of-range `t` would land anywhere. */
function clampUnit(t: number): number {
	if (!Number.isFinite(t)) return 0.5
	return Math.min(1, Math.max(0, t))
}
