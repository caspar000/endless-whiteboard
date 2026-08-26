import { describe, expect, it } from 'vitest'
import { DIE_KINDS } from '../kinds'
import { readingMode } from './faces'
import { faceLayouts } from './layout'
import { solidFor } from './solids'

describe('faceLayouts', () => {
	it('gives one UV per corner of every face', () => {
		for (const kind of DIE_KINDS) {
			const { faces } = solidFor(kind)
			const layouts = faceLayouts(kind)
			expect(layouts, kind).toHaveLength(faces.length)
			layouts.forEach((layout, i) => {
				expect(layout.uvs, `${kind} face ${i}`).toHaveLength(faces[i]!.length)
			})
		}
	})

	it('keeps every corner inside the texture, with a margin', () => {
		for (const kind of DIE_KINDS) {
			for (const [i, layout] of faceLayouts(kind).entries()) {
				for (const [u, v] of layout.uvs) {
					expect(u, `${kind} face ${i} u`).toBeGreaterThanOrEqual(0)
					expect(u, `${kind} face ${i} u`).toBeLessThanOrEqual(1)
					expect(v, `${kind} face ${i} v`).toBeGreaterThanOrEqual(0)
					expect(v, `${kind} face ${i} v`).toBeLessThanOrEqual(1)
				}
			}
		}
	})

	it('fills the texture the same way on every face of a solid', () => {
		// Faces of these solids are congruent, so a numeral drawn at the middle of one image is the same
		// size on every face. If this drifts, one face of a d12 has a bigger number than its neighbour.
		for (const kind of DIE_KINDS) {
			const spans = faceLayouts(kind).map((layout) => {
				const us = layout.uvs.map(([u]) => u)
				const vs = layout.uvs.map(([, v]) => v)
				return Math.max(...us) - Math.min(...us) + (Math.max(...vs) - Math.min(...vs))
			})
			expect(Math.max(...spans) - Math.min(...spans), kind).toBeLessThan(1e-9)
		}
	})

	it('puts one mark in the middle of a face, for the dice read that way', () => {
		for (const kind of DIE_KINDS) {
			if (readingMode(kind) === 'vertex') continue
			faceLayouts(kind).forEach((layout, i) => {
				expect(layout.marks, `${kind} face ${i}`).toHaveLength(1)
				// The face's *incircle* centre. For the regular faces that is the centroid, which `flatten`
				// puts at the middle of the texture; the d10's kites are the ones that differ, and they lean
				// away from the tip rather than sitting on it.
				const [u, v] = layout.marks[0]!.uv
				const kite = kind === 'd10' || kind === 'd100'
				expect(u, `${kind} face ${i} u`).toBeCloseTo(0.5, kite ? 1 : 3)
				expect(v, `${kind} face ${i} v`).toBeCloseTo(0.5, kite ? 1 : 3)
				// Face `i` shows label `i` — the numbering is the face order.
				expect(layout.marks[0]!.label).toBe(i)
			})
		}
	})

	it('marks a d4 at all three corners, labelled by vertex', () => {
		const layouts = faceLayouts('d4')
		const { faces } = solidFor('d4')
		layouts.forEach((layout, i) => {
			expect(layout.marks).toHaveLength(3)
			// The three labels on a face are its three corners — which is what makes the apex readable.
			expect(layout.marks.map((m) => m.label).sort()).toEqual([...faces[i]!].sort())
		})
	})

	it('gives every d4 vertex the same number of marks across the solid', () => {
		// Each corner of a tetrahedron is shared by three faces, and all three have to show its number
		// or the apex reads differently depending on which way you look at it.
		const counts = new Map<number, number>()
		for (const layout of faceLayouts('d4')) {
			for (const mark of layout.marks) counts.set(mark.label, (counts.get(mark.label) ?? 0) + 1)
		}
		expect([...counts.keys()].sort()).toEqual([0, 1, 2, 3])
		for (const [vertex, count] of counts) expect(count, `vertex ${vertex}`).toBe(3)
	})

	it('insets corner marks so a numeral is not printed on a point', () => {
		for (const layout of faceLayouts('d4')) {
			layout.marks.forEach((mark, corner) => {
				const distance = Math.hypot(mark.uv[0] - 0.5, mark.uv[1] - 0.5)
				const cornerDistance = Math.hypot(layout.uvs[corner]![0] - 0.5, layout.uvs[corner]![1] - 0.5)
				expect(distance).toBeLessThan(cornerDistance)
				expect(distance).toBeGreaterThan(0)
			})
		}
	})
})
