import { TLArrowShape } from '@tldraw/tlschema'
import { Box2d } from '../../../../primitives/Box2d'
import { Matrix2d } from '../../../../primitives/Matrix2d'
import { Vec2d, VecLike } from '../../../../primitives/Vec2d'
import { Editor } from '../../../Editor'
import { TLArrowInfo } from './arrow-types'
import {
	BOUND_ARROW_OFFSET,
	STROKE_SIZES,
	getArrowTerminalsInArrowSpace,
	getBoundShapeRelationships,
} from './shared'
import { getArrowTerminal } from './terminals'

/**
 * Elbow arrows (`kind: 'elbow'`, docs/fork-parity.md D4 and B1): lines that only run across and
 * down, turning in right angles. Written for the fork from what tldraw 5 draws, not from its code.
 *
 * The route is the shortest of the ways out of the start shape's sides and into the end shape's:
 * straight across, one turn (an L), or two (a Z, whose middle run sits `elbowMidPoint` of the way
 * across the gap between the shapes). Routes that would cut through either shape are passed over,
 * and when none is left the line goes around. A free end can leave or arrive from any direction; an
 * arrow with two free ends turns along its longer side, as tldraw 5's does.
 */

/** One end of an elbow arrow, in the arrow's space. */
export interface ElbowEnd {
	/** The box of the shape the end is attached to. A free end has none. */
	box?: Box2d
	/** Where the end aims: the anchor on the shape, or the free point. */
	point: VecLike
	/** How far short of the shape the line stops, to leave room for an arrowhead. */
	gap: number
}

/** A route: its corners from start to end, and the run `elbowMidPoint` places, if it has one. */
export interface ElbowRoute {
	points: Vec2d[]
	/** The middle run lies across `axis` at `from + elbowMidPoint × (to − from)`. */
	mid?: { axis: 'x' | 'y'; from: number; to: number }
}

type Dir = { x: number; y: number }

const DIRS: Dir[] = [
	{ x: 1, y: 0 },
	{ x: -1, y: 0 },
	{ x: 0, y: 1 },
	{ x: 0, y: -1 },
]

/** How far a line runs straight out of a shape before it may turn back around it. */
const STUB = 24
/** Added per turn, so of two equally long routes the one with fewer turns wins. */
const TURN_COST = 0.5
/** A Z needs this much room on each side of its middle run, or it squeezes between the shapes. */
const MIN_HALF = 16
/** The shortest run into an end. An arrowhead's gap gives way before the run does. */
const MIN_RUN = 14

interface Side {
	/** Attached to a shape, rather than a free point. */
	bound: boolean
	/** How far short of the edge the line stops. */
	gap: number
	dir: Dir
	/** On the shape's edge (or the free point). */
	edge: Vec2d
	/** Where the line itself ends: `gap` out from the edge. */
	tip: Vec2d
	/** The edge's coordinate across `dir`, which a Z's middle run is measured between. */
	at: number
}

function sidesOf(end: ElbowEnd): Side[] {
	const { box, point, gap } = end
	return DIRS.map((dir) => {
		let edge: Vec2d
		if (!box) edge = Vec2d.From(point)
		else if (dir.x === 1) edge = new Vec2d(box.maxX, clamp(point.y, box.minY, box.maxY))
		else if (dir.x === -1) edge = new Vec2d(box.minX, clamp(point.y, box.minY, box.maxY))
		else if (dir.y === 1) edge = new Vec2d(clamp(point.x, box.minX, box.maxX), box.maxY)
		else edge = new Vec2d(clamp(point.x, box.minX, box.maxX), box.minY)
		const tip = new Vec2d(edge.x + dir.x * gap, edge.y + dir.y * gap)
		return { bound: !!box, gap, dir, edge, tip, at: dir.x ? edge.x : edge.y }
	})
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const dot = (a: VecLike, d: Dir) => a.x * d.x + a.y * d.y

/** The route between two ends. Always at least two points. */
export function routeElbow(start: ElbowEnd, end: ElbowEnd, midPoint: number): ElbowRoute {
	const m = clamp(Number.isFinite(midPoint) ? midPoint : 0.5, 0, 1)

	// Two free ends: turn along the longer side, like a free elbow arrow in tldraw 5.
	if (!start.box && !end.box) {
		const a = Vec2d.From(start.point)
		const b = Vec2d.From(end.point)
		const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
		return zRoute(a, b, horizontal ? 'x' : 'y', horizontal ? a.x : a.y, horizontal ? b.x : b.y, m)
	}

	let best: { route: ElbowRoute; cost: number } | undefined
	const consider = (route: ElbowRoute | undefined) => {
		if (!route || crosses(route.points, start.box) || crosses(route.points, end.box)) return
		const cost = lengthOf(route.points) + TURN_COST * (route.points.length - 2)
		if (!best || cost < best.cost - 1e-6) best = { route, cost }
	}

	// Read through a call: the assignments happen inside `consider`, where narrowing can't see them.
	const chosen = () => best?.route
	const startSides = sidesOf(start)
	const endSides = sidesOf(end)
	for (const a of startSides) for (const b of endSides) consider(simpleRoute(a, b, m))
	const simple = chosen()
	if (simple) return simple

	for (const a of startSides) for (const b of endSides) consider(aroundRoute(a, b, start.box, end.box))
	const around = chosen()
	if (around) return around

	// Overlapping shapes leave nothing clean; still draw something sensible.
	const a = Vec2d.From(start.point)
	const b = Vec2d.From(end.point)
	const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)
	return zRoute(a, b, horizontal ? 'x' : 'y', horizontal ? a.x : a.y, horizontal ? b.x : b.y, m)
}

/** Straight, an L or a Z out of side `a` and into side `b`, if the sides allow one. */
function simpleRoute(a: Side, b: Side, m: number): ElbowRoute | undefined {
	const p = a.tip
	const q = b.tip
	// The line leaves along `a.dir` and arrives moving against `b.dir`.
	const arrive = { x: -b.dir.x, y: -b.dir.y }

	if (a.dir.x === arrive.x && a.dir.y === arrive.y) {
		// Facing sides: straight across, or a Z.
		if (dot(Vec2d.Sub(q, p), a.dir) <= 0) return
		const axis = a.dir.x ? 'x' : 'y'
		if (Math.abs(axis === 'x' ? q.y - p.y : q.x - p.x) < 0.5) return { points: [p, q] }
		return facingZ(a, b, axis, m)
	}

	if (a.dir.x === -arrive.x && a.dir.y === -arrive.y) return // back the way it came: around

	if (a.dir.x === b.dir.x && a.dir.y === b.dir.y) {
		// Both sides face the same way: out past both, across, and back in (a U).
		const reach = (v: Vec2d) => dot(v, a.dir)
		const far = Math.max(reach(p), reach(q)) + STUB
		const out = (v: Vec2d) => (a.dir.x ? new Vec2d(far * a.dir.x, v.y) : new Vec2d(v.x, far * a.dir.y))
		return { points: [p, out(p), out(q), q] }
	}

	// Sides at right angles: one turn.
	const corner = a.dir.x ? new Vec2d(q.x, p.y) : new Vec2d(p.x, q.y)
	if (dot(Vec2d.Sub(corner, p), a.dir) <= 0.5 || dot(Vec2d.Sub(q, corner), arrive) <= 0.5) return
	return { points: [p, corner, q] }
}

/**
 * A Z between facing sides. Its middle run stays `MIN_HALF` clear of each shape, and a narrower gap
 * than that is no place for a Z. Where the middle run comes close, the arrowhead's gap shrinks so the
 * run into the end stays `MIN_RUN` long.
 */
function facingZ(a: Side, b: Side, axis: 'x' | 'y', m: number): ElbowRoute | undefined {
	const span = Math.abs(b.at - a.at)
	const room = (a.bound ? MIN_HALF : 0) + (b.bound ? MIN_HALF : 0)
	if (span < room) return
	const sign = Math.sign(b.at - a.at)
	const lo = a.at + sign * (a.bound ? MIN_HALF : 0)
	const hi = b.at - sign * (b.bound ? MIN_HALF : 0)
	const c = sign > 0 ? clamp(a.at + m * (b.at - a.at), lo, hi) : clamp(a.at + m * (b.at - a.at), hi, lo)
	const gapAt = (side: Side) => Math.max(0, Math.min(side.gap, Math.abs(side.at - c) - MIN_RUN))
	const tip = (side: Side) => {
		const gap = gapAt(side)
		return new Vec2d(side.edge.x + side.dir.x * gap, side.edge.y + side.dir.y * gap)
	}
	const p = tip(a)
	const q = tip(b)
	const points =
		axis === 'x'
			? [p, new Vec2d(c, p.y), new Vec2d(c, q.y), q]
			: [p, new Vec2d(p.x, c), new Vec2d(q.x, c), q]
	return { points: tidy(points), mid: { axis, from: a.at, to: b.at } }
}

/**
 * Around: out of `a` a little, across a channel clear of both shapes, and into `b` from a little
 * way off. For ends whose sides face away from each other.
 */
function aroundRoute(a: Side, b: Side, boxA?: Box2d, boxB?: Box2d): ElbowRoute | undefined {
	const p = a.tip
	const q = b.tip
	const p1 = new Vec2d(p.x + a.dir.x * STUB, p.y + a.dir.y * STUB)
	const q1 = new Vec2d(q.x + b.dir.x * STUB, q.y + b.dir.y * STUB)
	// The channel runs across the axis the line leaves on, between the shapes or outside both.
	const axis = a.dir.x ? 'y' : 'x'
	const lo = (box?: Box2d) => (box ? (axis === 'y' ? box.minY : box.minX) : Infinity)
	const hi = (box?: Box2d) => (box ? (axis === 'y' ? box.maxY : box.maxX) : -Infinity)
	const channels = [Math.min(lo(boxA), lo(boxB), axis === 'y' ? q1.y : q1.x) - STUB, Math.max(hi(boxA), hi(boxB), axis === 'y' ? q1.y : q1.x) + STUB]
	if (boxA && boxB) {
		if (hi(boxA) < lo(boxB)) channels.push((hi(boxA) + lo(boxB)) / 2)
		if (hi(boxB) < lo(boxA)) channels.push((hi(boxB) + lo(boxA)) / 2)
	}
	let best: ElbowRoute | undefined
	let bestLength = Infinity
	for (const c of channels) {
		if (!Number.isFinite(c)) continue
		const at = (v: Vec2d) => (axis === 'y' ? new Vec2d(v.x, c) : new Vec2d(c, v.y))
		const points = tidy([p, p1, at(p1), at(q1), q1, q])
		if (crosses(points, boxA) || crosses(points, boxB)) continue
		const length = lengthOf(points)
		if (length < bestLength) {
			best = { points }
			bestLength = length
		}
	}
	return best
}

/** A Z from `p` to `q` whose middle run crosses `axis` at `m` of the way from `from` to `to`. */
function zRoute(p: Vec2d, q: Vec2d, axis: 'x' | 'y', from: number, to: number, m: number): ElbowRoute {
	const lo = Math.min(axis === 'x' ? p.x : p.y, axis === 'x' ? q.x : q.y)
	const hi = Math.max(axis === 'x' ? p.x : p.y, axis === 'x' ? q.x : q.y)
	const c = clamp(from + m * (to - from), lo, hi)
	const points =
		axis === 'x'
			? [p, new Vec2d(c, p.y), new Vec2d(c, q.y), q]
			: [p, new Vec2d(p.x, c), new Vec2d(q.x, c), q]
	return { points: tidy(points), mid: { axis, from, to } }
}

/** Without repeated points or corners that aren't turns. */
function tidy(points: Vec2d[]): Vec2d[] {
	const out: Vec2d[] = []
	for (const point of points) {
		const last = out[out.length - 1]
		if (last && Vec2d.Dist(last, point) < 0.01) continue
		const before = out[out.length - 2]
		if (last && before && collinear(before, last, point)) out[out.length - 1] = point
		else out.push(point)
	}
	return out.length >= 2 ? out : [points[0]!, points[points.length - 1]!]
}

const collinear = (a: Vec2d, b: Vec2d, c: Vec2d) =>
	(Math.abs(a.x - b.x) < 0.01 && Math.abs(b.x - c.x) < 0.01) || (Math.abs(a.y - b.y) < 0.01 && Math.abs(b.y - c.y) < 0.01)

function lengthOf(points: Vec2d[]): number {
	let length = 0
	for (let i = 1; i < points.length; i++) length += Vec2d.Dist(points[i - 1]!, points[i]!)
	return length
}

/** Whether any run passes through the inside of `box` (touching its edge is fine). */
function crosses(points: Vec2d[], box?: Box2d): boolean {
	if (!box) return false
	const inset = 0.5
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!
		const b = points[i]!
		const minX = Math.min(a.x, b.x)
		const maxX = Math.max(a.x, b.x)
		const minY = Math.min(a.y, b.y)
		const maxY = Math.max(a.y, b.y)
		if (maxX > box.minX + inset && minX < box.maxX - inset && maxY > box.minY + inset && minY < box.maxY - inset) {
			return true
		}
	}
	return false
}

/**
 * The run `elbowMidPoint` moves: the one crossing `mid.axis` between the route's ends. Its centre is
 * where the label and the middle handle go.
 */
export function getElbowMiddleRun(points: VecLike[], mid?: ElbowRoute['mid']): [VecLike, VecLike] | undefined {
	if (!mid) return
	for (let i = 2; i < points.length - 1; i++) {
		const a = points[i - 1]!
		const b = points[i]!
		if (mid.axis === 'x' ? Math.abs(a.x - b.x) < 0.01 : Math.abs(a.y - b.y) < 0.01) return [a, b]
	}
	return
}

/** The point `distance` along a route. */
export function pointAlongRoute(points: VecLike[], distance: number): Vec2d {
	let left = distance
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1]!
		const b = points[i]!
		const length = Vec2d.Dist(a, b)
		if (left <= length) return Vec2d.Lrp(a, b, length ? left / length : 0)
		left -= length
	}
	return Vec2d.From(points[points.length - 1]!)
}

/** A route as an SVG path, its corners rounded. */
export function getElbowArrowPath(points: VecLike[], radius: number): string {
	let d = `M${points[0]!.x},${points[0]!.y}`
	for (let i = 1; i < points.length - 1; i++) {
		const prev = points[i - 1]!
		const corner = points[i]!
		const next = points[i + 1]!
		const r = Math.min(radius, Vec2d.Dist(prev, corner) / 2, Vec2d.Dist(corner, next) / 2)
		const into = Vec2d.Nudge(corner, prev, r)
		const out = Vec2d.Nudge(corner, next, r)
		d += `L${into.x},${into.y}Q${corner.x},${corner.y} ${out.x},${out.y}`
	}
	const last = points[points.length - 1]!
	return d + `L${last.x},${last.y}`
}

/** Elbow arrow info for the editor: the straight arrow's shape, with the route alongside. */
export function getElbowArrowInfo(editor: Editor, shape: TLArrowShape): TLArrowInfo {
	const handles = getArrowTerminalsInArrowSpace(editor, shape)
	const arrowPageTransform = editor.getShapePageTransform(shape)!
	const toArrowSpace = Matrix2d.Inverse(arrowPageTransform)

	const startTerminal = getArrowTerminal(editor, shape, 'start')
	const endTerminal = getArrowTerminal(editor, shape, 'end')
	const relationship = getBoundShapeRelationships(
		editor,
		startTerminal.type === 'binding' ? startTerminal.boundShapeId : undefined,
		endTerminal.type === 'binding' ? endTerminal.boundShapeId : undefined
	)
	// Bound to one shape at both ends, or one shape inside the other: there are no sides to route
	// between, so the ends are treated as free points.
	const freeEnds = relationship !== 'safe'

	const endOf = (which: 'start' | 'end'): ElbowEnd => {
		const terminal = which === 'start' ? startTerminal : endTerminal
		const point = which === 'start' ? handles.start : handles.end
		if (terminal.type !== 'binding' || freeEnds) return { point, gap: 0 }
		const bound = editor.getShape(terminal.boundShapeId)
		const pageBounds = bound && editor.getShapePageBounds(bound)
		if (!bound || !pageBounds) return { point, gap: 0 }
		const box = Box2d.FromPoints(pageBounds.corners.map((corner) => Matrix2d.applyToPoint(toArrowSpace, corner)))
		const arrowhead = which === 'start' ? shape.props.arrowheadStart : shape.props.arrowheadEnd
		const gap =
			arrowhead === 'none' || terminal.isExact
				? 0
				: BOUND_ARROW_OFFSET +
				  STROKE_SIZES[shape.props.size]! / 2 +
				  ('size' in bound.props ? STROKE_SIZES[bound.props.size as string]! / 2 : 0)
		return { box, point, gap }
	}

	const route = routeElbow(endOf('start'), endOf('end'), shape.props.elbowMidPoint)
	const points = route.points
	const middleRun = getElbowMiddleRun(points, route.mid)
	let length = 0
	for (let i = 1; i < points.length; i++) length += Vec2d.Dist(points[i - 1]!, points[i]!)

	return {
		isStraight: true,
		start: { handle: handles.start, point: points[0]!, arrowhead: shape.props.arrowheadStart },
		end: { handle: handles.end, point: points[points.length - 1]!, arrowhead: shape.props.arrowheadEnd },
		middle: middleRun ? Vec2d.Med(middleRun[0], middleRun[1]) : pointAlongRoute(points, length / 2),
		isValid: length > 0,
		length,
		route: points,
		elbow: middleRun ? route.mid : undefined,
	}
}
