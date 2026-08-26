import { describe, expect, it } from 'vitest'
import { facesOf } from '../kinds'
import {
	SOLID_KINDS,
	centroid,
	cross,
	dot,
	faceCount,
	faceCountMatchesDie,
	faceNormals,
	length,
	normalise,
	solidFor,
	sub,
	type Vec3,
} from './solids'

/**
 * The solids, checked as *geometry* rather than as transcription.
 *
 * A vertex/face table is exactly the kind of thing that can be subtly wrong — one index off, one face
 * wound backwards — and be invisible until a die renders inside-out or reads the wrong number off the
 * top. None of these tests know what the tables say; they check the properties a die has to have, so
 * they would catch a typo in a table nobody re-derived by hand.
 */

describe('every solid', () => {
	it('has as many faces as its die has values', () => {
		for (const kind of SOLID_KINDS) {
			expect(faceCountMatchesDie(kind), kind).toBe(true)
		}
		// Spelled out, so the intent survives a change to the helper.
		expect(faceCount('d4')).toBe(4)
		expect(faceCount('d20')).toBe(20)
		// The percentile die is a d10 with different markings.
		expect(faceCount('d100')).toBe(10)
	})

	it('references only vertices that exist, and uses all of them', () => {
		for (const kind of SOLID_KINDS) {
			const { vertices, faces } = solidFor(kind)
			const used = new Set<number>()
			for (const face of faces) {
				for (const index of face) {
					expect(index, `${kind} index`).toBeGreaterThanOrEqual(0)
					expect(index, `${kind} index`).toBeLessThan(vertices.length)
					used.add(index)
				}
			}
			// A vertex no face mentions is a table with a leftover row in it.
			expect(used.size, kind).toBe(vertices.length)
		}
	})

	it('is closed: every edge is shared by exactly two faces', () => {
		// The property that catches a missing or duplicated face, which a face *count* cannot.
		for (const kind of SOLID_KINDS) {
			const seen = new Map<string, number>()
			for (const face of solidFor(kind).faces) {
				for (let i = 0; i < face.length; i++) {
					const a = face[i]!
					const b = face[(i + 1) % face.length]!
					const key = a < b ? `${a}-${b}` : `${b}-${a}`
					seen.set(key, (seen.get(key) ?? 0) + 1)
				}
			}
			for (const [edge, count] of seen) {
				expect(count, `${kind} edge ${edge}`).toBe(2)
			}
		}
	})

	it('is convex: every vertex is on or inside every face plane', () => {
		for (const kind of SOLID_KINDS) {
			const { vertices, faces } = solidFor(kind)
			const normals = faceNormals(kind)
			faces.forEach((face, index) => {
				const n = normals[index]!
				const origin = vertices[face[0]!]!
				for (const vertex of vertices) {
					// Positive would put a vertex outside the face's plane, which a convex hull cannot do.
					expect(dot(n, sub(vertex, origin)), `${kind} face ${index}`).toBeLessThan(1e-6)
				}
			})
		}
	})

	it('has outward normals, so "up" means up', () => {
		for (const kind of SOLID_KINDS) {
			const { vertices, faces } = solidFor(kind)
			const normals = faceNormals(kind)
			faces.forEach((face, index) => {
				const mid = centroid(face.map((i) => vertices[i]!))
				// A normal pointing away from the centre of a solid centred on the origin.
				expect(dot(normals[index]!, normalise(mid)), `${kind} face ${index}`).toBeGreaterThan(0.5)
				expect(length(normals[index]!), `${kind} face ${index}`).toBeCloseTo(1, 10)
			})
		}
	})

	it('has distinct normals — no two faces pointing the same way', () => {
		// Two identical normals would mean a duplicated face, or a solid that is not the one intended.
		for (const kind of SOLID_KINDS) {
			const normals = faceNormals(kind)
			for (let i = 0; i < normals.length; i++) {
				for (let j = i + 1; j < normals.length; j++) {
					expect(dot(normals[i]!, normals[j]!), `${kind} ${i}/${j}`).toBeLessThan(0.999)
				}
			}
		}
	})

	it('has planar faces', () => {
		for (const kind of SOLID_KINDS) {
			const { vertices, faces } = solidFor(kind)
			const normals = faceNormals(kind)
			faces.forEach((face, index) => {
				const n = normals[index]!
				const origin = vertices[face[0]!]!
				for (const i of face) {
					// No per-kind tolerance: the d10's waist offset is solved rather than rounded, so its
					// kites are as flat as every other face here. A tolerance would have hidden that.
					const drift = Math.abs(dot(n, sub(vertices[i]!, origin)))
					expect(drift, `${kind} face ${index} vertex ${i}`).toBeLessThan(1e-9)
				}
			})
		}
	})

	it('has convex faces, wound consistently', () => {
		for (const kind of SOLID_KINDS) {
			const { vertices, faces } = solidFor(kind)
			const normals = faceNormals(kind)
			faces.forEach((face, index) => {
				const n = normals[index]!
				// Walking a convex loop turns the same way at every corner. A face that reversed would be
				// a self-intersecting polygon, which triangulates into a visible tangle.
				for (let i = 0; i < face.length; i++) {
					const a = vertices[face[i]!]!
					const b = vertices[face[(i + 1) % face.length]!]!
					const c = vertices[face[(i + 2) % face.length]!]!
					const turn = dot(n, cross(sub(b, a), sub(c, b)))
					expect(turn, `${kind} face ${index} corner ${i}`).toBeGreaterThan(0)
				}
			})
		}
	})

	it('is roughly spherical — every vertex about the same distance out', () => {
		// Not true of every polyhedron, but it is true of all seven of these, and it is the cheapest
		// check that a coordinate has not been mistyped (a wrong digit moves one vertex a long way).
		for (const kind of SOLID_KINDS) {
			const radii = solidFor(kind).vertices.map((v) => length(v as Vec3))
			const min = Math.min(...radii)
			const max = Math.max(...radii)
			expect(max / min, kind).toBeLessThan(1.6)
		}
	})
})
