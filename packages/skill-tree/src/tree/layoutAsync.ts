import type { BandReport } from './bands'
import type { GraphEdge, GraphNode } from './layout'
import type { LayoutConfig } from './layoutDefaults'
import type { LayoutDone, LayoutJob } from './layoutWorker'

/**
 * Runs the whole-life layout in a worker (layoutWorker.ts) and resolves with where everything goes.
 * Where there are no workers (tests, a build without them), null: the caller lays out in place.
 */
type Point = { x: number; y: number }
export interface LayoutResult {
	at: Map<string, Point>
	bands: BandReport | null
	ms: number
}

let worker: Worker | null | undefined
let next = 0
const waiting = new Map<number, (r: LayoutResult | null) => void>()

function theWorker(): Worker | null {
	if (worker !== undefined) return worker
	try {
		worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./layoutWorker.ts', import.meta.url), { type: 'module' })
	} catch {
		worker = null
	}
	if (worker) {
		worker.onmessage = (e: MessageEvent<LayoutDone>) => {
			const done = waiting.get(e.data.job)
			waiting.delete(e.data.job)
			done?.({ at: new Map(e.data.at), bands: e.data.bands, ms: e.data.ms })
		}
		// A worker that fails to start or throws: every job still waiting falls back to the main thread.
		worker.onerror = () => {
			for (const done of waiting.values()) done(null)
			waiting.clear()
			worker = null
		}
	}
	return worker
}

/** Whether layouts can run in a worker here. */
export const canLayOutInWorker = (): boolean => theWorker() !== null

export function layoutInWorker(nodes: GraphNode[], edges: GraphEdge[], skills: ReadonlySet<string>, start: string, arrows: readonly GraphEdge[], config: LayoutConfig): Promise<LayoutResult | null> | null {
	const w = theWorker()
	if (!w) return null
	const job = ++next
	return new Promise((resolve) => {
		waiting.set(job, resolve)
		const message: LayoutJob = { job, nodes, edges, skills: [...skills], start, arrows: [...arrows], config }
		w.postMessage(message)
	})
}
