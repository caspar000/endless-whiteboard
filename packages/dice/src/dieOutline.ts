import { DIE_KINDS, type DieKind } from './kinds'
import { cross, dot, faceNormals, length, normalise, solidFor, type Vec3 } from './three/solids'

/**
 * Each die as a **projected wireframe** — the shape you would actually see, not a flat stand-in.
 *
 * The tray used to show plain silhouettes: a triangle, a square, a rhombus, a kite, a pentagon, a
 * hexagon. They were legible but they were not dice, and two of them were nearly indistinguishable — a
 * d8 and a d10 are both "a diamond" at 20px, which is why the face count had to be printed inside to
 * tell them apart at all.
 *
 * These are generated from the *same* vertex and face tables the rolling dice are built from
 * (`three/solids.ts`), by projecting each solid and keeping the edges you could see. So the icon is a
 * true picture of the die that rolls, and it cannot drift from it — a solid added later gets a correct
 * icon without anyone drawing one. Nothing here loads three.js: the tables are plain data, which is what
 * lets the tray, the palette and Settings all use this without pulling in the renderer.
 */

/** The box the paths are drawn in, matching the viewBox `DieIcon` uses. */
const BOX = 24
/** How much of the box the die fills. The rest is margin, so a stroke never clips at the edge. */
const FIT = 0.9

/**
 * How each die is looked at.
 *
 * `direction` is the way the camera points; `up` is which way is up in the finished icon. Both are
 * derived from the solid rather than written as numbers, so they stay correct if a table changes.
 *
 * Dead-on, with no tilt, and that is the whole trick. A tilt was the first attempt — a few degrees to
 * "make it look solid" — and it made every icon look skewed and the facets look like scribble, because
 * what makes a polyhedral die legible at icon size is precisely its **symmetry**: a front face in the
 * middle with its neighbours fanned evenly around it. Break the symmetry and there is nothing left but
 * a tangle of lines.
 *
 * Three kinds of view, one per shape of problem:
 *
 *  - **Face-on** (`d4`, `d8`, `d12`, `d20`) — down a face normal. The front face lands in the middle,
 *    where the number goes, and the rest fan around it.
 *  - **Corner-on** (`d6`) — a cube face-on is a square with no interior edges at all: a picture of a
 *    square, not of a die. From a corner it reads as the isometric cube everyone draws.
 *  - **Equator-on** (`d10`, `d100`) — a trapezohedron down a *kite's* normal is a lumpy decagon. Looked
 *    at side-on, across its waist, it is the pointed diamond a d10 actually looks like.
 */
type ViewKind = 'face' | 'corner' | 'equator'

const VIEW: Record<DieKind, ViewKind> = {
	d4: 'face',
	d6: 'corner',
	d8: 'face',
	d10: 'equator',
	d12: 'face',
	d20: 'face',
	d100: 'equator',
}

/**
 * Where the camera is and which way up it holds the die.
 *
 * The `up` hint is what stops each icon landing at whatever angle the vertex order happens to imply: a
 * d4 pointing downwards was the first version's, because face 0's winding said so. Aiming a known vertex
 * at the top instead makes every die sit the way you would hand it to someone.
 */
function viewFor(kind: DieKind): { direction: Vec3; up: Vec3 } {
	const { vertices, faces } = solidFor(kind)
	const normals = faceNormals(kind)

	if (VIEW[kind] === 'corner') {
		// Down a vertex, with a neighbouring vertex used to settle the roll about that axis.
		return { direction: normalise(vertices[0]!), up: normalise(vertices[1]!) }
	}
	if (VIEW[kind] === 'equator') {
		// Across the waist. The poles are the last two vertices (see `pentagonalTrapezohedron`), so the
		// polar axis is up and any direction across it will do for the camera.
		return { direction: [1, 0, 0], up: [0, 0, 1] }
	}
	// Face-on, with one of that face's own corners aimed at the top — which is what makes the figure
	// symmetrical about the vertical rather than merely symmetrical.
	return { direction: normals[0]!, up: vertices[faces[0]![0]!]! }
}

export interface DieOutline {
	/** The outer edge, as one closed path — so its corners join rather than butting together. */
	silhouette: string
	/** The visible interior creases, as separate segments. */
	creases: string
}

/**
 * An orthonormal basis for the view plane, with `hint` pulled as close to straight up as it can be.
 *
 * The hint is only a hint: it may not be perpendicular to the view direction, so the part of it along
 * that direction is removed and what is left becomes up. A hint that is parallel to the view (nothing
 * left over) falls back to any perpendicular axis, which is the case for a solid looked at straight down
 * one of its own vertices.
 */
function viewBasis(direction: Vec3, hint: Vec3): { right: Vec3; up: Vec3 } {
	const along = dot(hint, direction)
	const projected: Vec3 = [
		hint[0] - along * direction[0],
		hint[1] - along * direction[1],
		hint[2] - along * direction[2],
	]
	const fallback: Vec3 = Math.abs(direction[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
	const up = normalise(length(projected) > 1e-6 ? projected : fallback)
	// Right-handed: `right` completes the pair, and negating it would mirror every icon.
	return { right: normalise(cross(up, direction)), up }
}

function outlineFor(kind: DieKind): DieOutline {
	const { vertices, faces } = solidFor(kind)
	const normals = faceNormals(kind)

	const view = viewFor(kind)
	const direction = normalise(view.direction)
	const { right, up } = viewBasis(direction, view.up)

	// Front-facing means turned toward the viewer: we look *along* `direction`, so its normal opposes it.
	const facesViewer = normals.map((normal) => dot(normal, direction) < 0)

	const project = (v: Vec3): [number, number] => [dot(v, right), dot(v, up)]
	const flat = vertices.map((v) => project(v))
	const radius = Math.max(...flat.map(([x, y]) => Math.hypot(x, y)))
	const scale = ((BOX / 2) * FIT) / radius
	// SVG y grows downward, so `up` is negated on the way out.
	const at = (i: number): [number, number] => [
		BOX / 2 + flat[i]![0] * scale,
		BOX / 2 - flat[i]![1] * scale,
	]

	/*
	 * Every edge, with the faces on either side of it.
	 *
	 * An edge whose two faces disagree about facing the viewer is on the **silhouette**; one whose faces
	 * both face the viewer is a **crease** you can see; one whose faces both face away is hidden.
	 */
	const edges = new Map<string, { a: number; b: number; faces: number[] }>()
	faces.forEach((face, faceIndex) => {
		for (let i = 0; i < face.length; i++) {
			const a = face[i]!
			const b = face[(i + 1) % face.length]!
			const key = a < b ? `${a}-${b}` : `${b}-${a}`
			const found = edges.get(key)
			if (found) found.faces.push(faceIndex)
			else edges.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [faceIndex] })
		}
	})

	const rim: [number, number][] = []
	const creases: string[] = []
	for (const edge of edges.values()) {
		const front = edge.faces.filter((f) => facesViewer[f]).length
		if (front === 1) rim.push([edge.a, edge.b])
		else if (front === 2) {
			const [x1, y1] = at(edge.a)
			const [x2, y2] = at(edge.b)
			creases.push(`M${round(x1)} ${round(y1)}L${round(x2)} ${round(y2)}`)
		}
	}

	return { silhouette: loop(rim, at), creases: creases.join('') }
}

/**
 * Walks the silhouette edges into one closed path.
 *
 * Drawn as separate segments the corners butt together instead of joining, which at this size shows as
 * a nicked outline. Ordering them into a loop lets `stroke-linejoin` do its job.
 */
function loop(rim: [number, number][], at: (i: number) => [number, number]): string {
	if (rim.length === 0) return ''
	const next = new Map<number, number[]>()
	for (const [a, b] of rim) {
		next.set(a, [...(next.get(a) ?? []), b])
		next.set(b, [...(next.get(b) ?? []), a])
	}

	const start = rim[0]![0]
	const path: number[] = [start]
	const used = new Set<string>()
	let current = start
	for (let step = 0; step < rim.length; step++) {
		const candidates = next.get(current) ?? []
		const to = candidates.find((c) => !used.has(edgeKey(current, c)))
		if (to === undefined) break
		used.add(edgeKey(current, to))
		path.push(to)
		current = to
	}

	const points = path.map((i) => at(i))
	const [first, ...rest] = points
	if (!first) return ''
	return (
		`M${round(first[0])} ${round(first[1])}` +
		rest.map(([x, y]) => `L${round(x)} ${round(y)}`).join('') +
		'Z'
	)
}

function edgeKey(a: number, b: number): string {
	return a < b ? `${a}-${b}` : `${b}-${a}`
}

/** Two decimals is well under a pixel at any size these are drawn at, and keeps the paths short. */
function round(value: number): number {
	return Math.round(value * 100) / 100
}

const OUTLINES: Record<DieKind, DieOutline> = Object.fromEntries(
	DIE_KINDS.map((kind) => [kind, outlineFor(kind)])
) as Record<DieKind, DieOutline>

export function dieOutline(kind: DieKind): DieOutline {
	return OUTLINES[kind]
}

/** Exported for the tests, which check the projection rather than the strings it produces. */
export const OUTLINE_BOX = BOX
