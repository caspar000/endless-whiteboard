/**
 * Strokes for the GPU layer (docs/gpu-renderer-plan.md, phase 3): an SVG path, as the page strokes
 * it, turned into triangles once (zoom changes nothing here; widths and antialiasing are the shader's).
 *
 * - `flattenPath`: SVG path data (M L H V Q C A Z, absolute or relative) into polylines, curves and arcs cut
 *   finely enough that no chord strays from the curve by more than `tolerance`.
 * - `dashPolylines`: the SVG dash pattern laid along them by length, as `stroke-dasharray` does.
 * - `strokeTriangles`: each polyline as one strip with round joins and round caps, no part of it
 *   covering another (two overlapping pieces would double the antialiased rim wherever they meet).
 */

export interface Polyline {
	/** x, y, x, y… */
	points: number[]
	closed: boolean
}

const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi

export function flattenPath(d: string, tolerance = 0.02): Polyline[] {
	const out: Polyline[] = []
	let cur: Polyline | null = null
	let x = 0
	let y = 0
	let sx = 0
	let sy = 0
	const tokens = d.match(/[MLHVQCAZ][^MLHVQCAZ]*/gi) ?? []
	const lineTo = (nx: number, ny: number) => {
		if (!cur) {
			cur = { points: [x, y], closed: false }
			out.push(cur)
		}
		cur.points.push(nx, ny)
		x = nx
		y = ny
	}
	for (const token of tokens) {
		const cmd = token[0]!.toUpperCase()
		const n = (token.slice(1).match(NUM) ?? []).map(Number)
		// Relative commands: every coordinate pair taken from where the pen is, as absolute ones.
		if (token[0] !== cmd) toAbsolute(cmd, n, x, y)
		switch (cmd) {
			case 'M':
				x = sx = n[0]!
				y = sy = n[1]!
				cur = { points: [x, y], closed: false }
				out.push(cur)
				for (let i = 2; i + 1 < n.length; i += 2) lineTo(n[i]!, n[i + 1]!)
				break
			case 'L':
				for (let i = 0; i + 1 < n.length; i += 2) lineTo(n[i]!, n[i + 1]!)
				break
			case 'H':
				for (const v of n) lineTo(v, y)
				break
			case 'V':
				for (const v of n) lineTo(x, v)
				break
			case 'Q':
				for (let i = 0; i + 3 < n.length; i += 4) {
					const [cx, cy, ex, ey] = [n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!]
					const steps = curveSteps(Math.hypot(cx - x, cy - y) + Math.hypot(ex - cx, ey - cy), tolerance)
					const [x0, y0] = [x, y]
					for (let s = 1; s <= steps; s++) {
						const t = s / steps
						const u = 1 - t
						lineTo(u * u * x0 + 2 * u * t * cx + t * t * ex, u * u * y0 + 2 * u * t * cy + t * t * ey)
					}
				}
				break
			case 'C':
				for (let i = 0; i + 5 < n.length; i += 6) {
					const [c1x, c1y, c2x, c2y, ex, ey] = [n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]!, n[i + 4]!, n[i + 5]!]
					const steps = curveSteps(Math.hypot(c1x - x, c1y - y) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(ex - c2x, ey - c2y), tolerance)
					const [x0, y0] = [x, y]
					for (let s = 1; s <= steps; s++) {
						const t = s / steps
						const u = 1 - t
						lineTo(
							u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * ex,
							u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * ey
						)
					}
				}
				break
			case 'A':
				for (let i = 0; i + 6 < n.length; i += 7) {
					arcTo(x, y, n[i]!, n[i + 1]!, n[i + 2]!, n[i + 3]! !== 0, n[i + 4]! !== 0, n[i + 5]!, n[i + 6]!, tolerance, lineTo)
					x = n[i + 5]!
					y = n[i + 6]!
				}
				break
			case 'Z':
				if (cur) {
					const pts: number[] = (cur as Polyline).points
					if (pts.length >= 4 && (pts[pts.length - 2] !== sx || pts[pts.length - 1] !== sy)) pts.push(sx, sy)
					;(cur as Polyline).closed = true
				}
				x = sx
				y = sy
				cur = null
				break
		}
	}
	return out.filter((p) => p.points.length >= 2)
}

/**
 * A relative command's numbers made absolute, in place. Each repeat of a command's arguments starts
 * from where the previous one ended; an arc's radii, rotation and flags aren't coordinates.
 */
function toAbsolute(cmd: string, n: number[], x: number, y: number) {
	const per = { M: 2, L: 2, H: 1, V: 1, Q: 4, C: 6, A: 7, Z: 0 }[cmd] ?? 0
	for (let i = 0; per && i + per <= n.length; i += per) {
		if (cmd === 'H') n[i] = x = n[i]! + x
		else if (cmd === 'V') n[i] = y = n[i]! + y
		else if (cmd === 'A') {
			n[i + 5] = n[i + 5]! + x
			n[i + 6] = n[i + 6]! + y
			x = n[i + 5]!
			y = n[i + 6]!
		} else {
			for (let k = 0; k < per; k += 2) {
				n[i + k] = n[i + k]! + x
				n[i + k + 1] = n[i + k + 1]! + y
			}
			x = n[i + per - 2]!
			y = n[i + per - 1]!
		}
	}
}

/** Enough steps that a curve of this rough length keeps within `tolerance` of its chords. */
function curveSteps(length: number, tolerance: number): number {
	return Math.max(1, Math.min(512, Math.ceil(Math.sqrt(length / tolerance) * 0.5)))
}

/** SVG's endpoint arc, as points along it (SVG 1.1, F.6.5). */
function arcTo(
	x1: number,
	y1: number,
	rx: number,
	ry: number,
	rotationDeg: number,
	large: boolean,
	sweep: boolean,
	x2: number,
	y2: number,
	tolerance: number,
	lineTo: (x: number, y: number) => void
) {
	if (rx === 0 || ry === 0 || !Number.isFinite(rx) || !Number.isFinite(ry)) return lineTo(x2, y2)
	rx = Math.abs(rx)
	ry = Math.abs(ry)
	const phi = (rotationDeg * Math.PI) / 180
	const cos = Math.cos(phi)
	const sin = Math.sin(phi)
	const dx = (x1 - x2) / 2
	const dy = (y1 - y2) / 2
	const x1p = cos * dx + sin * dy
	const y1p = -sin * dx + cos * dy
	const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
	if (lambda > 1) {
		rx *= Math.sqrt(lambda)
		ry *= Math.sqrt(lambda)
	}
	const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
	const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
	const coef = (large !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den))
	const cxp = (coef * rx * y1p) / ry
	const cyp = (-coef * ry * x1p) / rx
	const cx = cos * cxp - sin * cyp + (x1 + x2) / 2
	const cy = sin * cxp + cos * cyp + (y1 + y2) / 2
	const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
	const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
	let delta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry)
	if (!sweep && delta > 0) delta -= 2 * Math.PI
	else if (sweep && delta < 0) delta += 2 * Math.PI
	const r = Math.max(rx, ry)
	const perStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / r)))
	const steps = Math.max(1, Math.min(2048, Math.ceil(Math.abs(delta) / Math.max(perStep, 1e-4))))
	for (let s = 1; s <= steps; s++) {
		const t = theta1 + (delta * s) / steps
		const ex = rx * Math.cos(t)
		const ey = ry * Math.sin(t)
		lineTo(s === steps ? x2 : cos * ex - sin * ey + cx, s === steps ? y2 : sin * ex + cos * ey + cy)
	}
}

/**
 * The dash pattern along each polyline by length, as `stroke-dasharray` and `stroke-dashoffset` lay
 * it: dashes, gaps, dashes…, the pattern starting `offset` into itself. A dash shorter than a hair
 * stays as a point (it's drawn as a dot by its round caps).
 */
export function dashPolylines(lines: Polyline[], array: readonly number[], offset: number): Polyline[] {
	const pattern = array.length % 2 ? [...array, ...array] : [...array]
	const period = pattern.reduce((a, b) => a + b, 0)
	if (!(period > 0)) return lines
	const out: Polyline[] = []
	for (const line of lines) {
		const p = line.points
		// Where in the pattern the line starts.
		let into = ((offset % period) + period) % period
		let k = 0
		while (into >= pattern[k]!) {
			into -= pattern[k]!
			k = (k + 1) % pattern.length
		}
		let left = pattern[k]! - into
		let on = k % 2 === 0
		let dash: number[] | null = on ? [p[0]!, p[1]!] : null
		for (let i = 0; i + 3 < p.length; i += 2) {
			let ax = p[i]!
			let ay = p[i + 1]!
			const bx = p[i + 2]!
			const by = p[i + 3]!
			let seg = Math.hypot(bx - ax, by - ay)
			while (seg > 0) {
				const step = Math.min(left, seg)
				const t = step / seg
				const nx = ax + (bx - ax) * t
				const ny = ay + (by - ay) * t
				if (on) dash!.push(nx, ny)
				seg -= step
				left -= step
				ax = nx
				ay = ny
				if (left <= 1e-9) {
					if (on && dash) out.push({ points: dash.length >= 4 ? dash : [dash[0]!, dash[1]!, dash[0]!, dash[1]!], closed: false })
					k = (k + 1) % pattern.length
					left = pattern[k]!
					on = k % 2 === 0
					dash = on ? [ax, ay] : null
				}
			}
		}
		// A dash that starts exactly where the line ends has no length, and the browser draws nothing for it.
		if (on && dash && dash.length >= 4) out.push({ points: dash, closed: false })
	}
	return out
}

/** Floats per stroke vertex: position (2), offset (2), as the shader reads them. */
export const STROKE_VERTEX_FLOATS = 4

/**
 * Each polyline as triangles: a strip along it, round joins on the outer side of each bend, round caps
 * at open ends. Every vertex is a point of the line and an offset from it of length 1 at the edge (the
 * shader scales it by the half width and a pixel more for the antialiased rim, so the same triangles
 * serve any width and zoom); the offset's length at a pixel is how far across the stroke it lies.
 */
export function strokeTriangles(lines: Polyline[], pad = 1): number[] {
	const v: number[] = []
	const tri = (ax: number, ay: number, aox: number, aoy: number, bx: number, by: number, box: number, boy: number, cx: number, cy: number, cox: number, coy: number) =>
		v.push(ax, ay, aox, aoy, bx, by, box, boy, cx, cy, cox, coy)
	const FAN = 12
	/** A wedge of a round piece at (x, y), from angle a0 through da. */
	const fan = (x: number, y: number, a0: number, da: number) => {
		const steps = Math.max(1, Math.ceil((Math.abs(da) / Math.PI) * FAN))
		// Rim vertices pushed out so the chords stay outside the circle.
		const r = pad / Math.cos(Math.abs(da) / steps / 2)
		for (let s = 0; s < steps; s++) {
			const t0 = a0 + (da * s) / steps
			const t1 = a0 + (da * (s + 1)) / steps
			tri(x, y, 0, 0, x, y, Math.cos(t0) * r, Math.sin(t0) * r, x, y, Math.cos(t1) * r, Math.sin(t1) * r)
		}
	}
	for (const line of lines) {
		const p = line.points
		// Drop repeated points: a zero-length segment has no direction.
		const pts: number[] = [p[0]!, p[1]!]
		for (let i = 2; i + 1 < p.length; i += 2) {
			if (Math.hypot(p[i]! - pts[pts.length - 2]!, p[i + 1]! - pts[pts.length - 1]!) > 1e-6) pts.push(p[i]!, p[i + 1]!)
		}
		const n = pts.length / 2
		if (n === 1) {
			// A dot: a whole round cap.
			fan(pts[0]!, pts[1]!, 0, Math.PI * 2)
			continue
		}
		const dir = (i: number) => {
			const dx = pts[i * 2 + 2]! - pts[i * 2]!
			const dy = pts[i * 2 + 3]! - pts[i * 2 + 1]!
			const len = Math.hypot(dx, dy)
			return [dx / len, dy / len] as const
		}
		const closed = line.closed && n > 2
		for (let i = 0; i < n - 1; i++) {
			const [dx, dy] = dir(i)
			const nx = -dy * pad
			const ny = dx * pad
			const ax = pts[i * 2]!
			const ay = pts[i * 2 + 1]!
			const bx = pts[i * 2 + 2]!
			const by = pts[i * 2 + 3]!
			tri(ax, ay, nx, ny, bx, by, nx, ny, bx, by, -nx, -ny)
			tri(ax, ay, nx, ny, bx, by, -nx, -ny, ax, ay, -nx, -ny)
		}
		// Joins: a wedge on the outer side of each bend, from one segment's edge to the next's.
		const join = (i: number, prev: readonly [number, number], next: readonly [number, number]) => {
			const cross = prev[0] * next[1] - prev[1] * next[0]
			const dot = prev[0] * next[0] + prev[1] * next[1]
			const turn = Math.atan2(cross, dot)
			if (Math.abs(turn) < 1e-6) return
			// Outer side: left of travel when turning right, and the other way round.
			const a0 = Math.atan2(prev[0], -prev[1]) + (turn > 0 ? Math.PI : 0)
			fan(pts[i * 2]!, pts[i * 2 + 1]!, a0, turn)
		}
		for (let i = 1; i < n - 1; i++) join(i, dir(i - 1), dir(i))
		if (closed) {
			join(n - 1, dir(n - 2), dir(0))
		} else {
			// Round caps: half a circle beyond each end.
			const [sdx, sdy] = dir(0)
			fan(pts[0]!, pts[1]!, Math.atan2(sdx, -sdy), Math.PI)
			const [edx, edy] = dir(n - 2)
			fan(pts[(n - 1) * 2]!, pts[(n - 1) * 2 + 1]!, Math.atan2(-edx, edy), Math.PI)
		}
	}
	return v
}
