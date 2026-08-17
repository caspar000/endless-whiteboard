/**
 * One aura around several shapes, by way of a distance field.
 *
 * Drawing an outline per shape can never merge two of them: each outline knows only its own box, so
 * two shapes side by side get two outlines that cross. What merges is a *field* — ask, for every point
 * on the canvas, how far it is from the nearest shape, then draw the line where that answer equals the
 * offset. Two shapes close together share one such line, and it pinches between them, because that is
 * simply where the distances say the line goes.
 *
 * Three pieces, and each is standard:
 *
 *  - **`sdRoundRect`** — the exact signed distance to a rounded rectangle. Negative inside, zero on the
 *    edge, positive outside.
 *  - **`smin`** — a *smooth* minimum instead of `Math.min`. A hard minimum gives the union a crease
 *    where two shapes meet, which reads as two outlines badly joined; the smooth version rounds that
 *    join into the waist you want. `merge` is how wide the blend is, and therefore how eagerly two
 *    shapes fuse.
 *  - **`contour`** — marching squares over a grid of field samples, which returns the line as closed
 *    loops. Nested loops fall out of it too, so the gap in the middle of three shapes becomes a hole
 *    rather than being filled in.
 *
 * The reason this is affordable: **none of it runs per frame.** The field and its loops are rebuilt
 * only when the shapes move — measured at about 3 ms for a trace spanning 1200×800 at 6 px cells — and
 * the animation then displaces the finished loops, which costs no more than the per-shape outlines it
 * replaces. Putting the noise *into* the field, so the coastline itself decided the merging, measured
 * four to fifteen times dearer and would have had to run on every frame; the noise is applied to the
 * extracted loop instead, where nobody can tell the difference.
 */

export interface FieldBox {
	x: number
	y: number
	w: number
	h: number
	/** Corner radius, so a card's aura has corners rather than points. */
	r: number
}

/**
 * A relation, as a thick line segment.
 *
 * This is what puts a traced arrow *into* the field rather than beside it. The radius is how far the
 * line pushes the surface out, so the outline stands off the arrow by that plus the offset — where
 * before it was drawn along the arrow's own centreline and disappeared under it. It also means a
 * relation joins the shapes at its ends into one envelope, which is the whole reason the outlines
 * around two connected shapes now read as one thing.
 */
export interface FieldCapsule {
	ax: number
	ay: number
	bx: number
	by: number
	r: number
}

export interface FieldShapes {
	boxes: readonly FieldBox[]
	capsules: readonly FieldCapsule[]
}

/** A point on the contour, with the direction "away from the shapes" at that point. */
export interface ContourPoint {
	x: number
	y: number
	nx: number
	ny: number
}

/** Exact signed distance from a point to a rounded rectangle. */
export function sdRoundRect(px: number, py: number, box: FieldBox): number {
	const r = Math.max(0, Math.min(box.r, Math.min(box.w, box.h) / 2))
	const halfW = box.w / 2 - r
	const halfH = box.h / 2 - r
	const qx = Math.abs(px - (box.x + box.w / 2)) - halfW
	const qy = Math.abs(py - (box.y + box.h / 2)) - halfH
	const outsideX = Math.max(qx, 0)
	const outsideY = Math.max(qy, 0)
	return Math.hypot(outsideX, outsideY) + Math.min(Math.max(qx, qy), 0) - r
}

/**
 * Smooth minimum — the whole reason two auras become one.
 *
 * `Math.min` would join two fields with a crease, and a crease in the contour reads as two outlines
 * meeting badly. This rounds the join over a width of `k`, which is also what decides how close two
 * shapes have to be before they fuse at all.
 *
 * The guard matters: at `k` of zero this is exactly `Math.min`, so "no merging" is a setting rather
 * than a special case.
 */
export function smin(a: number, b: number, k: number): number {
	if (k <= 0) return Math.min(a, b)
	const h = Math.max(0, k - Math.abs(a - b)) / k
	return Math.min(a, b) - h * h * k * 0.25
}

/** Exact signed distance from a point to a capsule — the nearest point on the segment, less the radius. */
export function sdCapsule(px: number, py: number, capsule: FieldCapsule): number {
	const dx = capsule.bx - capsule.ax
	const dy = capsule.by - capsule.ay
	const lengthSquared = dx * dx + dy * dy
	// A zero-length capsule is a circle, which is the right answer rather than a division by zero.
	const t =
		lengthSquared === 0
			? 0
			: Math.max(
					0,
					Math.min(1, ((px - capsule.ax) * dx + (py - capsule.ay) * dy) / lengthSquared)
				)
	return Math.hypot(px - (capsule.ax + dx * t), py - (capsule.ay + dy * t)) - capsule.r
}

/** The distance to the nearest of several shapes, smoothly unioned. */
export function distanceField(shapes: FieldShapes, merge: number) {
	const { boxes, capsules } = shapes
	return (px: number, py: number): number => {
		let d = Infinity
		for (const box of boxes) {
			const next = sdRoundRect(px, py, box)
			d = d === Infinity ? next : smin(d, next, merge)
		}
		for (const capsule of capsules) {
			const next = sdCapsule(px, py, capsule)
			d = d === Infinity ? next : smin(d, next, merge)
		}
		return d
	}
}

/**
 * How coarse a grid to sample the field on.
 *
 * Fine enough that the contour is smooth at the scale anyone looks at it, coarse enough that a trace
 * spanning a large area cannot cost an unbounded number of samples. The target cell count is what is
 * held constant; the clamp keeps small traces from being sampled absurdly finely and large ones from
 * being sampled uselessly coarsely.
 *
 * `elements` is in here because every shape in the field is evaluated at every cell, so the real cost
 * is cells × elements. A hub with six relations puts thirteen things in the field, and holding the
 * *cell count* constant there would triple the work; holding the product roughly constant instead
 * spends the same time and loses a little smoothness, which is the right trade for a line that is
 * about to be roughened by noise anyway.
 */
export function cellSizeFor(width: number, height: number, elements = 1): number {
	const BUDGET = 26_000 * 6
	const target = Math.max(9_000, BUDGET / Math.max(6, elements))
	return Math.max(5, Math.min(16, Math.sqrt((width * height) / target)))
}

/**
 * Marching squares.
 *
 * Cases are the classic sixteen, written out rather than table-driven so the two ambiguous ones (a
 * cell whose inside corners are diagonally opposite) can be resolved by looking at the middle of the
 * cell instead of being guessed. Each case emits directed segments; the direction is only used to
 * stitch segments into loops, because the outward direction comes from the field's gradient rather
 * than from which way round the loop was walked. That is what makes holes come out right without any
 * special handling.
 */
function marchingSquares(
	values: Float32Array,
	cols: number,
	rows: number,
	originX: number,
	originY: number,
	cell: number,
	iso: number
): { ax: number; ay: number; bx: number; by: number }[] {
	const segments: { ax: number; ay: number; bx: number; by: number }[] = []
	const at = (i: number, j: number) => values[j * cols + i]!

	// Where along an edge the contour crosses, by linear interpolation between the two corner values.
	const lerpEdge = (v0: number, v1: number) => {
		const span = v1 - v0
		return span === 0 ? 0.5 : Math.max(0, Math.min(1, (iso - v0) / span))
	}

	for (let j = 0; j < rows - 1; j++) {
		for (let i = 0; i < cols - 1; i++) {
			const tl = at(i, j)
			const tr = at(i + 1, j)
			const br = at(i + 1, j + 1)
			const bl = at(i, j + 1)

			let code = 0
			if (tl < iso) code |= 1
			if (tr < iso) code |= 2
			if (br < iso) code |= 4
			if (bl < iso) code |= 8
			if (code === 0 || code === 15) continue

			const x = originX + i * cell
			const y = originY + j * cell
			const top = { x: x + lerpEdge(tl, tr) * cell, y }
			const right = { x: x + cell, y: y + lerpEdge(tr, br) * cell }
			const bottom = { x: x + lerpEdge(bl, br) * cell, y: y + cell }
			const left = { x, y: y + lerpEdge(tl, bl) * cell }

			const push = (a: { x: number; y: number }, b: { x: number; y: number }) =>
				segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y })

			switch (code) {
				case 1:
					push(left, top)
					break
				case 2:
					push(top, right)
					break
				case 3:
					push(left, right)
					break
				case 4:
					push(right, bottom)
					break
				case 5: {
					// Diagonal ambiguity: the middle of the cell decides whether the two inside corners
					// are joined through it or separated by it. Averaging the corners is the standard
					// resolution and is right for a field as smooth as this one.
					const middle = (tl + tr + br + bl) / 4
					if (middle < iso) {
						push(left, top)
						push(right, bottom)
					} else {
						push(left, bottom)
						push(right, top)
					}
					break
				}
				case 6:
					push(top, bottom)
					break
				case 7:
					push(left, bottom)
					break
				case 8:
					push(bottom, left)
					break
				case 9:
					push(bottom, top)
					break
				case 10: {
					const middle = (tl + tr + br + bl) / 4
					if (middle < iso) {
						push(top, right)
						push(bottom, left)
					} else {
						push(top, left)
						push(bottom, right)
					}
					break
				}
				case 11:
					push(bottom, right)
					break
				case 12:
					push(right, left)
					break
				case 13:
					push(right, top)
					break
				case 14:
					push(top, left)
					break
			}
		}
	}
	return segments
}

/**
 * Joins a soup of segments into closed loops.
 *
 * Marching squares emits each cell's crossings independently, so the segments arrive unordered; a loop
 * is what you get by following one segment's end to the next segment's start. Endpoints are matched on
 * a quantised key because two cells compute the same crossing point through different arithmetic and
 * the results differ in the last bits.
 *
 * Open runs are kept as well as closed ones: a contour clipped by the edge of the sampled box is a
 * real line that should still be drawn, just not filled.
 */
function stitch(
	segments: { ax: number; ay: number; bx: number; by: number }[],
	tolerance: number
): { x: number; y: number }[][] {
	const key = (x: number, y: number) =>
		`${Math.round(x / tolerance)},${Math.round(y / tolerance)}`

	const startingAt = new Map<string, number[]>()
	segments.forEach((segment, index) => {
		const k = key(segment.ax, segment.ay)
		const list = startingAt.get(k)
		if (list) list.push(index)
		else startingAt.set(k, [index])
	})

	const used = new Array<boolean>(segments.length).fill(false)
	const loops: { x: number; y: number }[][] = []

	for (let seed = 0; seed < segments.length; seed++) {
		if (used[seed]) continue
		used[seed] = true
		const first = segments[seed]!
		const points: { x: number; y: number }[] = [
			{ x: first.ax, y: first.ay },
			{ x: first.bx, y: first.by },
		]

		// Follow the chain forwards until it closes, runs out, or hits the safety bound.
		for (let step = 0; step < segments.length; step++) {
			const tail = points[points.length - 1]!
			const candidates = startingAt.get(key(tail.x, tail.y))
			const next = candidates?.find((index) => !used[index])
			if (next === undefined) break
			used[next] = true
			const segment = segments[next]!
			points.push({ x: segment.bx, y: segment.by })
			if (key(segment.bx, segment.by) === key(first.ax, first.ay)) break
		}

		// Three points is the smallest thing worth drawing; anything less is a stray crossing.
		if (points.length > 3) loops.push(points)
	}

	return loops
}

/**
 * The outward direction at a point, from the field's own gradient.
 *
 * A signed distance grows as you move away from the shapes, so its gradient points outward by
 * definition — no need to know which way round the loop was walked, and holes get an "outward" that
 * points into the hole, which is exactly right.
 */
function outwardAt(
	field: (x: number, y: number) => number,
	x: number,
	y: number
): { nx: number; ny: number } {
	const h = 0.75
	const dx = field(x + h, y) - field(x - h, y)
	const dy = field(x, y + h) - field(x, y - h)
	const length = Math.hypot(dx, dy)
	return length === 0 ? { nx: 0, ny: -1 } : { nx: dx / length, ny: dy / length }
}

/**
 * The merged outline around some shapes, as loops of points with outward normals.
 *
 * `offset` is how far outside the shapes the line runs. Everything returned is in the same coordinates
 * the boxes came in.
 */
export function auraLoops(
	shapes: FieldShapes,
	offset: number,
	merge: number,
	pad: number
): ContourPoint[][] {
	const { boxes, capsules } = shapes
	if (!boxes.length && !capsules.length) return []

	let minX = Infinity
	let minY = Infinity
	let maxX = -Infinity
	let maxY = -Infinity
	for (const box of boxes) {
		minX = Math.min(minX, box.x)
		minY = Math.min(minY, box.y)
		maxX = Math.max(maxX, box.x + box.w)
		maxY = Math.max(maxY, box.y + box.h)
	}
	for (const capsule of capsules) {
		minX = Math.min(minX, capsule.ax - capsule.r, capsule.bx - capsule.r)
		minY = Math.min(minY, capsule.ay - capsule.r, capsule.by - capsule.r)
		maxX = Math.max(maxX, capsule.ax + capsule.r, capsule.bx + capsule.r)
		maxY = Math.max(maxY, capsule.ay + capsule.r, capsule.by + capsule.r)
	}
	// The sampled area has to hold the contour itself, plus whatever the noise will add to it later.
	minX -= pad
	minY -= pad
	maxX += pad
	maxY += pad

	const width = maxX - minX
	const height = maxY - minY
	const cell = cellSizeFor(width, height, boxes.length + capsules.length)
	const cols = Math.ceil(width / cell) + 1
	const rows = Math.ceil(height / cell) + 1

	const field = distanceField(shapes, merge)
	const values = new Float32Array(cols * rows)
	for (let j = 0; j < rows; j++) {
		for (let i = 0; i < cols; i++) {
			values[j * cols + i] = field(minX + i * cell, minY + j * cell)
		}
	}

	const segments = marchingSquares(values, cols, rows, minX, minY, cell, offset)
	return stitch(segments, cell / 8).map((loop) =>
		loop.map((point) => ({ ...point, ...outwardAt(field, point.x, point.y) }))
	)
}
