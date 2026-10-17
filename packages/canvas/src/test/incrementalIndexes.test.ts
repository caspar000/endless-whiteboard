import {
	createShapeId,
	getIndexBetween,
	type TLArrowBinding,
	type TLShape,
	type TLShapeId,
	type TLUnknownBinding,
} from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

/*
 * The child order and the binding indexes are kept up to date from the store's history instead of
 * being rebuilt (docs/performance-plan.md, phase 5). These tests make random changes and compare each
 * answer with one computed from scratch, which is what the indexes used to do.
 */

let editor: TestEditor
afterEach(() => editor?.dispose())

/** A small seeded generator, so a failure reproduces. */
function random(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) >>> 0
		return seed / 2 ** 32
	}
}

it('keeps the children of a parent, and the page, in index order through random reorders', () => {
	editor = new TestEditor()
	const rand = random(7)
	const ids = Array.from({ length: 60 }, (_, i) => createShapeId(`s${i}`))
	const frame = createShapeId('frame')
	editor.createShapes([
		{ id: frame, type: 'frame', x: -5000, y: -5000, props: { w: 100, h: 100 } },
		...ids.map((id, i) => ({ id, type: 'geo' as const, x: i * 10, y: 0, props: { w: 5, h: 5 } })),
	])
	const page = editor.getCurrentPageId()

	for (let round = 0; round < 40; round++) {
		editor.run(() => {
			// A few changes per transaction, as a drag or a paste makes, and sometimes many.
			const count = rand() < 0.2 ? 20 : 1 + Math.floor(rand() * 3)
			for (let k = 0; k < count; k++) {
				const id = ids[Math.floor(rand() * ids.length)]!
				const shape = editor.getShape(id)!
				if (rand() < 0.1) {
					editor.reparentShapes([id], shape.parentId === page ? frame : page)
					continue
				}
				const siblings = editor.getSortedChildIdsForParent(shape.parentId)
				const at = Math.floor(rand() * (siblings.length + 1))
				const below = at > 0 ? editor.getShape(siblings[at - 1]!)!.index : null
				const above = at < siblings.length ? editor.getShape(siblings[at]!)!.index : null
				if (below === shape.index || above === shape.index) continue
				editor.updateShape({ id, type: 'geo', index: getIndexBetween(below, above) })
			}
		})
		// The page in z-order, computed the way it was before: sort everything, then pull each shape's
		// children out after it.
		const byIndex = (a: TLShape, b: TLShape) =>
			a.index < b.index ? -1 : a.index > b.index ? 1 : 0
		const remaining = new Set([...editor.getCurrentPageShapes()].sort(byIndex))
		const reference: string[] = []
		const take = (shape: TLShape) => {
			reference.push(shape.id)
			remaining.delete(shape)
			remaining.forEach((other) => {
				if (other.parentId === shape.id) take(other)
			})
		}
		remaining.forEach((shape) => {
			if (shape.parentId === page) take(shape)
		})
		expect(editor.getCurrentPageShapesSorted().map((shape) => shape.id)).toEqual(reference)

		for (const parent of [page, frame] as const) {
			const expected = editor
				.getCurrentPageShapes()
				.filter((shape) => shape.parentId === parent)
				.sort((a, b) => (a.index < b.index ? -1 : a.index > b.index ? 1 : 0))
				.map((shape) => shape.id)
			expect(editor.getSortedChildIdsForParent(parent)).toEqual(expected)
		}
	}
})

it('keeps the binding indexes equal to a rebuild through random binds and unbinds', () => {
	editor = new TestEditor()
	const rand = random(11)
	const boxes = Array.from({ length: 12 }, (_, i) => createShapeId(`box${i}`))
	const arrows = Array.from({ length: 16 }, (_, i) => createShapeId(`arrow${i}`))
	editor.createShapes([
		...boxes.map((id, i) => ({ id, type: 'geo' as const, x: i * 200, y: 0, props: { w: 100, h: 100 } })),
		...arrows.map((id, i) => ({
			id,
			type: 'arrow' as const,
			x: i * 50,
			y: 400,
			props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } },
		})),
	])
	const anchor = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
	const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)]!
	const bindings = () => editor.store.query.records('binding').get() as unknown as TLUnknownBinding[]

	for (let round = 0; round < 60; round++) {
		editor.run(() => {
			for (let k = 0, n = 1 + Math.floor(rand() * 4); k < n; k++) {
				const arrow = pick(arrows)
				const terminal = rand() < 0.5 ? 'start' : 'end'
				const existing = bindings().find(
					(b) => b.fromId === arrow && (b as TLArrowBinding).props.terminal === terminal
				)
				if (existing && rand() < 0.4) editor.deleteBindings([existing.id])
				else if (existing) editor.updateBinding<TLArrowBinding>({ ...(existing as TLArrowBinding), toId: pick(boxes) })
				else
					editor.createBindings([{ type: 'arrow', fromId: arrow, toId: pick(boxes), props: { terminal, ...anchor } }])
			}
		})

		const all = bindings()
		for (const arrow of arrows) {
			for (const end of ['start', 'end'] as const) {
				const expected = all.find(
					(b) => b.fromId === arrow && (b as TLArrowBinding).props.terminal === end
				)
				expect(editor.getArrowBinding(arrow, end)?.id).toBe(expected?.id)
			}
		}
		const sorted = (ids: string[]) => [...ids].sort()
		for (const shape of [...boxes, ...arrows] as TLShapeId[]) {
			expect(sorted(editor.getBindingsInvolvingShape(shape).map((b) => b.id))).toEqual(
				sorted(all.filter((b) => b.fromId === shape || b.toId === shape).map((b) => b.id))
			)
			expect(sorted(editor.getArrowsBoundTo(shape).map((a) => `${a.arrowId}:${a.handleId}`))).toEqual(
				sorted(
					all
						.filter((b) => b.toId === shape && b.type === 'arrow')
						.map((b) => `${b.fromId}:${(b as TLArrowBinding).props.terminal}`)
				)
			)
		}
	}
})
