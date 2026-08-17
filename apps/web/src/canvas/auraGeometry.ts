import { Group2d, type Editor, type TLShapeId } from 'tldraw'
import {
	auraLoops,
	type ContourPoint,
	type FieldBox,
	type FieldCapsule,
	type FieldShapes,
} from './auraField'
import { auraReach, getAuraPreset, type AuraPreset } from './auraPreset'
import { warpedFbm } from './noise'
import type { Trace } from './tracing'

/**
 * The shape of the aura — a coastline drawn around the traced shapes, that will not sit still.
 *
 * A drop-shadow would have been three lines of CSS and would have read as a selection highlight, which
 * is the one thing this must not look like: the lens is a mode, and it should be obvious at a glance
 * that something has been switched *on*.
 *
 * How it is built, in two stages that cost very different amounts:
 *
 *  - **The line's course** comes from a distance field over *all* the traced shapes at once
 *    (`auraField.ts`), so shapes close together share one outline instead of each drawing its own and
 *    crossing. That stage is rebuilt when shapes move, not when the animation ticks.
 *  - **The line's character** comes from displacing that course along its own outward normals, by a
 *    value read out of fractal noise (`noise.ts`). This is the per-frame half, and it is cheap: a few
 *    hundred points, no field, no contouring.
 *
 * The noise is read **along a circle**, which is the trick that makes the whole thing work: each point
 * on the loop maps to a point on a circle in 2-D noise space, so going once round the loop arrives back
 * at exactly the value it started from. The curve therefore closes with no seam, for any settings at
 * all — nothing has to be arranged, and there is no periodicity for the eye to find because the field
 * is fractal rather than harmonic. Time slides the circle's centre through the field, so the pattern
 * evolves the way a coastline would if the sea level drifted: continuously, and never repeating.
 *
 * Joining the samples with quadratics whose control points are the samples themselves gives a smooth
 * closed curve with no special-casing at the join — the classic smoothed-polygon trick, and the reason
 * this reads as drawn rather than polygonal.
 *
 * All of it is pure: geometry and a preset in, path strings out, with time as a parameter rather than a
 * side effect. The animation is these functions called again with a different `phase`.
 */

/** Corner radius the field gives a shape's outline, before the noise gets to it. */
const CORNER = 22

export interface Box {
	x: number
	y: number
	w: number
	h: number
}

export interface TracedOutlines {
	/** The group's bounding box in page space; every coordinate below is relative to it. */
	box: Box
	/**
	 * The merged outline, as one or more closed loops with outward normals.
	 *
	 * More than one when the traced shapes fall into separate clusters; nested when they surround a gap,
	 * which is why the paths are drawn with `evenodd` — an enclosed gap should read as a hole rather
	 * than being filled in.
	 */
	loops: ContourPoint[][]
	/**
	 * Where in the noise field this trace reads from.
	 *
	 * Per *trace* rather than per shape, now that the outline is one merged thing — it is derived from
	 * the traced shape, so pointing the lens somewhere else gives a different coastline, and pointing it
	 * back gives the same one.
	 */
	seed: number
}

/** How many points to draw a loop of this length with. */
function sampleCount(length: number, preset: AuraPreset): number {
	const features = Math.max(1, length / Math.max(1, preset.feature))
	return Math.max(24, Math.min(900, Math.round(features * preset.samplesPerFeature)))
}

/**
 * The radius of the circle traced through noise space for a loop of this length.
 *
 * Chosen so that one page unit along the outline is one page unit through the field: the circle's
 * circumference is the loop's length, scaled so a noise feature comes out `preset.feature` long. Get
 * this wrong and a big shape looks smooth while a small one looks shredded.
 */
function loopRadius(length: number, preset: AuraPreset): number {
	return length / Math.max(1, preset.feature) / (Math.PI * 2)
}

/**
 * How far out the line is at fraction `t` around the loop, in [-1, 1].
 *
 * Closure is structural, not arranged: `t` of 0 and 1 are the same point on the circle, so they read
 * the same value from the field however the preset is set.
 */
function fieldAt(
	t: number,
	radius: number,
	phase: number,
	seed: number,
	preset: AuraPreset
): number {
	const angle = t * Math.PI * 2
	// Time slides the circle sideways through the field; the seed drops each loop somewhere else in it.
	const cx = phase * preset.drift + seed * 31.7
	const cy = seed * 17.3
	return warpedFbm(
		cx + Math.cos(angle) * radius,
		cy + Math.sin(angle) * radius,
		1,
		preset.octaves,
		preset.roughness,
		preset.warp
	)
}

/** A closed, smooth path through the points — quadratics with the samples as control points. */
function smoothClosedPath(points: { x: number; y: number }[]): string {
	if (points.length < 3) return ''
	const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
	})

	const first = mid(points[points.length - 1]!, points[0]!)
	let d = `M ${round(first.x)} ${round(first.y)}`
	for (let i = 0; i < points.length; i++) {
		const control = points[i]!
		const next = mid(control, points[(i + 1) % points.length]!)
		d += ` Q ${round(control.x)} ${round(control.y)} ${round(next.x)} ${round(next.y)}`
	}
	return `${d} Z`
}

function round(n: number): number {
	// Two decimals: a path string is rebuilt thirty times a second, and the extra digits are bytes the
	// browser has to parse for detail no one can see.
	return Math.round(n * 100) / 100
}

/** Total length of a closed loop. */
function loopLength(loop: readonly ContourPoint[]): number {
	let total = 0
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i]!
		const b = loop[(i + 1) % loop.length]!
		total += Math.hypot(b.x - a.x, b.y - a.y)
	}
	return total
}

/**
 * Walks a loop at even spacing, interpolating both position and outward normal.
 *
 * The contour arrives spaced by the field's grid — a few pixels — which is far coarser than the noise
 * wants to be read at, and unevenly spaced wherever the line crosses a cell diagonally. Resampling
 * fixes both, and is what lets the ripple be specified as a length.
 */
function resampleLoop(loop: readonly ContourPoint[], count: number): ContourPoint[] {
	const total = loopLength(loop)
	if (total === 0) return []
	const step = total / count
	const out: ContourPoint[] = []
	let segment = 0
	let walked = 0

	for (let i = 0; i < count; i++) {
		const target = i * step
		while (segment < loop.length) {
			const a = loop[segment]!
			const b = loop[(segment + 1) % loop.length]!
			const run = Math.hypot(b.x - a.x, b.y - a.y)
			if (walked + run >= target || segment === loop.length - 1) {
				const t = run === 0 ? 0 : Math.min(1, Math.max(0, (target - walked) / run))
				const nx = a.nx + (b.nx - a.nx) * t
				const ny = a.ny + (b.ny - a.ny) * t
				const length = Math.hypot(nx, ny) || 1
				out.push({
					x: a.x + (b.x - a.x) * t,
					y: a.y + (b.y - a.y) * t,
					nx: nx / length,
					ny: ny / length,
				})
				break
			}
			walked += run
			segment++
		}
	}
	return out
}

/**
 * One loop of the merged outline, at a moment in time.
 *
 * `phase` is seconds; `seed` is any number, and differs per loop so two clusters do not breathe in
 * unison.
 */
export function loopOutline(
	loop: readonly ContourPoint[],
	phase: number,
	seed: number,
	preset: AuraPreset = getAuraPreset()
): string {
	if (loop.length < 3) return ''
	const length = loopLength(loop)
	const samples = resampleLoop(loop, sampleCount(length, preset))
	if (samples.length < 3) return ''
	const radius = loopRadius(length, preset)
	const points = samples.map((sample, i) => {
		const stray = fieldAt(i / samples.length, radius, phase, seed, preset) * preset.wobble
		return { x: sample.x + sample.nx * stray, y: sample.y + sample.ny * stray }
	})
	return smoothClosedPath(points)
}

/**
 * The aura around a single box — the merged path with one shape in it.
 *
 * Kept as its own entry point for the preview in Settings and for the tests, and deliberately built on
 * exactly the same code as the canvas uses, so what it shows is the effect rather than an impression
 * of it.
 */
export function auraOutline(
	box: Box,
	phase: number,
	seed: number,
	preset: AuraPreset = getAuraPreset()
): string {
	return auraOutlines({ boxes: [{ ...box, r: CORNER }], capsules: [] }, phase, seed, preset)
}

/**
 * The aura around a whole little scene — contoured *and* displaced in one call.
 *
 * For callers with nothing to keep quiet: the Settings preview, and the tests. The canvas deliberately
 * does not use this, because it separates the two halves so the expensive one can run less often.
 */
export function auraOutlines(
	shapes: FieldShapes,
	phase: number,
	seed: number,
	preset: AuraPreset = getAuraPreset()
): string {
	return auraLoops(shapes, preset.offset, preset.merge, auraReach(preset))
		.map((loop, i) => loopOutline(loop, phase, seed + i * 0.37, preset))
		.filter(Boolean)
		.join(' ')
}

/**
 * Thins a polyline to the corners that matter — Ramer–Douglas–Peucker.
 *
 * A traced arrow arrives as tldraw's own vertices, and an arc arrives as twenty or thirty of them.
 * Every one becomes a capsule, and every capsule is evaluated at every cell of the field, so an arc
 * would cost ten times what a straight arrow does for a difference nobody can see under a ribbon this
 * wide. Recursive rather than stepping along the line, because that is what keeps the corner of an
 * elbow arrow: the vertex furthest from the chord survives, wherever it happens to be.
 */
function simplify(
	points: readonly { x: number; y: number }[],
	tolerance: number
): { x: number; y: number }[] {
	if (points.length < 3) return [...points]
	const first = points[0]!
	const last = points[points.length - 1]!

	let worst = 0
	let at = 0
	for (let i = 1; i < points.length - 1; i++) {
		const distance = distanceToSegment(points[i]!, first, last)
		if (distance > worst) {
			worst = distance
			at = i
		}
	}
	if (worst <= tolerance) return [first, last]

	const head = simplify(points.slice(0, at + 1), tolerance)
	const tail = simplify(points.slice(at), tolerance)
	// `head` ends on the same point `tail` starts from; keep it once.
	return [...head.slice(0, -1), ...tail]
}

function distanceToSegment(
	p: { x: number; y: number },
	a: { x: number; y: number },
	b: { x: number; y: number }
): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const lengthSquared = dx * dx + dy * dy
	if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y)
	const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
	return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

/** A stable, arbitrary number per shape, so two auras never read the same stretch of the field. */
function seedFrom(id: string): number {
	let hash = 0
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) % 1000
	return hash / 1000
}

/**
 * Everything in the trace, as geometry relative to the group's bounding box.
 *
 * The nodes' outline is **contoured here**, which is the expensive step and the reason this function
 * exists rather than the layer doing it inline: it runs when the traced shapes move, and the animation
 * then only displaces what it produced. Arrows still come back as *points* — their line is redrawn
 * every frame, and bringing them into the field is the next piece of work.
 */
export function tracedOutlines(
	editor: Editor,
	trace: Trace,
	preset: AuraPreset = getAuraPreset()
): TracedOutlines | null {
	const boxes: FieldBox[] = []
	for (const id of trace.nodes) {
		const bounds = editor.getShapePageBounds(id as TLShapeId)
		if (!bounds) continue
		boxes.push({ x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h, r: CORNER })
	}

	const capsules: FieldCapsule[] = []
	for (const id of trace.arrows) {
		const shapeId = id as TLShapeId
		const geometry = editor.getShapeGeometry(shapeId)
		const transform = editor.getShapePageTransform(shapeId)
		if (!geometry || !transform) continue
		// The body's own vertices — a straight edge, an arc's samples, or an elbow's corners — so the
		// ribbon follows the arrow tldraw actually drew rather than a guess at it. An arrow's geometry is
		// a group whose other child is the label box, which must not be wrapped.
		const body =
			geometry instanceof Group2d
				? (geometry.children.find((part) => !part.isLabel) ?? geometry)
				: geometry
		const points = simplify(
			body.vertices.map((vertex) => transform.applyToPoint(vertex)),
			// Half the ribbon's own radius: a deviation smaller than that is invisible under it.
			Math.max(1, preset.ribbon / 2)
		)
		for (let i = 1; i < points.length; i++) {
			capsules.push({
				ax: points[i - 1]!.x,
				ay: points[i - 1]!.y,
				bx: points[i]!.x,
				by: points[i]!.y,
				r: preset.ribbon,
			})
		}
	}

	if (!boxes.length && !capsules.length) return null

	// The merged course of the line, in page space. One loop per cluster the field has fused — and
	// because relations are *in* the field, a traced group is normally one loop with a ribbon running
	// between its shapes.
	const pad = auraReach(preset) + preset.stroke + preset.softness + 4
	const loops = auraLoops({ boxes, capsules }, preset.offset, preset.merge, pad)

	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	const include = (x: number, y: number) => {
		minX = Math.min(minX, x)
		minY = Math.min(minY, y)
		maxX = Math.max(maxX, x)
		maxY = Math.max(maxY, y)
	}
	// The loops themselves, plus what the noise can add on top of them.
	const loopPad = preset.wobble + preset.stroke + preset.softness + 4
	for (const loop of loops) {
		for (const point of loop) {
			include(point.x - loopPad, point.y - loopPad)
			include(point.x + loopPad, point.y + loopPad)
		}
	}
	// The shapes too: anything that failed to contour must still be inside the drawing area.
	for (const box of boxes) {
		include(box.x - pad, box.y - pad)
		include(box.x + box.w + pad, box.y + box.h + pad)
	}
	for (const capsule of capsules) {
		const reach = pad + capsule.r
		include(Math.min(capsule.ax, capsule.bx) - reach, Math.min(capsule.ay, capsule.by) - reach)
		include(Math.max(capsule.ax, capsule.bx) + reach, Math.max(capsule.ay, capsule.by) + reach)
	}
	if (!Number.isFinite(minX)) return null

	const box: Box = { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) }
	return {
		box,
		seed: seedFrom(trace.root),
		loops: loops.map((loop) =>
			loop.map((point) => ({ ...point, x: point.x - box.x, y: point.y - box.y }))
		),
	}
}
