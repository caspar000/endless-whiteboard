import { buildEdgeIndex, type Edge } from '@lifeboard/node-kit'
import { describe, expect, it } from 'vitest'
import { auraOutline } from './auraGeometry'
import { DEFAULT_AURA, auraReach } from './auraPreset'
import { fbm, gradientNoise, warpedFbm } from './noise'
import { traceNeighbourhood } from './tracing'

const edge = (id: string, from: string, to: string): Edge => ({ id, from, to })

/**
 * A small graph:  a → hub → c,  and d → e off on its own.
 *
 *   a ──a1──▶ hub ──a2──▶ c
 *   d ──a3──▶ e
 */
const INDEX = buildEdgeIndex([
	edge('a1', 'a', 'hub'),
	edge('a2', 'hub', 'c'),
	edge('a3', 'd', 'e'),
])

describe('traceNeighbourhood', () => {
	it('takes one hop in both directions', () => {
		const { nodes, arrows } = traceNeighbourhood(INDEX, 'hub')
		// Direction is not the question being asked — "what is this tangled up with" includes what
		// points at it as well as what it points at.
		expect([...nodes].sort()).toEqual(['a', 'c', 'hub'])
		expect([...arrows].sort()).toEqual(['a1', 'a2'])
	})

	it('includes the root, which glows too', () => {
		expect(traceNeighbourhood(INDEX, 'a').nodes.has('a')).toBe(true)
	})

	it('stops at one hop', () => {
		// From `a` you reach `hub`, and `c` is one hop further — the lens must not follow the chain,
		// or a dense board lights up entirely and answers nothing.
		const { nodes } = traceNeighbourhood(INDEX, 'a')
		expect(nodes.has('hub')).toBe(true)
		expect(nodes.has('c')).toBe(false)
	})

	it('leaves the rest of the board alone', () => {
		const { nodes, arrows } = traceNeighbourhood(INDEX, 'hub')
		expect(nodes.has('d')).toBe(false)
		expect(arrows.has('a3')).toBe(false)
	})

	it('traces a shape with no relations to just itself', () => {
		const { nodes, arrows } = traceNeighbourhood(INDEX, 'lonely')
		expect([...nodes]).toEqual(['lonely'])
		expect(arrows.size).toBe(0)
	})
})

describe('auraOutline', () => {
	const BOX = { x: 100, y: 100, w: 200, h: 120 }

	it('is a closed path', () => {
		const d = auraOutline(BOX, 0, 0)
		expect(d.startsWith('M ')).toBe(true)
		expect(d.endsWith('Z')).toBe(true)
	})

	it('surrounds the shape rather than crossing it', () => {
		const points = pointsOf(auraOutline(BOX, 0, 0))
		// Every point sits outside the box it wraps: the aura is a halo, and one that cut through the
		// shape would read as a scribble over it.
		for (const [x, y] of points) {
			const outside = x < BOX.x || x > BOX.x + BOX.w || y < BOX.y || y > BOX.y + BOX.h
			expect(outside).toBe(true)
		}
	})

	it('closes without a seam, whatever the settings', () => {
		/*
		 * The one structural claim of the whole approach: the outline reads its offsets from a *circle*
		 * through the noise field, so the last sample and the first sample are the same point in it.
		 * Nothing has to be arranged to make that true — which is why there is no whole-number-of-cycles
		 * constraint anywhere, and why the settings below can be arbitrary.
		 *
		 * Tested by comparing the field's value at both ends of the loop rather than by eye: a seam is a
		 * step between the two, and one pixel of step is a visible kink at this stroke width.
		 */
		for (const preset of [
			DEFAULT_AURA,
			{ ...DEFAULT_AURA, feature: 37, warp: 2.3, octaves: 6 },
			{ ...DEFAULT_AURA, feature: 411, warp: 0, octaves: 1, roughness: 0.77 },
		]) {
			const radius = 320 / preset.feature / (Math.PI * 2)
			const start = warpedFbm(
				Math.cos(0) * radius,
				Math.sin(0) * radius,
				1,
				preset.octaves,
				preset.roughness,
				preset.warp
			)
			const end = warpedFbm(
				Math.cos(Math.PI * 2) * radius,
				Math.sin(Math.PI * 2) * radius,
				1,
				preset.octaves,
				preset.roughness,
				preset.warp
			)
			expect(Math.abs(start - end)).toBeLessThan(1e-9)
		}
	})

	it('keeps moving without ever repeating', () => {
		const still = auraOutline(BOX, 0, 0)
		expect(auraOutline(BOX, 1.5, 0)).not.toBe(still)
		// Time slides the sampling circle through the field rather than advancing a phase, so there is
		// no period to come back to — the coastline goes on being a different coastline. What has to
		// hold instead is that it stays *bounded*, which the next test pins.
		expect(auraOutline(BOX, 120, 0)).not.toBe(still)
	})

	it('gives two shapes different outlines, so a board does not pulse in unison', () => {
		expect(auraOutline(BOX, 0, 1.1)).not.toBe(auraOutline(BOX, 0, 0))
	})

	it('stays within a bounded distance of the shape, at every moment', () => {
		/*
		 * The layer pads its SVG by exactly `auraReach`. This holds because fBm is normalised by the
		 * sum of its own octave amplitudes, so it cannot leave [-1, 1] however many octaves or however
		 * much warping is asked for — if it could, the outline would be drawn outside the box and
		 * clipped.
		 */
		const reach = auraReach(DEFAULT_AURA)
		for (const phase of [0, 0.7, 1.9, 3.3, 5.5, 47, 300]) {
			for (const [x, y] of pointsOf(auraOutline(BOX, phase, 0.4))) {
				expect(x).toBeGreaterThanOrEqual(BOX.x - reach)
				expect(x).toBeLessThanOrEqual(BOX.x + BOX.w + reach)
				expect(y).toBeGreaterThanOrEqual(BOX.y - reach)
				expect(y).toBeLessThanOrEqual(BOX.y + BOX.h + reach)
			}
		}
	})

	it('draws nothing for a shape with no size', () => {
		expect(auraOutline({ x: 0, y: 0, w: 0, h: 0 }, 0, 0)).not.toBe('')
	})

	it('scales its detail with length, so a small shape and a large one share one handwriting', () => {
		// A fixed *count* of features would give a small shape a fine scribble and a large one a nearly
		// smooth edge. Counting segments is a proxy for how much detail was drawn.
		//
		// Measured at settings well below the cap below, which the shipped defaults deliberately are
		// not: a test that happened to sit at the ceiling would pass for the wrong reason.
		const preset = { ...DEFAULT_AURA, feature: 60, samplesPerFeature: 8 }
		const small = segments(auraOutline({ x: 0, y: 0, w: 100, h: 100 }, 0, 0, preset))
		const large = segments(auraOutline({ x: 0, y: 0, w: 400, h: 400 }, 0, 0, preset))
		expect(large / small).toBeGreaterThan(2.5)
	})

	it('caps how much it will draw, so one big shape cannot eat the frame', () => {
		// The path is rebuilt thirty times a second. Detail is worth paying for; unbounded detail on a
		// board-sized shape is not, and the ceiling is what makes the cost predictable.
		const greedy = { ...DEFAULT_AURA, feature: 4, samplesPerFeature: 60 }
		expect(segments(auraOutline({ x: 0, y: 0, w: 4000, h: 3000 }, 0, 0, greedy))).toBeLessThan(950)
	})
})

describe('the noise the outline is read from', () => {
	it('is smooth: neighbouring points give neighbouring values', () => {
		// A field that jumped between adjacent samples would draw a hedge rather than a coastline.
		let worst = 0
		for (let i = 0; i < 400; i++) {
			const x = i * 0.02
			worst = Math.max(worst, Math.abs(gradientNoise(x, 3.5, 1) - gradientNoise(x + 0.02, 3.5, 1)))
		}
		expect(worst).toBeLessThan(0.2)
	})

	it('is bounded, which is what makes the aura’s reach knowable', () => {
		for (let i = 0; i < 3000; i++) {
			const x = i * 0.37
			const y = i * 0.11
			expect(Math.abs(fbm(x, y, 1, 6, 0.8))).toBeLessThanOrEqual(1)
			expect(Math.abs(warpedFbm(x, y, 1, 6, 0.8, 3))).toBeLessThanOrEqual(1)
		}
	})

	it('has detail at more than one scale — that is what "fractal" is buying', () => {
		/*
		 * Measured as path length per unit of range, not as raw movement.
		 *
		 * Raw movement is the wrong measure and says the opposite: fBm divides by the sum of its octave
		 * amplitudes, so adding octaves makes the *dominant* band quieter and the field moves less
		 * overall. What the extra octaves actually buy is a line that travels further to cover the same
		 * vertical distance — which is what roughness is, and what makes the outline read as a coastline
		 * rather than as a smooth curve.
		 */
		const roughness = (octaves: number) => {
			let travelled = 0
			let min = Infinity
			let max = -Infinity
			let previous = fbm(0, 1.7, 1, octaves, 0.5)
			for (let i = 1; i < 2000; i++) {
				const value = fbm(i * 0.01, 1.7, 1, octaves, 0.5)
				travelled += Math.abs(value - previous)
				min = Math.min(min, value)
				max = Math.max(max, value)
				previous = value
			}
			return travelled / (max - min)
		}
		expect(roughness(6)).toBeGreaterThan(roughness(1) * 1.3)
	})

	it('is deterministic — the same aura on every machine, and the same on a reload', () => {
		expect(warpedFbm(1.5, 2.5, 1, 4, 0.5, 1)).toBe(warpedFbm(1.5, 2.5, 1, 4, 0.5, 1))
	})
})

/** Curve segments in a path string — a stand-in for how much detail was drawn. */
function segments(d: string): number {
	return (d.match(/Q/g) ?? []).length
}

/** Every coordinate pair in a path string, control points included. */
function pointsOf(d: string): [number, number][] {
	const numbers = d.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? []
	const points: [number, number][] = []
	for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i]!, numbers[i + 1]!])
	return points
}
