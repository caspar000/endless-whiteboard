import { Arc2d, Edge2d, Group2d, Polyline2d, Rectangle2d, Vec } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { arrowStripAnchor } from './arrowAnchor'

/**
 * Real tldraw geometry, not a fake.
 *
 * `Edge2d`, `Arc2d`, `Polyline2d` and `Group2d` are pure classes with no editor behind them, so
 * these are the same objects `ArrowShapeUtil.getGeometry` builds — which means the tests are about
 * the rule this module owns (label, or point along the body) rather than about a mock agreeing with
 * itself.
 */

/** A horizontal arrow from (0,0) to (200,0), as tldraw builds a straight one. */
function straight() {
	return new Edge2d({ start: new Vec(0, 0), end: new Vec(200, 0) })
}

/** The same arrow carrying a label — tldraw adds it as a second child, marked `isLabel`. */
function labelled(w = 60, h = 30) {
	return new Group2d({
		children: [
			straight(),
			new Rectangle2d({
				x: 100 - w / 2,
				y: -h / 2,
				width: w,
				height: h,
				isFilled: true,
				isLabel: true,
			}),
		],
	})
}

describe('arrowStripAnchor', () => {
	it('hangs off the bottom edge of the label, centred on it', () => {
		const anchor = arrowStripAnchor(labelled(), 0.5)
		// Centre of a 60×30 box sitting at the arrow's midpoint: x is the middle, y is its underside.
		expect(anchor.x).toBeCloseTo(100)
		expect(anchor.y).toBeCloseTo(15)
	})

	it('follows a label that has been dragged along the arrow', () => {
		const dragged = new Group2d({
			children: [
				straight(),
				new Rectangle2d({ x: 140, y: -15, width: 60, height: 30, isFilled: true, isLabel: true }),
			],
		})
		// Read off the box rather than off `labelPosition`, so the two cannot disagree — note the
		// deliberately wrong `labelPosition` argument here.
		const anchor = arrowStripAnchor(dragged, 0.5)
		expect(anchor.x).toBeCloseTo(170)
		expect(anchor.y).toBeCloseTo(15)
	})

	it('falls back to the point on the line where the label would be', () => {
		expect(arrowStripAnchor(straight(), 0.5).x).toBeCloseTo(100)
		expect(arrowStripAnchor(straight(), 0.25).x).toBeCloseTo(50)
		expect(arrowStripAnchor(straight(), 0.75).x).toBeCloseTo(150)
	})

	it('lands on the curve of an arc, not on the chord under it', () => {
		// A half-circle bulging upward: the chord's midpoint is (0,0) and the arc's is (0,-100). A
		// hand-rolled midpoint would put the properties a hundred units off the line.
		const arc = new Arc2d({
			center: new Vec(0, 0),
			start: new Vec(-100, 0),
			end: new Vec(100, 0),
			sweepFlag: 0,
			largeArcFlag: 0,
		})
		const anchor = arrowStripAnchor(arc, 0.5)
		// Within a pixel of the radius rather than exactly on it: tldraw walks an arc as sampled
		// vertices, so the answer is a point on the drawn curve, which is the thing that matters. The
		// failure this guards against misses by a hundred, not by a hundredth.
		expect(Math.abs(Math.hypot(anchor.x, anchor.y) - 100)).toBeLessThan(1)
		expect(anchor.y).toBeLessThan(-99)
	})

	it('follows an elbow route rather than cutting the corner', () => {
		// Two legs of 100 each: halfway along the *route* is the corner itself, which is nowhere near
		// the straight line between the ends.
		const elbow = new Polyline2d({
			points: [new Vec(0, 0), new Vec(100, 0), new Vec(100, 100)],
		})
		const anchor = arrowStripAnchor(elbow, 0.5)
		expect(anchor.x).toBeCloseTo(100)
		expect(anchor.y).toBeCloseTo(0)
	})

	it('survives a nonsense label position rather than placing the strip somewhere arbitrary', () => {
		// `interpolateAlongEdge` wraps, so an out-of-range `t` would otherwise land anywhere at all.
		expect(arrowStripAnchor(straight(), 2).x).toBeCloseTo(200)
		expect(arrowStripAnchor(straight(), -1).x).toBeCloseTo(0)
		expect(arrowStripAnchor(straight(), Number.NaN).x).toBeCloseTo(100)
	})
})
