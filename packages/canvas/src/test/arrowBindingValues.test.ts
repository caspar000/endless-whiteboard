import { createShapeId, react, type TLShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

let editor: TestEditor
const box1 = createShapeId('box1')
const box2 = createShapeId('box2')
const arrow = createShapeId('arrow')
const anchor = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([
		{ id: box1, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ id: box2, type: 'geo', x: 400, y: 0, props: { w: 100, h: 100 } },
		{ id: arrow, type: 'arrow', x: 50, y: 50, props: { start: { x: 0, y: 0 }, end: { x: 400, y: 0 } } },
	])
})
afterEach(() => editor.dispose())

const bind = () =>
	editor.createBindings([
		{ type: 'arrow', fromId: arrow, toId: box1, props: { terminal: 'start', ...anchor } },
		{ type: 'arrow', fromId: arrow, toId: box2, props: { terminal: 'end', ...anchor } },
	])

const boundTo = () => [
	editor.getArrowBinding(arrow, 'start')?.toId,
	editor.getArrowBinding(arrow, 'end')?.toId,
]

it('sees a binding in the same transaction that created it', () => {
	let during: (TLShapeId | undefined)[] = []
	editor.run(() => {
		bind()
		during = boundTo()
	})
	expect(during).toEqual([box1, box2])
	expect(boundTo()).toEqual([box1, box2])
})

it('wakes a reader when its arrow is unbound, and through undo and redo', () => {
	bind()
	editor.mark('bound')
	const seen: (TLShapeId | undefined)[][] = []
	const stop = react('arrow ends', () => {
		seen.push(boundTo())
	})
	editor.deleteShapes([box2])
	editor.undo()
	editor.redo()
	stop()
	expect(seen).toEqual([
		[box1, box2],
		[box1, undefined],
		[box1, box2],
		[box1, undefined],
	])
})

/*
 * The reason the per-arrow values exist: an arrow's geometry must not sit below the store's history,
 * or every write to anything visits every arrow. Walks the signal graph, which is internal to
 * `@tldraw/state`; if that library changes its shape this test needs the walk updated, not removed.
 */
it("keeps arrow geometry out from under the store's history", () => {
	bind()
	const stop = react('arrow geometry', () => {
		editor.getShapeGeometry(arrow)
	})
	type Node = { name: string; children?: { array?: (Node | undefined)[]; arraySize?: number; set?: Set<Node> } }
	const names: string[] = []
	const seen = new Set<Node>()
	const stack: Node[] = [editor.store.history as unknown as Node]
	while (stack.length) {
		const children = stack.pop()!.children
		const list = !children
			? []
			: children.set
				? [...children.set]
				: (children.array ?? []).slice(0, children.arraySize).filter((n): n is Node => !!n)
		for (const child of list) {
			if (seen.has(child)) continue
			seen.add(child)
			names.push(child.name)
			stack.push(child)
		}
	}
	stop()
	expect(names.length).toBeGreaterThan(0)
	expect(names.filter((name) => name.includes(arrow))).toEqual([])
})
