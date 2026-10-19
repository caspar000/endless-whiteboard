/// <reference lib="webworker" />
import { takeBandReport } from './bands'
import type { GraphEdge, GraphNode } from './layout'
import type { LayoutConfig } from './layoutDefaults'
import { wholeLayout } from './wholeLayout'

/**
 * The whole-life layout off the main thread (layoutAsync.ts): the slow placements (compacted cones and
 * bubbles) take seconds, and here the board stays usable while they run. Nothing here needs the canvas.
 */
export interface LayoutJob {
	job: number
	nodes: GraphNode[]
	edges: GraphEdge[]
	skills: string[]
	start: string
	arrows: GraphEdge[]
	config: LayoutConfig
}

export interface LayoutDone {
	job: number
	at: [string, { x: number; y: number }][]
	bands: ReturnType<typeof takeBandReport>
	ms: number
}

self.onmessage = (e: MessageEvent<LayoutJob>) => {
	const { job, nodes, edges, skills, start, arrows, config } = e.data
	const began = performance.now()
	const skill = new Set(skills)
	const at = wholeLayout(nodes, edges, { isSkill: (id) => skill.has(id), start, arrows, config })
	const done: LayoutDone = { job, at: [...at], bands: takeBandReport(), ms: performance.now() - began }
	self.postMessage(done)
}
