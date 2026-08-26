import { DIE_KINDS, facesOf, type DieKind } from '../kinds'

/**
 * The dice, as solids: a table of vertices and a table of faces, per kind.
 *
 * Deliberately data rather than three.js geometry. Everything else in this folder is derived from
 * these two arrays — the render mesh, the physics hull, the face normals used to read which side
 * landed up — so there is exactly one description of what a d20 *is* and no way for the picture and
 * the physics to disagree about it.
 *
 * The tables are the standard ones (the lineage runs back through `threejs-dice` to Anton Natarov's
 * 2013 roller). `threejs-dice` itself cannot be a dependency: it is a UMD script written against
 * `THREE.Geometry`, which three.js removed in r125.
 *
 * **Face order is the numbering.** Face `i` carries value `i + 1`, which is why nothing here needs a
 * separate label table — and why reordering a face list would silently renumber a die.
 *
 * Face *winding* is normalised on the way out (see `orient`), so the tables below may be transcribed
 * in whichever direction the source had them.
 */

export type Vec3 = readonly [number, number, number]

export interface Solid {
	/** Unit-ish, centred on the origin. Scaled to the die's real size when the mesh is built. */
	vertices: readonly Vec3[]
	/** One entry per numbered face, each a loop of vertex indices in counter-clockwise order. */
	faces: readonly (readonly number[])[]
}

const PHI = (1 + Math.sqrt(5)) / 2

/**
 * The d10 is a pentagonal trapezohedron, and the only solid here that is built rather than tabulated.
 *
 * Ten congruent kite faces: two rings of five vertices alternating above and below the equator, and an
 * apex at each pole. Each kite is `apex → e[i-1] → e[i] → e[i+1]`, so the five faces round the north
 * pole take the odd equator vertices as their tips and the southern five take the even ones.
 *
 * `D10_OFFSET` is how far the equator vertices sit above and below the waist, and there is exactly one
 * value at which the kites come out *flat*. Solving for it beats the 0.105 the source tables carry:
 *
 * Take the kite whose tip is at angle 0, so its four corners are the apex `(0,0,1)`, the tip
 * `(1,0,-h)`, and its two neighbours at ±36° and `z = +h`. The neighbours are mirror images in y, so
 * the plane through them and the apex has a normal with no y component, and requiring the tip to lie on
 * that plane reduces to `(1 + cos36°)·h = 1 - cos36°`. With `cos36° = φ/2` that is `h = (2 - φ)/(2 + φ)`
 * ≈ 0.10557 — close enough to 0.105 that the difference never shows, and exact enough that the
 * planarity and convexity tests need no tolerance at all.
 */
const D10_OFFSET = (2 - PHI) / (2 + PHI)

function pentagonalTrapezohedron(): Solid {
	const vertices: Vec3[] = []
	for (let i = 0; i < 10; i++) {
		const angle = (i * Math.PI * 2) / 10
		vertices.push([Math.cos(angle), Math.sin(angle), i % 2 ? D10_OFFSET : -D10_OFFSET])
	}
	// The poles, last, so the equator keeps indices 0–9.
	const north = vertices.push([0, 0, -1]) - 1
	const south = vertices.push([0, 0, 1]) - 1

	const faces: number[][] = []
	for (let i = 0; i < 10; i++) {
		const apex = i % 2 ? north : south
		const prev = (i + 9) % 10
		const next = (i + 1) % 10
		faces.push([apex, vertices[i]![2] > 0 ? prev : next, i, vertices[i]![2] > 0 ? next : prev])
	}
	return { vertices, faces }
}

const RAW: Record<DieKind, Solid> = {
	d4: {
		vertices: [
			[1, 1, 1],
			[-1, -1, 1],
			[-1, 1, -1],
			[1, -1, -1],
		],
		faces: [
			[1, 0, 2],
			[0, 1, 3],
			[2, 3, 0],
			[3, 2, 1],
		],
	},
	d6: {
		vertices: [
			[-1, -1, -1],
			[1, -1, -1],
			[1, 1, -1],
			[-1, 1, -1],
			[-1, -1, 1],
			[1, -1, 1],
			[1, 1, 1],
			[-1, 1, 1],
		],
		faces: [
			[0, 3, 2, 1],
			[1, 2, 6, 5],
			[0, 1, 5, 4],
			[3, 7, 6, 2],
			[0, 4, 7, 3],
			[4, 5, 6, 7],
		],
	},
	d8: {
		vertices: [
			[1, 0, 0],
			[-1, 0, 0],
			[0, 1, 0],
			[0, -1, 0],
			[0, 0, 1],
			[0, 0, -1],
		],
		faces: [
			[0, 2, 4],
			[0, 4, 3],
			[0, 3, 5],
			[0, 5, 2],
			[1, 3, 4],
			[1, 4, 2],
			[1, 2, 5],
			[1, 5, 3],
		],
	},
	d10: pentagonalTrapezohedron(),
	d12: {
		vertices: [
			[0, 1 / PHI, PHI],
			[0, 1 / PHI, -PHI],
			[0, -1 / PHI, PHI],
			[0, -1 / PHI, -PHI],
			[PHI, 0, 1 / PHI],
			[PHI, 0, -1 / PHI],
			[-PHI, 0, 1 / PHI],
			[-PHI, 0, -1 / PHI],
			[1 / PHI, PHI, 0],
			[1 / PHI, -PHI, 0],
			[-1 / PHI, PHI, 0],
			[-1 / PHI, -PHI, 0],
			[1, 1, 1],
			[1, 1, -1],
			[1, -1, 1],
			[1, -1, -1],
			[-1, 1, 1],
			[-1, 1, -1],
			[-1, -1, 1],
			[-1, -1, -1],
		],
		faces: [
			[2, 14, 4, 12, 0],
			[15, 9, 11, 19, 3],
			[16, 10, 17, 7, 6],
			[6, 7, 19, 11, 18],
			[6, 18, 2, 0, 16],
			[18, 11, 9, 14, 2],
			[1, 17, 10, 8, 13],
			[1, 13, 5, 15, 3],
			[13, 8, 12, 4, 5],
			[5, 4, 14, 9, 15],
			[0, 12, 8, 10, 16],
			[3, 19, 7, 17, 1],
		],
	},
	d20: {
		vertices: [
			[-1, PHI, 0],
			[1, PHI, 0],
			[-1, -PHI, 0],
			[1, -PHI, 0],
			[0, -1, PHI],
			[0, 1, PHI],
			[0, -1, -PHI],
			[0, 1, -PHI],
			[PHI, 0, -1],
			[PHI, 0, 1],
			[-PHI, 0, -1],
			[-PHI, 0, 1],
		],
		faces: [
			[0, 11, 5],
			[0, 5, 1],
			[0, 1, 7],
			[0, 7, 10],
			[0, 10, 11],
			[1, 5, 9],
			[5, 11, 4],
			[11, 10, 2],
			[10, 7, 6],
			[7, 1, 8],
			[3, 9, 4],
			[3, 4, 2],
			[3, 2, 6],
			[3, 6, 8],
			[3, 8, 9],
			[4, 9, 5],
			[2, 4, 11],
			[6, 2, 10],
			[8, 6, 7],
			[9, 8, 1],
		],
	},
	// A percentile die *is* a d10; only its markings differ, and those live in the texture.
	d100: pentagonalTrapezohedron(),
}

/**
 * Turns every face the same way round: counter-clockwise seen from outside the solid.
 *
 * Not tidying. The tables come from a lineage that only ever used them to *draw* — and one of them, the
 * d4's third face, is wound the other way. Left alone, triangulating that face produces triangles
 * facing into the die, which back-face culling then removes: a tetrahedron with a hole in it. Deriving
 * the direction from the geometry rather than trusting the transcription also means the next table
 * anyone adds cannot introduce the same bug.
 *
 * The test for it is "has convex faces, wound consistently", which is what caught the d4.
 */
function orient(solid: Solid): Solid {
	const { vertices, faces } = solid
	return {
		vertices,
		faces: faces.map((face) => {
			const a = vertices[face[0]!]!
			const winding = cross(sub(vertices[face[1]!]!, a), sub(vertices[face[2]!]!, a))
			// The solids are centred on the origin, so a face's own centroid points outward.
			const outward = centroid(face.map((i) => vertices[i]!))
			return dot(winding, outward) < 0 ? [...face].reverse() : face
		}),
	}
}

const SOLIDS: Record<DieKind, Solid> = Object.fromEntries(
	DIE_KINDS.map((kind) => [kind, orient(RAW[kind])])
) as Record<DieKind, Solid>

export function solidFor(kind: DieKind): Solid {
	return SOLIDS[kind]
}

/**
 * The outward normal of each face, in the solid's own space.
 *
 * This is what "which side is up" is answered with: rotate these by the body's quaternion after it
 * settles and the one pointing most nearly at the sky is the face you read.
 *
 * Derived from the winding rather than from the vertex positions alone, then checked against the
 * centroid — a face wound the wrong way would give an inward normal, and a die whose normals pointed
 * inward would read every roll upside down.
 */
export function faceNormals(kind: DieKind): Vec3[] {
	const { vertices, faces } = solidFor(kind)
	return faces.map((face) => {
		const [a, b, c] = [vertices[face[0]!]!, vertices[face[1]!]!, vertices[face[2]!]!]
		// Straight off the winding, with no outward correction — `orient` has already guaranteed that
		// every face is counter-clockwise from outside, which is the whole reason it runs.
		return normalise(cross(sub(b, a), sub(c, a)))
	})
}

/** How many faces this solid has, which must equal how many values the die has. */
export function faceCount(kind: DieKind): number {
	return solidFor(kind).faces.length
}

/** Every kind's solid is checked against its die in the tests; exported so they can iterate. */
export const SOLID_KINDS = DIE_KINDS

/**
 * Whether the solid has as many faces as the die has values.
 *
 * True of six of the seven. The percentile die is the exception by design: it is a ten-sided solid, and
 * its hundred values come from throwing *two* of them — see `physical.ts`.
 */
export function faceCountMatchesDie(kind: DieKind): boolean {
	return kind === 'd100' ? faceCount(kind) === 10 : faceCount(kind) === facesOf(kind)
}

/**
 * How big a die *looks*: the radius of its silhouette when it is resting on a face, seen from above.
 *
 * This is the measure that matters, and it took two goes to get there. Built at one **circumradius**
 * the dice were wildly uneven, because a circumradius says how far the corners reach and not how much
 * of the paper the shape covers — a cube's face-to-face is 1.155 of it and an icosahedron's is 1.589.
 * Matching **volume** was the second attempt and is how real sets are made, but bulk is not apparent
 * size either: a tetrahedron's volume is spread over a much wider footprint than a near-sphere's, so
 * volume-matching left the d4 looking like the big one.
 *
 * So: orient the solid the way it will actually come to rest — one face down — flatten it onto the
 * paper, and measure how far it reaches. Computed from the face tables rather than tuned by eye, so a
 * solid added later is sized correctly without anyone squinting at it. All seven are face-transitive
 * (the d10's kites included), so any face stands for all of them.
 */
function apparentRadius(kind: DieKind): number {
	const { vertices } = solidFor(kind)
	const down: Vec3 = [0, 0, -1]
	const normal = faceNormals(kind)[0]!

	/*
	 * Rotate `normal` onto `down`, then keep only what is left in the plane of the paper.
	 *
	 * Rodrigues' formula, with the antiparallel case handled: a solid whose first face already points
	 * down needs no rotation at all, and the general formula divides by zero there.
	 */
	const axis = cross(normal, down)
	const sin = length(axis)
	const cos = dot(normal, down)
	const flat: Vec3[] =
		sin < 1e-12
			? vertices.map((v) => (cos > 0 ? v : ([v[0], v[1], -v[2]] as Vec3)))
			: vertices.map((v) => {
					const k = normalise(axis)
					const kv = cross(k, v)
					const kkv = cross(k, kv)
					return [
						v[0] + sin * kv[0] + (1 - cos) * kkv[0],
						v[1] + sin * kv[1] + (1 - cos) * kkv[1],
						v[2] + sin * kv[2] + (1 - cos) * kkv[2],
					] as Vec3
				})

	// The footprint's own middle, so an off-centre solid is not measured from the wrong point.
	const mid = centroid(flat.map(([x, y]) => [x, y, 0] as Vec3))
	return Math.max(...flat.map(([x, y]) => Math.hypot(x - mid[0], y - mid[1])))
}

/**
 * How much to scale each solid so the dice look like a **set**.
 *
 * Normalised on the d20 — the die people picture when they picture dice, and the one whose current size
 * was the reference for "make them all this big". Undamped, deliberately: the point is that they end up
 * the same apparent size, not merely closer than they were.
 */
const SIZES: Record<DieKind, number> = Object.fromEntries(
	DIE_KINDS.map((kind) => [kind, apparentRadius('d20') / apparentRadius(kind)])
) as Record<DieKind, number>

export function sizeScale(kind: DieKind): number {
	return SIZES[kind]!
}

/**
 * How far a die reaches from its own centre, once scaled — its circumradius, in whatever units the
 * caller's radius is in.
 *
 * Needed because `sizeScale` normalises *apparent* size, and the tables it corrects are not all at the
 * same scale to begin with (the octahedron's vertices sit at 1, the icosahedron's at 1.9). So the scale
 * factor alone says nothing about how much room a die takes up, and the throw has to know that to space
 * dice out without spawning them inside each other.
 */
export function circumradius(kind: DieKind): number {
	const { vertices } = solidFor(kind)
	return sizeScale(kind) * Math.max(...vertices.map((v) => length(v)))
}

// ---------------------------------------------------------------------------
// Small vector helpers. Local rather than three.js's, so this module stays data-only and can be
// tested (and reasoned about) without loading a renderer.
// ---------------------------------------------------------------------------

export function sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

export function cross(a: Vec3, b: Vec3): Vec3 {
	return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function dot(a: Vec3, b: Vec3): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function length(a: Vec3): number {
	return Math.sqrt(dot(a, a))
}

export function normalise(a: Vec3): Vec3 {
	const len = length(a)
	return len === 0 ? [0, 0, 0] : [a[0] / len, a[1] / len, a[2] / len]
}

export function centroid(points: readonly Vec3[]): Vec3 {
	const sum = points.reduce<Vec3>((acc, p) => [acc[0] + p[0], acc[1] + p[1], acc[2] + p[2]], [0, 0, 0])
	return [sum[0] / points.length, sum[1] / points.length, sum[2] / points.length]
}
