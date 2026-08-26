import type { DieKind } from '../kinds'
import { readingMode } from './faces'
import { centroid, cross, dot, faceNormals, normalise, solidFor, sub, type Vec3 } from './solids'

/**
 * Where things sit *on* a face: the texture coordinates of its corners, and where its numbers go.
 *
 * One module for both, because they are the same question asked twice. The mesh needs UVs so a face
 * samples its own texture; the texture generator needs to know where in that image the face's corners
 * ended up, so it can put a numeral at one. Deriving them separately is how a number ends up half over
 * an edge.
 */

export type UV = readonly [number, number]

/** How much of the texture the face fills. The rest is margin, so a numeral never touches an edge. */
const FIT = 0.86

export interface FaceLayout {
	/** One UV per vertex of the face, in the face's own winding order. */
	uvs: UV[]
	/** Where numbers go, and how they are turned. */
	marks: Mark[]
	/**
	 * The radius of the largest circle that fits inside the face, in texture units — centred on the
	 * face's own incircle, which for a kite is not its centroid.
	 *
	 * This is what a numeral has to be sized against, and getting it wrong is why a d20 was unreadable:
	 * sizing the type as a fraction of the *texture* makes it far too big for a triangle, whose incircle
	 * is less than half its circumradius. The numbers then ran to the edges of every face, and five side
	 * faces were as loud as the one on top — so people read the wrong number off the die.
	 */
	inradius: number
}

export interface Mark {
	/** Which label this mark shows — an index into the die's label list. */
	label: number
	uv: UV
	/** Radians, clockwise in texture space. Non-zero only where a mark has to read outward. */
	rotation: number
}

/**
 * Flattens a face into its own plane.
 *
 * A basis on the face — one axis toward its first corner, the other perpendicular — turns the polygon
 * into 2D coordinates, which are then scaled so the corner furthest from the middle lands at `FIT/2`
 * from the centre of the texture. Faces of the same solid are congruent, so every one of them fills its
 * image identically.
 */
function flatten(vertices: readonly Vec3[], face: readonly number[], normal: Vec3): UV[] {
	const points = face.map((i) => vertices[i]!)
	const middle = centroid(points)
	const tangent = normalise(sub(points[0]!, middle))
	const bitangent = cross(normal, tangent)

	const planar = points.map((p) => {
		const d = sub(p, middle)
		return [dot(d, tangent), dot(d, bitangent)] as const
	})
	const radius = Math.max(...planar.map(([x, y]) => Math.hypot(x, y)))
	return planar.map(([x, y]) => [0.5 + (FIT * x) / (2 * radius), 0.5 + (FIT * y) / (2 * radius)])
}

/**
 * Pulls a corner mark in toward the middle of the face, so the numeral sits inside the shape rather
 * than on its point.
 *
 * There are two ways to get this wrong and they pull in opposite directions. Too little and the numeral
 * sits on the corner itself, where the triangle has narrowed to a point and the glyph is clipped by two
 * edges at once. Too much and the three marks on one face crowd into the middle and collide. With marks
 * this small there is a lot of room between those, and 0.4 is comfortably inside it.
 */
const CORNER_INSET = 0.46

/** How far a point is from the nearest edge of the polygon. Negative outside it. */
function clearance(uvs: readonly UV[], px: number, py: number): number {
	let smallest = Infinity
	for (let i = 0; i < uvs.length; i++) {
		const [ax, ay] = uvs[i]!
		const [bx, by] = uvs[(i + 1) % uvs.length]!
		const ex = bx - ax
		const ey = by - ay
		const len = Math.hypot(ex, ey)
		if (len === 0) continue
		smallest = Math.min(smallest, Math.abs(ex * (ay - py) - ey * (ax - px)) / len)
	}
	return smallest
}

/**
 * The largest circle that fits inside the polygon, and where its middle is.
 *
 * Not the centroid. For a regular face the two coincide, but the d10's faces are **kites** — wide at the
 * shoulders, tapering to a point — and their centroid sits nearer the point than the widest part of the
 * shape, so a numeral centred on it looks pushed toward the tip and has less room than it could have.
 *
 * Found by a coarse-to-fine search rather than solved: this is the Chebyshev centre of a polygon, which
 * has no closed form worth writing here, and it is computed once per face per die kind.
 */
function incircleOf(uvs: readonly UV[]): { centre: UV; radius: number } {
	let best: UV = [0.5, 0.5]
	let bestRadius = clearance(uvs, 0.5, 0.5)
	// Enough halvings that the final step is well under a texture pixel: for a regular face the answer is
	// exactly the centroid, and a search that stopped early would leave the numeral visibly off it.
	let step = 0.12
	for (let pass = 0; pass < 12; pass++) {
		let improved = true
		while (improved) {
			improved = false
			for (const [dx, dy] of [
				[step, 0],
				[-step, 0],
				[0, step],
				[0, -step],
			] as const) {
				const radius = clearance(uvs, best[0] + dx, best[1] + dy)
				if (radius > bestRadius) {
					best = [best[0] + dx, best[1] + dy]
					bestRadius = radius
					improved = true
				}
			}
		}
		step /= 2
	}
	return { centre: best, radius: bestRadius }
}

/**
 * The layout of every face of a solid.
 *
 * Two shapes of answer, matching the two ways a die is read (`readingMode`):
 *
 *  - **Faces** — one numeral in the middle. Six of the seven dice.
 *  - **Corners** — the d4, which is read at its apex, so each face carries a numeral at each of its
 *    three corners and whichever corner points up has the same number on all three faces around it.
 *    That is how a real four-sider is marked, and the reason it is marked that way is that a
 *    tetrahedron at rest has no face on top to print anything on.
 */
export function faceLayouts(kind: DieKind): FaceLayout[] {
	const { vertices, faces } = solidFor(kind)
	const normals = faceNormals(kind)
	const byVertex = readingMode(kind) === 'vertex'

	return faces.map((face, faceIndex) => {
		const uvs = flatten(vertices, face, normals[faceIndex]!)
		const { centre, radius: inradius } = incircleOf(uvs)
		if (!byVertex) {
			return { uvs, inradius, marks: [{ label: faceIndex, uv: centre, rotation: 0 }] }
		}
		// A mark per corner, labelled by the *vertex* it sits at and turned to read outward from the
		// middle of the face — which is how the three faces meeting at a corner all show it upright.
		const marks: Mark[] = face.map((vertexIndex, corner) => {
			const [u, v] = uvs[corner]!
			const dx = u - centre[0]
			const dy = v - centre[1]
			return {
				label: vertexIndex,
				uv: [centre[0] + dx * (1 - CORNER_INSET), centre[1] + dy * (1 - CORNER_INSET)] as UV,
				// `atan2(dx, dy)` rather than `(dy, dx)`: a mark at the top of the face reads upright, and
				// the others turn with their corner.
				rotation: Math.atan2(dx, dy),
			}
		})
		return { uvs, inradius, marks }
	})
}
