import { expect, test } from '@playwright/test'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Milestone 9 ("synthetic 500-node board … smooth pan/zoom") and the milestone 6 acceptance check
 * ("dev recompute counter shows zero recomputes while dragging items").
 *
 * The recompute assertion is the important one, and it is the standing tripwire for §4.3: if the
 * facts `isEqual` stage regresses, every table on the board re-queries on every pointer move and
 * a large board goes from smooth to unusable. A wall-clock timing test alone would not catch that —
 * it would just get slower on some machines and pass on others.
 */
const NODE_COUNT = 500

/** The table's displayed total, parsed back out of its formatted "₾1,234" text. */
async function readRollupTotal(page: import('@playwright/test').Page): Promise<number> {
	const text = (await page.locator('.lb-table__value').first().textContent()) ?? ''
	return Number(text.replace(/[^\d.-]/g, ''))
}

async function buildSyntheticBoard(page: import('@playwright/test').Page): Promise<void> {
	await page.evaluate((count) => {
		const editor = (
			window as unknown as {
				editor: {
					createShapes(s: unknown[]): void
					run(fn: () => void): void
					getDocumentSettings(): { meta: Record<string, unknown> }
					updateDocumentSettings(s: { meta: Record<string, unknown> }): void
				}
			}
		).editor
		const categories = ['desk', 'lighting', 'soft', 'kitchen', 'tools']
		const shapes: unknown[] = []
		const perRow = 25
		for (let i = 0; i < count; i++) {
			shapes.push({
				type: 'node.markdown',
				x: (i % perRow) * 260,
				y: Math.floor(i / perRow) * 300,
				props: { w: 220, h: 120, md: `# Item ${i}`, autoHeight: false },
				// Values in `meta`, which is what the facts pipeline now walks — for *every* shape on the
				// board, not just the ones whose type we defined. That is exactly the cost the stage-0
				// per-shape facts cache exists to absorb, so this is the board that proves it.
				meta: {
					'lifeboard:props': {
						price: (i % 97) * 13 + 5,
						category: categories[i % categories.length]!,
						tags: [categories[i % categories.length]!],
					},
				},
			})
		}
		// Two tables over the whole board, so any churn is amplified rather than hidden. One is a big
		// number, one a grouped grid — the two render paths cost different amounts, and both must be free
		// during a drag.
		for (let i = 0; i < 2; i++) {
			shapes.push({
				type: 'node.table',
				x: -400,
				y: i * 250,
				props: {
					w: 280,
					h: 200,
					title: i === 0 ? 'Total' : 'By category',
					// `shapeTypes: null` — anything carrying a price counts.
					source: { shapeTypes: null, scope: 'page', frameId: null, filters: [] },
					columns: [{ key: 'price', summary: 'sum', width: 1 }],
					groupBy: i === 0 ? null : 'category',
					sorts: [],
					layout: { mode: i === 0 ? 'value' : 'table', maxRows: 12 },
				},
			})
		}
		editor.run(() => {
			// Aggregation is registry-aware: without a definition saying `price` is currency, nothing is
			// numeric and every total would be zero.
			editor.updateDocumentSettings({
				meta: {
					...editor.getDocumentSettings().meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
						{ id: 'category', name: 'Category', type: 'select' },
						{ id: 'tags', name: 'Tags', type: 'multiSelect' },
					],
				},
			})
			editor.createShapes(shapes)
		})
	}, NODE_COUNT)
}

test.describe('performance', () => {
	test(`aggregates a ${NODE_COUNT}-node board and does not recompute while dragging`, async ({
		page,
	}) => {
		await gotoFresh(page)
		await skipFirstRunDemo(page)
		await createBoard(page, 'Perf')
		await openBoard(page, 'Perf')

		await buildSyntheticBoard(page)
		expect(
			await page.evaluate(
				() =>
					(
						window as never as { editor: { getCurrentPageShapes(): unknown[] } }
					).editor.getCurrentPageShapes().length
			)
		).toBe(NODE_COUNT + 2)

		// The tables produce a real total over all 500 notes.
		await expect(page.locator('.lb-table__value').first()).not.toHaveText('₾0')

		// Zoom out so every node is inside the viewport: culling would otherwise hide the cost this
		// test is trying to measure.
		// Braces, not a concise arrow body: tldraw's fluent methods return the editor, and returning
		// it from `page.evaluate` fails with "object reference chain is too long".
		await page.evaluate(() => {
			;(window as never as { editor: { zoomToFit(o?: unknown): void } }).editor.zoomToFit({
				animation: { duration: 0 },
			})
		})

		// --- the tripwire ---
		const baseline = await page.evaluate(() => {
			const stats = (
				window as never as {
					__rollupStats?: { factsRecomputes: number; aggregateRecomputes: number }
				}
			).__rollupStats
			if (!stats) throw new Error('rollup stats are not exposed')
			return { ...stats }
		})

		// Drag one item across the board: many x/y writes, no data change.
		const start = await page.evaluate(() => {
			const editor = (
				window as never as {
					editor: {
						getCurrentPageShapes(): { id: string; type: string }[]
						getShapePageBounds(id: string): { x: number; y: number; w: number; h: number }
						pageToScreen(p: { x: number; y: number }): { x: number; y: number }
					}
				}
			).editor
			const item = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const b = editor.getShapePageBounds(item.id)
			return editor.pageToScreen({ x: b.x + b.w / 2, y: b.y + b.h / 2 })
		})

		await page.mouse.move(start.x, start.y)
		await page.mouse.down()
		for (let i = 1; i <= 30; i++) {
			await page.mouse.move(start.x + i * 6, start.y + i * 4)
		}
		await page.mouse.up()

		const afterDrag = await page.evaluate(() => ({
			...(
				window as never as {
					__rollupStats: { factsRecomputes: number; aggregateRecomputes: number }
				}
			).__rollupStats,
		}))

		// Dragging changes x/y on every pointer move, which invalidates the facts computed's inputs —
		// but the extracted facts are identical, so `areFactsMapsEqual` short-circuits and no rollup
		// re-aggregates. This must be exactly zero, not merely "small".
		expect(afterDrag.aggregateRecomputes - baseline.aggregateRecomputes).toBe(0)

		// Editing a price, by contrast, *must* recompute — otherwise the rollup is stale and this test
		// would happily pass on a completely broken pipeline.
		//
		// The edit touches **only `meta`**, which is the regression this guards: every comparator in the
		// pipeline used to compare `props` alone, so a property edit was invisible and the total silently
		// never moved.
		const totalBefore = await readRollupTotal(page)
		await page.evaluate(() => {
			const editor = (
				window as never as {
					editor: {
						getCurrentPageShapes(): {
							id: string
							type: string
							meta: Record<string, unknown>
						}[]
						updateShape(s: unknown): void
					}
				}
			).editor
			const item = editor.getCurrentPageShapes().find((s) => s.type === 'node.markdown')!
			const values = item.meta['lifeboard:props'] as Record<string, unknown>
			editor.updateShape({
				id: item.id,
				type: 'node.markdown',
				meta: { 'lifeboard:props': { ...values, price: 999_999 } },
			})
		})
		// One item's price jumped to 999,999, so the total must climb by roughly that much. Asserting
		// the *delta* rather than a hardcoded total keeps the test honest if the synthetic data changes.
		await expect.poll(() => readRollupTotal(page)).toBeGreaterThan(totalBefore + 900_000)

		const afterEdit = await page.evaluate(() => ({
			...(window as never as { __rollupStats: { aggregateRecomputes: number } }).__rollupStats,
		}))
		expect(afterEdit.aggregateRecomputes).toBeGreaterThan(afterDrag.aggregateRecomputes)
	})
})
