import type { Editor, TLShape, TLShapeId } from 'tldraw'
import { describe, expect, it } from 'vitest'
import { buildEdgeIndex, type Edge } from './edges'
import { makeShape } from './properties/fakeEditor'
import {
	connectShapes,
	disconnectShapes,
	isHiddenRelation,
	isRelation,
	relationEnds,
	setRelationHidden,
} from './relations'

interface Binding {
	type: string
	fromId: string
	toId: string
	props: { terminal: 'start' | 'end' }
}

/**
 * Enough `Editor` to draw an arrow. Separate from `fakeEditor` because this exercises a different
 * hazard: that what `connectShapes` writes is what `getPageEdges` would later read back as an edge.
 */
function fakeCanvas(shapeIds: string[] = ['shape:a', 'shape:b']) {
	const shapes = new Map<string, TLShape>(shapeIds.map((id) => [id, makeShape(id)]))
	const bindings: Binding[] = []
	const state = { runs: 0, stops: 0 }

	const editor = {
		run: (fn: () => void) => {
			state.runs++
			fn()
		},
		markHistoryStoppingPoint: () => {
			state.stops++
		},
		getShape: (id: string) => shapes.get(id),
		createShape: (partial: { id: string; type: string; meta?: Record<string, unknown> }) => {
			shapes.set(partial.id, {
				...makeShape(partial.id),
				type: partial.type,
				meta: partial.meta ?? {},
			} as TLShape)
		},
		createBindings: (next: Binding[]) => bindings.push(...next),
		getBindingsFromShape: (shape: { id: string }, type: string) =>
			bindings.filter((b) => b.fromId === shape.id && b.type === type),
		getBindingsToShape: (shape: { id: string }, type: string) =>
			bindings.filter((b) => b.toId === shape.id && b.type === type),
		updateShape: (partial: { id: string; meta?: Record<string, unknown> }) => {
			const prev = shapes.get(partial.id)
			if (!prev) return
			// One level deep, as tldraw merges it (`applyPartialToRecordWithProps`).
			shapes.set(partial.id, { ...prev, meta: { ...prev.meta, ...(partial.meta ?? {}) } } as TLShape)
		},
		deleteShape: (id: string) => {
			shapes.delete(id)
			// tldraw removes a deleted shape's bindings for us; reproduced so the read-back holds.
			for (let i = bindings.length - 1; i >= 0; i--) {
				if (bindings[i]!.fromId === id || bindings[i]!.toId === id) bindings.splice(i, 1)
			}
		},
	} as unknown as Editor

	/** The edge index `getPageEdges` would build from this canvas — same rule, inlined. */
	const readEdges = () => {
		const found: Edge[] = []
		for (const shape of shapes.values()) {
			if (shape.type !== 'arrow') continue
			let from: string | undefined
			let to: string | undefined
			for (const binding of bindings.filter((b) => b.fromId === shape.id && b.type === 'arrow')) {
				if (binding.props.terminal === 'start') from = binding.toId
				else to = binding.toId
			}
			if (from && to && from !== to) found.push({ id: shape.id, from, to })
		}
		return buildEdgeIndex(found)
	}

	return { editor, shapes, bindings, readEdges, state }
}

const A = 'shape:a' as TLShapeId
const B = 'shape:b' as TLShapeId

describe('connectShapes', () => {
	it('creates an arrow bound at both ends, which reads back as an edge', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)

		expect(arrowId).not.toBeNull()
		expect(canvas.shapes.get(arrowId!)?.type).toBe('arrow')
		expect(canvas.readEdges().all).toEqual([{ id: arrowId, from: A, to: B }])
	})

	it('binds start to `from` and end to `to`, so direction survives', () => {
		const canvas = fakeCanvas()
		connectShapes(canvas.editor, B, A)

		const index = canvas.readEdges()
		expect(index.outgoing.get(B)).toHaveLength(1)
		expect(index.incoming.get(A)).toHaveLength(1)
		expect(index.outgoing.get(A)).toBeUndefined()
	})

	it('anchors both ends to the centre, imprecisely, so tldraw keeps recomputing the line', () => {
		const canvas = fakeCanvas()
		connectShapes(canvas.editor, A, B)

		for (const binding of canvas.bindings) {
			expect(binding.props).toMatchObject({
				normalizedAnchor: { x: 0.5, y: 0.5 },
				isExact: false,
				isPrecise: false,
			})
		}
	})

	it('is one `run`, so a connection is one undo step', () => {
		const canvas = fakeCanvas()
		connectShapes(canvas.editor, A, B)
		expect(canvas.state.runs).toBe(1)
	})

	it('marks a stopping point only when asked', () => {
		const canvas = fakeCanvas()
		connectShapes(canvas.editor, A, B)
		expect(canvas.state.stops).toBe(0)

		connectShapes(canvas.editor, A, B, { markHistory: true })
		expect(canvas.state.stops).toBe(1)
	})

	it('refuses a self-connection, which no query could ever see', () => {
		const canvas = fakeCanvas()
		expect(connectShapes(canvas.editor, A, A)).toBeNull()
		expect(canvas.readEdges().all).toEqual([])
		// Nothing was drawn either — a rejected relation must not leave a stray arrow behind.
		expect([...canvas.shapes.values()].some((s) => s.type === 'arrow')).toBe(false)
	})

	it('refuses a missing shape at either end', () => {
		const canvas = fakeCanvas()
		const ghost = 'shape:gone' as TLShapeId
		expect(connectShapes(canvas.editor, A, ghost)).toBeNull()
		expect(connectShapes(canvas.editor, ghost, A)).toBeNull()
		expect(canvas.readEdges().all).toEqual([])
	})
})

describe('hidden relations', () => {
	it('creates one hidden when asked, and it is still an edge', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B, { hidden: true })!

		expect(isHiddenRelation(canvas.shapes.get(arrowId))).toBe(true)
		// The claim the whole feature rests on: hiding changes what is *drawn*, never what is
		// *connected*. If this ever fails, every table on the board has quietly lost a row.
		expect(canvas.readEdges().all).toEqual([{ id: arrowId, from: A, to: B }])
	})

	it('is visible by default', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!
		expect(isHiddenRelation(canvas.shapes.get(arrowId))).toBe(false)
	})

	it('round-trips through setRelationHidden, leaving the edge alone', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!

		expect(setRelationHidden(canvas.editor, arrowId, true)).toBe(true)
		expect(isHiddenRelation(canvas.shapes.get(arrowId))).toBe(true)

		expect(setRelationHidden(canvas.editor, arrowId, false)).toBe(true)
		expect(isHiddenRelation(canvas.shapes.get(arrowId))).toBe(false)
		expect(canvas.readEdges().all).toEqual([{ id: arrowId, from: A, to: B }])
	})

	it('marks a stopping point only when asked', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!

		setRelationHidden(canvas.editor, arrowId, true)
		expect(canvas.state.stops).toBe(0)

		setRelationHidden(canvas.editor, arrowId, false, { markHistory: true })
		expect(canvas.state.stops).toBe(1)
	})

	it('refuses anything that is not an arrow', () => {
		const canvas = fakeCanvas()
		// An id mix-up must not make the node at the end of the relation disappear.
		expect(setRelationHidden(canvas.editor, A, true)).toBe(false)
		expect(setRelationHidden(canvas.editor, 'shape:gone' as TLShapeId, true)).toBe(false)
		expect(isHiddenRelation(canvas.shapes.get(A))).toBe(false)
	})

	it('reads false for a shape that is not an arrow, whatever it carries', () => {
		const canvas = fakeCanvas()
		canvas.shapes.set(A, makeShape(A, { 'lifeboard:relHidden': true }))
		expect(isHiddenRelation(canvas.shapes.get(A))).toBe(false)
		expect(isHiddenRelation(undefined)).toBe(false)
	})
})

describe('isRelation', () => {
	it('is true for an arrow bound at both ends, and false for the shapes it joins', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!

		expect(isRelation(canvas.editor, canvas.shapes.get(arrowId))).toBe(true)
		expect(relationEnds(canvas.editor, canvas.shapes.get(arrowId))).toEqual({ from: A, to: B })
		expect(isRelation(canvas.editor, canvas.shapes.get(A))).toBe(false)
	})

	it('is false for an arrow with a loose end — that is a drawing', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!
		// Unbind the end, which is what dragging that terminal into empty space does.
		canvas.bindings.splice(
			canvas.bindings.findIndex((b) => b.props.terminal === 'end'),
			1
		)

		expect(isRelation(canvas.editor, canvas.shapes.get(arrowId))).toBe(false)
		// And the reader agrees, which is the point of the shared definition.
		expect(canvas.readEdges().all).toEqual([])
	})

	it('is false for a missing shape', () => {
		const canvas = fakeCanvas()
		expect(isRelation(canvas.editor, undefined)).toBe(false)
	})
})

describe('disconnectShapes', () => {
	it('removes the arrow and the edge with it', () => {
		const canvas = fakeCanvas()
		const arrowId = connectShapes(canvas.editor, A, B)!

		expect(disconnectShapes(canvas.editor, arrowId)).toBe(true)
		expect(canvas.readEdges().all).toEqual([])
		expect(canvas.shapes.has(arrowId)).toBe(false)
	})

	it('reports nothing to do for a missing arrow', () => {
		const canvas = fakeCanvas()
		expect(disconnectShapes(canvas.editor, 'shape:gone' as TLShapeId)).toBe(false)
	})

	it('refuses to delete a shape that is not an arrow', () => {
		const canvas = fakeCanvas()
		// An id mix-up must not silently delete the node the relation pointed at.
		expect(disconnectShapes(canvas.editor, A)).toBe(false)
		expect(canvas.shapes.has(A)).toBe(true)
	})
})
