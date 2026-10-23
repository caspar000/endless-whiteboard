import { createShapeId } from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

/**
 * How long bulk work on relations takes, at sizes where a cost per relation that grows with the board
 * shows (docs/performance-plan.md, phase 5). A measurement, not a check, so it runs only on request:
 * `LB_BENCH=1 pnpm exec vitest run src/test/bulkRelations.bench.test.ts`, with `LB_BENCH_SIZES` for
 * other sizes. It prints one `BENCH` line per size.
 */
const sizes = (process.env.LB_BENCH_SIZES ?? '1000,2000,4000').split(',').map(Number)

const describeIfBench = process.env.LB_BENCH ? describe : describe.skip

describeIfBench('bulk relations', () => {
	for (const n of sizes) {
		it(`at ${n} nodes`, () => {
			// The test editor fakes the clock, which would make every measurement zero.
			jest.useRealTimers()
			const ms = (fn: () => void) => {
				const start = process.hrtime.bigint()
				fn()
				return Math.round(Number(process.hrtime.bigint() - start) / 1e6)
			}
			const editor = new TestEditor()
			const nodes = Array.from({ length: n }, (_, i) => createShapeId(`node${i}`))
			const arrows = nodes.map((_, i) => createShapeId(`arrow${i}`))
			const at = (i: number) => ({ x: (i % 40) * 300, y: Math.floor(i / 40) * 250 })
			editor.createShapes(nodes.map((id, i) => ({ id, type: 'geo', ...at(i), props: { w: 200, h: 120 } })))
			const anchor = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }

			const create = ms(() =>
				editor.run(() => {
					editor.createShapes(
						arrows.map((id, i) => ({ id, type: 'arrow', ...at(i), props: { start: { x: 0, y: 0 }, end: { x: 100, y: 0 } } }))
					)
					editor.createBindings(
						arrows.flatMap((id, i) => [
							{ type: 'arrow', fromId: id, toId: nodes[i]!, props: { terminal: 'start', ...anchor } },
							{ type: 'arrow', fromId: id, toId: nodes[(i + 1) % n]!, props: { terminal: 'end', ...anchor } },
						])
					)
				})
			)
			const duplicate = ms(() => {
				editor.selectAll()
				editor.duplicateShapes(editor.getSelectedShapeIds(), { x: 0, y: 5000 })
			})
			editor.mark('before delete')
			const remove = ms(() => editor.deleteShapes(nodes))
			const undo = ms(() => editor.undo())

			expect(arrows.every((id) => editor.getArrowBinding(id, 'end'))).toBe(true)
			process.stdout.write(
				`BENCH ${n} nodes: create ${n} relations ${create}ms, duplicate all ${duplicate}ms, ` +
					`delete the nodes ${remove}ms, undo ${undo}ms\n`
			)
			editor.dispose()
		}, 600_000)
	}
})
