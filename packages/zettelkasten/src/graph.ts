import { indexToLetters, lettersToIndex, parseZid, type Segment } from './ids'
import { keywordKey } from './links'

/**
 * The graph view's model (docs/zettelkasten-plan.md, "Graph"): a dot per note, and lines for the two
 * kinds of tie a note has. Its place, drawn solid: a line to the note it was written behind. And its
 * links, drawn dashed. Keywords and sources can be shown as dots of their own, joined to their notes.
 * Pure, so the rules can be tested without a canvas.
 */

export type GraphNodeKind = 'note' | 'keyword' | 'source'
export type GraphEdgeKind = 'order' | 'link' | 'keyword' | 'cite'

export interface GraphNode {
	/** `n:25a`, `k:society`, `s:c1`. */
	id: string
	kind: GraphNodeKind
	/** What the box calls it: the note's or source's number, or the keyword. */
	key: string
	/** Shown beside the dot: `25a We live in a society`. */
	label: string
	/** A note that starts a train of thought (`25`), drawn a little larger. */
	head?: boolean
}

export interface GraphEdge {
	source: string
	target: string
	kind: GraphEdgeKind
}

/** Which of the graph's layers are shown; `order` and `links` by default, the rest on request (Q18). */
export interface GraphLayers {
	order: boolean
	links: boolean
	keywords: boolean
	sources: boolean
}

export const DEFAULT_LAYERS: GraphLayers = { order: true, links: true, keywords: false, sources: false }

/** What the graph needs to know about one note. */
export interface GraphNote {
	zid: string
	name: string
	/** Notes and sources it links to (links.ts, `outgoingLinks`). */
	links: readonly string[]
	keywords: readonly string[]
	cites: readonly string[]
}

function format(segments: readonly Segment[]): string {
	return segments.map(String).join('')
}

/** The place a note was written behind: the one before it on its line, or the note it branched off. */
function placedBehind(zid: string): string | null {
	const segments = parseZid(zid)
	if (!segments) return null
	const last = segments[segments.length - 1]!
	const index = typeof last === 'number' ? last : lettersToIndex(last)
	if (index > 1) {
		const before = typeof last === 'number' ? index - 1 : indexToLetters(index - 1)
		return format([...segments.slice(0, -1), before])
	}
	return segments.length > 1 ? format(segments.slice(0, -1)) : null
}

/**
 * The note a note hangs from in the graph's order: the nearest one still in the box that it was
 * written behind, passing over deleted numbers. A top-level note hangs from the train before it, so
 * the trains form one long line as the box does; the first note hangs from nothing.
 */
export function orderParent(zid: string, exists: (zid: string) => boolean): string | null {
	for (let at = placedBehind(zid); at !== null; at = placedBehind(at)) {
		if (exists(at)) return at
	}
	return null
}

/** The graph for a box's notes and sources, with the layers asked for. */
export function buildGraph(
	notes: readonly GraphNote[],
	sources: readonly { zid: string; label: string }[],
	layers: GraphLayers
): { nodes: GraphNode[]; edges: GraphEdge[] } {
	const nodes: GraphNode[] = []
	const edges: GraphEdge[] = []
	const noteIds = new Set(notes.map((note) => note.zid))
	const sourceIds = new Set(sources.map((source) => source.zid))
	for (const note of notes) {
		const segments = parseZid(note.zid)
		nodes.push({
			id: `n:${note.zid}`,
			kind: 'note',
			key: note.zid,
			label: note.name ? `${note.zid} ${note.name}` : note.zid,
			head: segments?.length === 1,
		})
		if (layers.order) {
			const parent = orderParent(note.zid, (zid) => noteIds.has(zid))
			if (parent) edges.push({ source: `n:${note.zid}`, target: `n:${parent}`, kind: 'order' })
		}
		if (layers.links) {
			for (const target of note.links) {
				if (noteIds.has(target)) edges.push({ source: `n:${note.zid}`, target: `n:${target}`, kind: 'link' })
				else if (layers.sources && sourceIds.has(target)) {
					edges.push({ source: `n:${note.zid}`, target: `s:${target}`, kind: 'link' })
				}
			}
		}
		if (layers.sources) {
			for (const source of note.cites) {
				if (sourceIds.has(source)) edges.push({ source: `n:${note.zid}`, target: `s:${source}`, kind: 'cite' })
			}
		}
	}
	if (layers.keywords) {
		const seen = new Map<string, string>()
		for (const note of notes) {
			for (const keyword of note.keywords) {
				const key = keywordKey(keyword)
				if (!key) continue
				if (!seen.has(key)) {
					seen.set(key, keyword.trim())
					nodes.push({ id: `k:${key}`, kind: 'keyword', key: keyword.trim(), label: `# ${keyword.trim()}` })
				}
				edges.push({ source: `n:${note.zid}`, target: `k:${key}`, kind: 'keyword' })
			}
		}
	}
	if (layers.sources) {
		for (const source of sources) {
			nodes.push({ id: `s:${source.zid}`, kind: 'source', key: source.zid, label: `${source.zid} ${source.label}`.trim() })
		}
	}
	return { nodes, edges }
}
