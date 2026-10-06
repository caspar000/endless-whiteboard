import { test, type CDPSession, type Page } from '@playwright/test'
import { createBoard, gotoFresh, openBoard, skipFirstRunDemo } from './helpers'

/**
 * Canvas timings on the 500-node board `perf.spec.ts` uses, for comparing canvas engines (the fork
 * against tldraw 5, docs/canvas-fork-plan.md phase 7). Opt-in, because the numbers depend on the
 * machine: `LB_BENCH=1 pnpm exec playwright test e2e/bench.spec.ts`. It prints one `BENCH` line.
 *
 * Each gesture (60 inputs, 16 ms apart) runs three times and the median of each figure is reported.
 * The main figure is main-thread work, from Chrome's own counters (`Performance.getMetrics`): at full
 * speed both engines sit at the frame cap, so frame times alone say little, and slowing the CPU down
 * makes Playwright's input crawl until runs never finish.
 */
test.skip(!process.env.LB_BENCH, 'Set LB_BENCH=1 to run the canvas benchmark.')

const NODES = 500
const RUNS = 3

interface FrameStats {
	/** For a drag: how far the note moved at the far end. */
	moved: number
	/** Main-thread time spent during the gesture, and the script, layout and style parts of it. */
	taskMs: number
	scriptMs: number
	layoutMs: number
	styleMs: number
	frames: number
	meanMs: number
	p95Ms: number
	maxMs: number
	longTasks: number
}

/** Builds the board in the page and returns how long creating it took and how long until it settled. */
function buildBoard(page: Page) {
	return page.evaluate(async (count) => {
		const editor = (window as unknown as { editor: Record<string, (...args: unknown[]) => unknown> })
			.editor
		const categories = ['desk', 'lighting', 'soft', 'kitchen', 'tools']
		const shapes: unknown[] = []
		for (let i = 0; i < count; i++) {
			shapes.push({
				type: 'node.markdown',
				x: (i % 25) * 260,
				y: Math.floor(i / 25) * 300,
				props: { w: 220, h: 120, md: `# Item ${i}`, autoHeight: false },
				meta: {
					'lifeboard:props': {
						price: (i % 97) * 13 + 5,
						category: categories[i % categories.length]!,
					},
				},
			})
		}
		for (let i = 0; i < 2; i++) {
			shapes.push({
				type: 'node.table',
				x: -400,
				y: i * 250,
				props: {
					w: 280,
					h: 200,
					title: i === 0 ? 'Total' : 'By category',
					source: { shapeTypes: null, scope: 'page', frameId: null, filters: [] },
					columns: [{ key: 'price', summary: 'sum', width: 1 }],
					groupBy: i === 0 ? null : 'category',
					sorts: [],
					layout: { mode: i === 0 ? 'value' : 'table', maxRows: 12 },
				},
			})
		}
		const start = performance.now()
		editor.run!(() => {
			const settings = editor.getDocumentSettings!() as { meta: Record<string, unknown> }
			editor.updateDocumentSettings!({
				meta: {
					...settings.meta,
					'lifeboard:properties': [
						{ id: 'price', name: 'Price', type: 'currency', unit: 'GEL' },
						{ id: 'category', name: 'Category', type: 'select' },
					],
				},
			})
			editor.createShapes!(shapes)
		})
		const created = performance.now() - start
		// Settled: the total shows, and two frames have passed with nothing left to draw.
		await new Promise<void>((resolve) => {
			const check = () => {
				const value = document.querySelector('.lb-board-host:not([data-hidden]) .lb-table__value')
				if (value && value.textContent !== '₾ 0.00') resolve()
				else requestAnimationFrame(check)
			}
			check()
		})
		await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
		return { createMs: created, settleMs: performance.now() - start }
	}, NODES)
}

type Gesture = (page: Page) => Promise<Omit<FrameStats, 'taskMs' | 'scriptMs' | 'layoutMs' | 'styleMs'>>

/**
 * Runs a gesture in the page: 60 inputs 16 ms apart, sent to `editor.dispatch` as the canvas's own
 * event handlers send them, while recording frames. In the page rather than through Playwright's
 * mouse, whose input acknowledgements stalled now and then on a busy board (on either engine), and
 * so that only the canvas's work is measured, not the browser's input path.
 */
function runGesture(page: Page, kind: 'drag' | 'pan') {
	return page.evaluate(async (gesture) => {
		const editor = (window as unknown as { editor: Record<string, (...args: unknown[]) => unknown> })
			.editor
		const modifiers = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, accelKey: false }
		const pointer = (name: string, point: { x: number; y: number }) =>
			editor.dispatch!({
				type: 'pointer',
				target: 'canvas',
				name,
				point: { x: point.x, y: point.y, z: 0.5 },
				pointerId: 1,
				button: 0,
				isPen: false,
				...modifiers,
			})
		const wait = () => new Promise((resolve) => setTimeout(resolve, 16))

		const times: number[] = []
		// How far the note had moved at the far end, in page units: a drag that does nothing would
		// otherwise look very fast.
		let moved = 0
		let running = true
		const loop = (time: number) => {
			times.push(time)
			if (running) requestAnimationFrame(loop)
		}
		let longTasks = 0
		const observer = new PerformanceObserver((list) => (longTasks += list.getEntries().length))
		observer.observe({ entryTypes: ['longtask'] })

		if (gesture === 'drag') {
			const shapes = editor.getCurrentPageShapes!() as { id: string; type: string }[]
			const item = shapes.find((shape) => shape.type === 'node.markdown')!
			const bounds = editor.getShapePageBounds!(item.id) as { x: number; y: number; w: number }
			const start = editor.pageToScreen!({ x: bounds.x + bounds.w / 2, y: bounds.y + 10 }) as {
				x: number
				y: number
			}
			pointer('pointer_move', start)
			await wait()
			pointer('pointer_down', start)
			await wait()
			requestAnimationFrame(loop)
			for (let i = 1; i <= 60; i++) {
				const step = i <= 30 ? i : 60 - i
				pointer('pointer_move', { x: start.x + step * 8, y: start.y + step * 6 })
				await wait()
				if (i === 30) {
					const now = editor.getShapePageBounds!(item.id) as { x: number }
					moved = Math.round(now.x - bounds.x)
				}
			}
			running = false
			pointer('pointer_up', start)
		} else {
			requestAnimationFrame(loop)
			for (let i = 0; i < 60; i++) {
				const sign = i < 30 ? 1 : -1
				editor.dispatch!({
					type: 'wheel',
					name: 'wheel',
					delta: { x: -24 * sign, y: -16 * sign, z: 0 },
					point: { x: 700, y: 400, z: 0.5 },
					...modifiers,
				})
				await wait()
			}
			running = false
		}
		observer.disconnect()
		await new Promise((resolve) => setTimeout(resolve, 100))

		const gaps = times.slice(1).map((time, i) => time - times[i]!)
		const sorted = [...gaps].sort((a, b) => a - b)
		return {
			moved,
			frames: gaps.length,
			meanMs: gaps.reduce((sum, gap) => sum + gap, 0) / Math.max(gaps.length, 1),
			p95Ms: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
			maxMs: sorted.at(-1) ?? 0,
			longTasks,
		}
	}, kind)
}

/** Drags the first note 30 steps out and 30 back. */
const drag: Gesture = (page) => runGesture(page, 'drag')

/** Pans with the wheel, 30 steps one way and 30 back. */
const pan: Gesture = (page) => runGesture(page, 'pan')

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!

function medianStats(runs: FrameStats[]): FrameStats {
	return {
		taskMs: median(runs.map((run) => run.taskMs)),
		scriptMs: median(runs.map((run) => run.scriptMs)),
		layoutMs: median(runs.map((run) => run.layoutMs)),
		styleMs: median(runs.map((run) => run.styleMs)),
		moved: median(runs.map((run) => run.moved)),
		frames: median(runs.map((run) => run.frames)),
		meanMs: median(runs.map((run) => run.meanMs)),
		p95Ms: median(runs.map((run) => run.p95Ms)),
		maxMs: median(runs.map((run) => run.maxMs)),
		longTasks: median(runs.map((run) => run.longTasks)),
	}
}

/** Chrome's running totals, in milliseconds. */
async function mainThread(cdp: CDPSession) {
	const { metrics } = (await cdp.send('Performance.getMetrics')) as { metrics: { name: string; value: number }[] }
	const read = (name: string) => (metrics.find((metric) => metric.name === name)?.value ?? 0) * 1000
	return {
		taskMs: read('TaskDuration'),
		scriptMs: read('ScriptDuration'),
		layoutMs: read('LayoutDuration'),
		styleMs: read('RecalcStyleDuration'),
	}
}

async function measure(gesture: Gesture, page: Page, cdp: CDPSession): Promise<FrameStats> {
	const runs: FrameStats[] = []
	for (let i = 0; i < RUNS; i++) {
		const before = await mainThread(cdp)
		const frames = await gesture(page)
		const after = await mainThread(cdp)
		runs.push({
			taskMs: after.taskMs - before.taskMs,
			scriptMs: after.scriptMs - before.scriptMs,
			layoutMs: after.layoutMs - before.layoutMs,
			styleMs: after.styleMs - before.styleMs,
			...frames,
		})
		await page.waitForTimeout(300)
	}
	return medianStats(runs)
}

test('canvas benchmark', async ({ page }) => {
	test.setTimeout(900_000)
	await gotoFresh(page)
	await skipFirstRunDemo(page)
	await createBoard(page, 'Bench')
	await openBoard(page, 'Bench')
	await page.mouse.click(700, 600)

	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Performance.enable')
	const board = await buildBoard(page)
	await page.waitForTimeout(1000)

	const dragAt100 = await measure(drag, page, cdp)
	const panAt100 = await measure(pan, page, cdp)

	// Every node on screen: the case culling can't help with.
	await page.evaluate(() => {
		;(window as unknown as { editor: { zoomToFit(o: unknown): void } }).editor.zoomToFit({
			animation: { duration: 0 },
		})
	})
	await page.waitForTimeout(1000)
	const dragAllVisible = await measure(drag, page, cdp)
	const panAllVisible = await measure(pan, page, cdp)

	const exportMs = await page.evaluate(async () => {
		const editor = (
			window as unknown as {
				editor: {
					getCurrentPageShapeIds(): Set<string>
					toImage(ids: string[], opts: unknown): Promise<unknown>
				}
			}
		).editor
		const ids = [...editor.getCurrentPageShapeIds()].slice(0, 400)
		const start = performance.now()
		await editor.toImage(ids, { format: 'webp', quality: 0.7, background: true, scale: 0.1 })
		return performance.now() - start
	})

	const round = (value: number) => Math.round(value * 10) / 10
	const tidy = (stats: FrameStats) =>
		Object.fromEntries(Object.entries(stats).map(([key, value]) => [key, round(value)]))
	console.log(
		'BENCH',
		JSON.stringify({
			createMs: round(board.createMs),
			settleMs: round(board.settleMs),
			dragAt100: tidy(dragAt100),
			panAt100: tidy(panAt100),
			dragAllVisible: tidy(dragAllVisible),
			panAllVisible: tidy(panAllVisible),
			exportMs: round(exportMs),
		})
	)
})
