import type { Editor } from '@lifeboard/canvas'
import { isDraft, isSkill, isTree, type SkillShape, type TreeShape } from './board'
import type { GraphEdge } from './tree/layout'
import { prerequisitesOf } from './tree/prerequisites'
import { getTreeDefs, type NodeDef, type TreeDef, type TreeDefs, type TreeMeta } from './treeDefs'

/**
 * Every tree in the vault as one graph, and what a view of it reaches (docs/skill-tree-plan.md,
 * "Views"). A tree header on a board is a view: it shows its root and everything that grows from it,
 * which takes in other trees mounted on any node it reaches. A view of Mastery shows every pillar and
 * every tree on them; a view of one pillar shows that pillar's trees; a view of one node, its branch.
 */
export interface TreeGraph {
	/** Every node, with the tree it belongs to. */
	nodes: ReadonlyMap<string, { treeId: string; def: NodeDef }>
	/** Prerequisite edges inside a tree, drawn as arrows. */
	prerequisites: GraphEdge[]
	/** From a mount node to the root of a tree mounted on it, drawn as arrows. */
	mounts: (GraphEdge & { treeId: string })[]
	/** From a tree's root to its nodes with no prerequisites (method nodes, say): undrawn, for layout and reach. */
	loose: GraphEdge[]
	/** Each tree's root node. */
	rootOf: ReadonlyMap<string, string>
}

/** A tree's root: its node of kind root (or mastery), else its first node without prerequisites, else its first node. */
export function rootOfTree(nodes: readonly Pick<NodeDef, 'nodeId' | 'kind' | 'requires'>[]): string {
	const ids = new Set(nodes.map((n) => n.nodeId))
	const loose = nodes.filter((n) => !prerequisitesOf(n.requires).some((p) => ids.has(p)))
	return (nodes.find((n) => n.kind === 'root' || n.kind === 'mastery') ?? loose[0] ?? nodes[0])?.nodeId ?? ''
}

export function treeGraph(trees: TreeDefs): TreeGraph {
	const nodes = new Map<string, { treeId: string; def: NodeDef }>()
	const prerequisites: GraphEdge[] = []
	const loose: GraphEdge[] = []
	const rootOf = new Map<string, string>()
	for (const tree of Object.values(trees)) {
		const ids = new Set(tree.nodes.map((n) => n.nodeId))
		const root = rootOfTree(tree.nodes)
		if (root) rootOf.set(tree.treeId, root)
		for (const node of tree.nodes) {
			nodes.set(node.nodeId, { treeId: tree.treeId, def: node })
			const pre = prerequisitesOf(node.requires).filter((p) => ids.has(p) && p !== node.nodeId)
			for (const from of pre) prerequisites.push({ from, to: node.nodeId })
			if (!pre.length && node.nodeId !== root && root) loose.push({ from: root, to: node.nodeId })
		}
	}
	const mounts = Object.values(trees).flatMap((tree) => {
		const root = rootOf.get(tree.treeId)
		const at = nodes.get(tree.mount)
		// A tree can't hang from itself; a mount on a missing node is ignored until the node exists.
		return root && at && at.treeId !== tree.treeId ? [{ from: tree.mount, to: root, treeId: tree.treeId }] : []
	})
	return { nodes, prerequisites, mounts, loose, rootOf }
}

/** Every node a view starting at `start` shows: it, and everything reachable through any edge. */
export function reachFrom(graph: TreeGraph, start: string): Set<string> {
	const out = new Map<string, string[]>()
	for (const e of [...graph.prerequisites, ...graph.mounts, ...graph.loose]) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
	const seen = new Set<string>()
	if (!graph.nodes.has(start)) return seen
	const queue = [start]
	seen.add(start)
	for (let i = 0; i < queue.length; i++) {
		for (const next of out.get(queue[i]!) ?? []) {
			if (seen.has(next)) continue
			seen.add(next)
			queue.push(next)
		}
	}
	return seen
}

/** Where a header's view starts: its chosen root, else its tree's root. */
export function viewStart(graph: TreeGraph, header: Pick<TreeShape['props'], 'treeId' | 'root'>): string {
	return header.root && graph.nodes.has(header.root) ? header.root : (graph.rootOf.get(header.treeId) ?? '')
}

/**
 * The vault's trees as this board sees them: with its draft nodes (an import not yet confirmed)
 * added, so a draft can be laid out and evaluated before it joins the vault.
 */
export function boardTrees(editor: Editor): TreeDefs {
	const drafts = editor.getCurrentPageShapes().filter((s): s is SkillShape => isSkill(s) && isDraft(s) && !!s.props.treeId)
	if (!drafts.length) return getTreeDefs()
	const out: Record<string, TreeDef> = { ...getTreeDefs() }
	for (const shape of drafts) {
		const header = editor.getCurrentPageShapes().find((s): s is TreeShape => isTree(s) && s.props.treeId === shape.props.treeId)
		const tree = out[shape.props.treeId] ?? {
			treeId: shape.props.treeId,
			name: header?.props.name ?? draftTreeMeta(shape).name ?? '',
			goal: header?.props.goal ?? draftTreeMeta(shape).goal ?? '',
			sectors: header?.props.sectors ?? '',
			rings: header?.props.rings ?? '',
			mount: draftMount(shape),
			nodes: [],
			removed: [],
			draft: '',
		}
		if (tree.nodes.some((n) => n.nodeId === shape.props.nodeId)) continue
		const { nodeId, name, kind, icon, sector, ring, requires } = shape.props
		out[shape.props.treeId] = { ...tree, mount: tree.mount || draftMount(shape), nodes: [...tree.nodes, { nodeId, name, kind, icon, sector, ring, requires }] }
	}
	return out
}

/**
 * Meta on a draft node carrying its tree's name, goal and mount until the draft is confirmed: a tree
 * mounted on another has no header of its own to carry them.
 */
export const DRAFT_TREE_META = 'lifeboard:skillTreeMeta'

export function draftTreeMeta(shape: SkillShape): Partial<TreeMeta> {
	const raw = shape.meta[DRAFT_TREE_META]
	if (!raw || typeof raw !== 'object') return {}
	const r = raw as Record<string, unknown>
	const out: Partial<TreeMeta> = {}
	for (const key of ['name', 'goal', 'sectors', 'rings', 'mount'] as const) if (typeof r[key] === 'string') out[key] = r[key] as string
	return out
}

const draftMount = (shape: SkillShape) => draftTreeMeta(shape).mount ?? ''

/** What one tree view shows, and what each shown item hangs from. */
export interface ViewContents {
	/** Which arrangement this is, for remembering where things were: `overview`, `all`, `focus:<id>`. */
	context: string
	/** The node or item at the middle of the layout. */
	start: string
	skills: Set<string>
	/** Items drawn, by id: what they hang from (a skill node id, or their parent item's id) and how. */
	items: Map<string, { parent: string; variant: 'entry' | 'work' }>
}

type ItemLike = { itemId: string; parent: string; children: readonly string[]; tags: readonly string[] }

/** Skill nodes within `depth` steps of a node, through any edge, either way. */
function neighbourhood(graph: TreeGraph, node: string, depth: number, within: ReadonlySet<string>): Set<string> {
	const adjacent = new Map<string, string[]>()
	for (const e of [...graph.prerequisites, ...graph.mounts, ...graph.loose]) {
		adjacent.set(e.from, [...(adjacent.get(e.from) ?? []), e.to])
		adjacent.set(e.to, [...(adjacent.get(e.to) ?? []), e.from])
	}
	const seen = new Set([node])
	let ring = [node]
	for (let step = 0; step < depth; step++) {
		const next: string[] = []
		for (const id of ring) for (const n of adjacent.get(id) ?? []) if (within.has(n) && !seen.has(n)) (seen.add(n), next.push(n))
		ring = next
	}
	return seen
}

/**
 * The nodes and items a header shows (docs/skill-tree-plan.md, "Rebuild"). Pure.
 *
 * - **overview**: the skill nodes its view reaches.
 * - **all**: those, every entry tagged to one of them, and every entry's works.
 * - **focus** on a skill node: it, its entries with their works, and its neighbouring skill nodes
 *   within `depth` steps, folded. On an entry (or one of its works): the entry with its works, the
 *   other entries of its skill node folded, and that node's neighbourhood.
 *
 * An entry hangs from the first of its tags that the view reaches; an entry tagged to nothing in
 * reach is not in this tree.
 */
export function viewContents(
	graph: TreeGraph,
	items: Readonly<Record<string, ItemLike>>,
	header: { treeId: string; root: string; mode: string; focus: string },
	depth: number
): ViewContents {
	const start = viewStart(graph, header)
	const reach = reachFrom(graph, start)
	const attached = new Map<string, string[]>()
	const attachOf = new Map<string, string>()
	for (const item of Object.values(items)) {
		if (item.parent) continue
		const node = item.tags.find((t) => reach.has(t))
		if (!node) continue
		attached.set(node, [...(attached.get(node) ?? []), item.itemId])
		attachOf.set(item.itemId, node)
	}
	const shown = new Map<string, { parent: string; variant: 'entry' | 'work' }>()
	const unfurl = (itemId: string, parent: string, variant: 'entry' | 'work', depthLeft = 16) => {
		const item = items[itemId]
		if (!item || depthLeft < 0) return
		shown.set(itemId, { parent, variant })
		for (const child of item.children) unfurl(child, itemId, 'work', depthLeft - 1)
	}

	if (header.mode === 'all') {
		for (const node of reach) for (const id of attached.get(node) ?? []) unfurl(id, node, 'entry')
		return { context: 'all', start, skills: reach, items: shown }
	}
	if (header.mode === 'focus' && header.focus) {
		if (reach.has(header.focus)) {
			for (const id of attached.get(header.focus) ?? []) unfurl(id, header.focus, 'entry')
			return { context: `focus:${header.focus}`, start: header.focus, skills: neighbourhood(graph, header.focus, depth, reach), items: shown }
		}
		// An item: climb to its entry, the thing tagged to a skill node.
		let top = items[header.focus]
		for (let guard = 0; top?.parent && guard < 16; guard++) top = items[top.parent]
		const node = top && attachOf.get(top.itemId)
		if (top && node) {
			for (const id of attached.get(node) ?? []) if (id !== top.itemId) shown.set(id, { parent: node, variant: 'entry' })
			unfurl(top.itemId, node, 'entry')
			return { context: `focus:${top.itemId}`, start: top.itemId, skills: neighbourhood(graph, node, depth, reach), items: shown }
		}
	}
	return { context: 'overview', start, skills: reach, items: shown }
}
