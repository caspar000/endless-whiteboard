import { describe, expect, it } from 'vitest'
import { DIE_KINDS, facesOf } from '../kinds'
import {
	UP,
	applyQuat,
	isCocked,
	readingMode,
	readingNormals,
	rotateLabels,
	upFace,
	type Quat,
} from './faces'
import { dot, faceNormals, normalise, solidFor, type Vec3 } from './solids'

/** The quaternion that rotates `from` onto `to`. Used to aim a chosen face at the sky. */
function quatFromTo(from: Vec3, to: Vec3): Quat {
	const f = normalise(from)
	const t = normalise(to)
	const d = dot(f, t)
	if (d > 0.999999) return { x: 0, y: 0, z: 0, w: 1 }
	if (d < -0.999999) {
		// Antiparallel: any perpendicular axis will do for a half turn.
		const axis = Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
		const perp = normalise([
			f[1] * axis[2]! - f[2] * axis[1]!,
			f[2] * axis[0]! - f[0] * axis[2]!,
			f[0] * axis[1]! - f[1] * axis[0]!,
		])
		return { x: perp[0], y: perp[1], z: perp[2], w: 0 }
	}
	const axis: Vec3 = [f[1] * t[2] - f[2] * t[1], f[2] * t[0] - f[0] * t[2], f[0] * t[1] - f[1] * t[0]]
	const s = Math.sqrt((1 + d) * 2)
	return { x: axis[0] / s, y: axis[1] / s, z: axis[2] / s, w: s / 2 }
}

describe('applyQuat', () => {
	it('leaves a vector alone under the identity', () => {
		expect(applyQuat([1, 2, 3], { x: 0, y: 0, z: 0, w: 1 })).toEqual([1, 2, 3])
	})

	it('rotates a quarter turn about z', () => {
		const q = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 }
		const [x, y, z] = applyQuat([1, 0, 0], q)
		expect(x).toBeCloseTo(0, 10)
		expect(y).toBeCloseTo(1, 10)
		expect(z).toBeCloseTo(0, 10)
	})
})

describe('upFace', () => {
	it('finds whichever reading direction was aimed at the sky, on every die', () => {
		// The round trip that matters: point a face (or, on a d4, a corner) up, and the reader has to
		// name that same one back.
		for (const kind of DIE_KINDS) {
			const normals = readingNormals(kind)
			normals.forEach((normal, index) => {
				const found = upFace(kind, quatFromTo(normal, UP))
				expect(found.index, `${kind} face ${index}`).toBe(index)
				expect(found.alignment, `${kind} face ${index}`).toBeCloseTo(1, 6)
			})
		}
	})

	it('reads a d4 by its apex, because a tetrahedron never has a face up', () => {
		// The bug this was written for: a d4 at rest sits on a face, so its face normals point one
		// straight down and three barely above horizontal. Read by face, every roll looks cocked.
		expect(readingMode('d4')).toBe('vertex')
		expect(readingMode('d20')).toBe('face')
		expect(readingNormals('d4')).toHaveLength(4)

		// Sitting on face 0 means the opposite *vertex* points up, and that is a clean reading.
		const resting = quatFromTo(faceNormals('d4')[0]!, [0, 0, -1])
		const found = upFace('d4', resting)
		expect(isCocked(found)).toBe(false)
		expect(found.alignment).toBeGreaterThan(0.9)
	})

	it('calls a die resting flat readable, and one on its edge cocked', () => {
		const normals = faceNormals('d20')
		const flat = upFace('d20', quatFromTo(normals[0]!, UP))
		expect(isCocked(flat)).toBe(false)

		// Aim the *edge* between two faces at the sky: neither is properly up.
		const edge = normalise([
			normals[0]![0] + normals[1]![0],
			normals[0]![1] + normals[1]![1],
			normals[0]![2] + normals[1]![2],
		])
		expect(isCocked(upFace('d20', quatFromTo(edge, UP)))).toBe(true)
	})

	it('is never cocked when a d6 sits square, however it is spun about the vertical', () => {
		const normals = faceNormals('d6')
		for (let turn = 0; turn < 8; turn++) {
			const angle = (turn * Math.PI) / 4
			const spin: Quat = { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }
			// Spinning about up cannot change which face is up.
			const aimed = quatFromTo(normals[2]!, UP)
			const combined = multiply(spin, aimed)
			const found = upFace('d6', combined)
			expect(found.index).toBe(2)
			expect(isCocked(found)).toBe(false)
		}
	})
})

function multiply(a: Quat, b: Quat): Quat {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	}
}

describe('rotateLabels', () => {
	const natural = (count: number) => Array.from({ length: count }, (_, i) => String(i + 1))

	it('puts the wanted label on the settled face, for every combination', () => {
		for (const kind of DIE_KINDS) {
			const count = solidFor(kind === 'd100' ? 'd10' : kind).faces.length
			const labels = natural(count)
			for (let settled = 0; settled < count; settled++) {
				for (let wanted = 0; wanted < count; wanted++) {
					const rotated = rotateLabels(labels, settled, wanted)
					expect(rotated[settled], `${kind} ${settled}/${wanted}`).toBe(labels[wanted])
				}
			}
		}
	})

	it('is still a complete die — every label once, none invented', () => {
		const labels = natural(20)
		for (let settled = 0; settled < 20; settled++) {
			const rotated = rotateLabels(labels, settled, 7)
			expect([...rotated].sort()).toEqual([...labels].sort())
		}
	})

	it('is a rotation, so faces keep their neighbours', () => {
		// The reason this is a rotation and not a shuffle: a d20 whose 19 sat somewhere different next
		// to the 20 on every roll is one somebody would eventually spot.
		const labels = natural(20)
		for (let settled = 0; settled < 20; settled++) {
			const rotated = rotateLabels(labels, settled, 19)
			const start = rotated.indexOf('1')
			for (let i = 0; i < 20; i++) expect(rotated[(start + i) % 20]).toBe(labels[i])
		}
	})

	it('refuses a face the die does not have', () => {
		expect(() => rotateLabels(natural(6), 0, 6)).toThrow(/no face/)
		expect(() => rotateLabels(natural(6), 0, -1)).toThrow(/no face/)
		expect(facesOf('d100')).toBe(100)
	})
})

/** mulberry32, so a failure above is reproducible. */
function seeded(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/** A uniformly random orientation — Shoemake's method. */
function randomQuat(random: () => number): Quat {
	const u = random()
	const v = random()
	const w = random()
	const a = Math.sqrt(1 - u)
	const b = Math.sqrt(u)
	return {
		x: a * Math.sin(2 * Math.PI * v),
		y: a * Math.cos(2 * Math.PI * v),
		z: b * Math.sin(2 * Math.PI * w),
		w: b * Math.cos(2 * Math.PI * w),
	}
}

describe('reading a die is independent of how it was spun', () => {
	it('always finds a face, whatever the orientation', () => {
		const random = seeded(9)
		for (const kind of DIE_KINDS) {
			for (let i = 0; i < 40; i++) {
				const found = upFace(kind, randomQuat(random))
				expect(found.index, kind).toBeGreaterThanOrEqual(0)
				expect(found.alignment, kind).toBeGreaterThan(0)
			}
		}
	})
})
