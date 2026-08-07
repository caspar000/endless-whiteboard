import { describe, expect, it } from 'vitest'
import {
	areEdgeIndexesEqual,
	buildEdgeIndex,
	edgesTouching,
	otherEnd,
	type Edge,
} from './edges'

const edge = (id: string, from: string, to: string): Edge => ({ id, from, to })

describe('edge index', () => {
	it('groups edges both ways', () => {
		const index = buildEdgeIndex([edge('a1', 'rent', 'budget'), edge('a2', 'food', 'budget')])
		expect(index.incoming.get('budget')?.map((e) => e.from)).toEqual(['rent', 'food'])
		expect(index.outgoing.get('rent')?.map((e) => e.to)).toEqual(['budget'])
		expect(index.incoming.get('rent')).toBeUndefined()
	})

	it('orders by arrow id, so two builds of the same graph compare equal', () => {
		// The build order follows page order, which changes whenever a shape is brought to front. The
		// sort is what stops that reading as a change to the graph.
		const a = buildEdgeIndex([edge('a2', 'x', 'z'), edge('a1', 'y', 'z')])
		const b = buildEdgeIndex([edge('a1', 'y', 'z'), edge('a2', 'x', 'z')])
		expect(areEdgeIndexesEqual(a, b)).toBe(true)
	})

	it('notices a rewired arrow, not just an added or removed one', () => {
		const before = buildEdgeIndex([edge('a1', 'rent', 'budget')])
		expect(areEdgeIndexesEqual(before, buildEdgeIndex([edge('a1', 'food', 'budget')]))).toBe(false)
		expect(areEdgeIndexesEqual(before, buildEdgeIndex([edge('a1', 'rent', 'savings')]))).toBe(false)
		expect(areEdgeIndexesEqual(before, buildEdgeIndex([]))).toBe(false)
	})

	describe('direction', () => {
		const index = buildEdgeIndex([
			edge('a1', 'rent', 'budget'),
			edge('a2', 'budget', 'savings'),
		])

		it('reads "in" as arrows pointing at the shape', () => {
			expect(edgesTouching(index, 'budget', 'in').map((e) => e.id)).toEqual(['a1'])
		})

		it('reads "out" as arrows leaving the shape', () => {
			expect(edgesTouching(index, 'budget', 'out').map((e) => e.id)).toEqual(['a2'])
		})

		it('reads "either" as both, without losing one to the other', () => {
			expect(edgesTouching(index, 'budget', 'either').map((e) => e.id).sort()).toEqual(['a1', 'a2'])
			// A shape touched only one way still gets its edge back under `either`.
			expect(edgesTouching(index, 'rent', 'either').map((e) => e.id)).toEqual(['a1'])
			expect(edgesTouching(index, 'nothing', 'either')).toEqual([])
		})
	})

	it('walks to the far end from whichever end you are standing on', () => {
		const e = edge('a1', 'rent', 'budget')
		expect(otherEnd(e, 'budget')).toBe('rent')
		expect(otherEnd(e, 'rent')).toBe('budget')
	})
})
