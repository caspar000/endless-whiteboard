import type { DieKind } from '../kinds'
import { dot, faceNormals, normalise, solidFor, type Vec3 } from './solids'

/**
 * Which face landed up, and what number it should be showing.
 *
 * These two functions are the whole of "the roll is decided by the random number generator and the
 * physics is theatre". The simulation is allowed to land wherever it likes; afterwards we ask it which
 * face is up, and then *renumber the die* so that face carries the value already drawn from
 * `crypto.getRandomValues`. Nobody can tell, because the renumbering happens before a single frame is
 * drawn — and it is the only way to have both an honest, uniform roll and real tumbling dice.
 *
 * It is also what makes the whole feature testable and skippable. The outcome exists before the
 * animation does, so `prefers-reduced-motion` is "don't play the animation" rather than a second code
 * path with its own idea of what was rolled.
 *
 * Both are pure and know nothing about three.js or cannon-es: they take a plain quaternion, so the
 * physics engine could be replaced without touching them.
 */

export interface Quat {
	x: number
	y: number
	z: number
	w: number
}

/** Up, in the world this rolls in: page x and y lie on the paper, z is height above it. */
export const UP: Vec3 = [0, 0, 1]

/** Rotates a vector by a quaternion. The standard `v + 2w(q×v) + 2q×(q×v)` form. */
export function applyQuat(v: Vec3, q: Quat): Vec3 {
	const [x, y, z] = v
	// t = 2 * (q_vec × v)
	const tx = 2 * (q.y * z - q.z * y)
	const ty = 2 * (q.z * x - q.x * z)
	const tz = 2 * (q.x * y - q.y * x)
	return [
		x + q.w * tx + (q.y * tz - q.z * ty),
		y + q.w * ty + (q.z * tx - q.x * tz),
		z + q.w * tz + (q.x * ty - q.y * tx),
	]
}

/**
 * How a die is read.
 *
 * Six of the seven are read off the face that ends up on top. The **d4 is not, and cannot be**: a
 * tetrahedron at rest sits on a face and points a *vertex* at the ceiling — its four face normals end up
 * one straight down and three barely above horizontal, so "which face is up" has no good answer and
 * every roll looked permanently cocked. Real four-siders solve it the same way, by printing a number at
 * each corner and having you read the one at the apex.
 *
 * Found by the "lands with a face properly up" test, which rejected every d4 throw it was given.
 */
export type ReadingMode = 'face' | 'vertex'

export function readingMode(kind: DieKind): ReadingMode {
	return kind === 'd4' ? 'vertex' : 'face'
}

/**
 * The directions a reading picks between: one per face, or one per vertex for the d4.
 *
 * Indexed the same way the die's labels are, which is what lets everything downstream — the settle
 * check, the relabelling, the textures — stay indifferent to which mode a die uses.
 */
export function readingNormals(kind: DieKind): Vec3[] {
	if (readingMode(kind) === 'face') return faceNormals(kind)
	// The solids are centred on the origin, so a vertex's direction from the centre *is* its outward
	// normal — which for a tetrahedron is exactly the apex direction you read.
	return solidFor(kind).vertices.map((v) => normalise(v))
}

export interface UpFace {
	/** Index into the die's reading directions — a face, or a vertex for the d4. */
	index: number
	/**
	 * How squarely it faces the sky: `1` is dead flat, `0` is on its edge.
	 *
	 * This is what "cocked" is measured with. A die resting against another one, or on the lip of a
	 * shape, has no face properly up, and reading a number off it would be inventing one.
	 */
	alignment: number
}

/**
 * The face — or, for a d4, the corner — pointing most nearly upward.
 *
 * Every reading direction is rotated into world space and compared against up; the largest wins. There
 * is no cleverer way to do this and no need for one: twenty dot products per die, once, after it stops.
 */
export function upFace(kind: DieKind, orientation: Quat): UpFace {
	const normals = readingNormals(kind)
	let best: UpFace = { index: 0, alignment: -Infinity }
	normals.forEach((normal, index) => {
		const alignment = dot(applyQuat(normal, orientation), UP)
		if (alignment > best.alignment) best = { index, alignment }
	})
	return best
}

/**
 * How square a face has to be to the sky before we will read a number off it.
 *
 * `cos 20°`. A d20's faces are only 41° apart to begin with, so this is not a generous threshold in
 * terms of how tilted a die may be — it is generous enough to accept a die that has settled on a flat
 * floor with a little numerical jitter, and mean enough to reject one leaning on its neighbour.
 */
const FLAT_ENOUGH = Math.cos((20 * Math.PI) / 180)

export function isCocked(face: UpFace): boolean {
	return face.alignment < FLAT_ENOUGH
}

/**
 * The labels each face should carry so that `settledIndex` ends up showing `labels[wantedIndex]`.
 *
 * A **rotation** of the natural order rather than an arbitrary permutation, and that matters for one
 * reason: the faces you can see beside the top one stay in a plausible relationship to it. A random
 * shuffle would put 19 next to 20 half the time and next to 3 the rest, and a d20 whose neighbours
 * changed between rolls is a d20 somebody will eventually notice is fake.
 *
 * Generic in the label because a percentile die's tens face reads `00`, not `0` or `100` — see
 * `physical.ts`. The die's *geometry* does not care what is printed on it.
 */
export function rotateLabels<T>(
	labels: readonly T[],
	settledIndex: number,
	wantedIndex: number
): T[] {
	const count = labels.length
	if (wantedIndex < 0 || wantedIndex >= count) {
		throw new Error(`rotateLabels: no face ${wantedIndex} on a ${count}-sided die`)
	}
	const shift = (((settledIndex - wantedIndex) % count) + count) % count
	return labels.map((_, i) => labels[(i - shift + count) % count]!)
}
