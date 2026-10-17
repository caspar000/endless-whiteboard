import { atom } from '@lifeboard/canvas'

/**
 * Skill trees as vault data (docs/skill-tree-plan.md, "Tree definitions"): the one copy of every
 * tree, its nodes and their requirements, that every board's node shapes are drawn from. A node shape
 * is a view of a node here; edit it on any board and the definition changes, and every board showing
 * that node follows.
 *
 * Deleting a node leaves a tombstone in `removed`. That is what lets a board tell "deleted on another
 * board" (remove my shape) from "this definition hasn't heard of it yet" (an older vault, a shape made
 * offline: add it), so a stale copy of the vault can never delete anyone's nodes.
 */
export interface NodeDef {
	nodeId: string
	name: string
	kind: string
	icon: string
	sector: string
	ring: string
	requires: string
}

export interface TreeDef {
	treeId: string
	name: string
	goal: string
	/** Comma-separated, in fan order. */
	sectors: string
	rings: string
	/** A node of another tree this tree hangs from, so a view of that node shows this tree too ('' for none). */
	mount: string
	nodes: NodeDef[]
	/** Node ids deleted from this tree. */
	removed: string[]
}

export type TreeDefs = Readonly<Record<string, TreeDef>>

export const NODE_FIELDS = ['name', 'kind', 'icon', 'sector', 'ring', 'requires'] as const
export const TREE_FIELDS = ['name', 'goal', 'sectors', 'rings', 'mount'] as const
export type TreeMeta = Pick<TreeDef, (typeof TREE_FIELDS)[number]>

const trees = atom<TreeDefs>('lifeboard:skill-trees', {})
let persist: ((value: TreeDefs) => void) | null = null

export const getTreeDefs = (): TreeDefs => trees.get()
export const getTreeDef = (treeId: string): TreeDef | undefined => trees.get()[treeId]

export function setTreeDefsPersistence(listener: ((value: TreeDefs) => void) | null): void {
	persist = listener
}

function commit(next: TreeDefs): void {
	if (JSON.stringify(next) === JSON.stringify(trees.get())) return
	trees.set(next)
	persist?.(next)
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

function parseNode(raw: unknown): NodeDef | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (!str(r.nodeId)) return null
	return { nodeId: str(r.nodeId), name: str(r.name), kind: str(r.kind) || 'skill', icon: str(r.icon), sector: str(r.sector), ring: str(r.ring), requires: str(r.requires) }
}

export function parseTreeDef(raw: unknown): TreeDef | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (!str(r.treeId)) return null
	return {
		treeId: str(r.treeId),
		name: str(r.name),
		goal: str(r.goal),
		sectors: str(r.sectors),
		rings: str(r.rings),
		mount: str(r.mount),
		nodes: (Array.isArray(r.nodes) ? r.nodes : []).map(parseNode).filter((n): n is NodeDef => !!n),
		removed: (Array.isArray(r.removed) ? r.removed : []).filter((id): id is string => typeof id === 'string'),
	}
}

/** Loads the vault's copy (localStorage or the server); drops what it can't read. Not persisted back. */
export function replaceTreeDefs(raw: unknown): void {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
	const next: Record<string, TreeDef> = {}
	for (const value of Object.values(raw as Record<string, unknown>)) {
		const def = parseTreeDef(value)
		if (def) next[def.treeId] = def
	}
	trees.set(next)
}

const emptyTree = (treeId: string): TreeDef => ({ treeId, name: '', goal: '', sectors: '', rings: '', mount: '', nodes: [], removed: [] })

/** Adds or updates one node; un-deletes it if it had been deleted (an undo, say). */
export function upsertNodeDef(treeId: string, node: NodeDef): void {
	if (!treeId || !node.nodeId) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	const at = tree.nodes.findIndex((n) => n.nodeId === node.nodeId)
	const nodes = at < 0 ? [...tree.nodes, node] : tree.nodes.map((n, i) => (i === at ? node : n))
	commit({ ...trees.get(), [treeId]: { ...tree, nodes, removed: tree.removed.filter((id) => id !== node.nodeId) } })
}

/** Adds or updates many nodes of one tree in a single change: one write, one redraw. */
export function upsertNodeDefs(treeId: string, nodes: readonly NodeDef[]): void {
	if (!treeId || !nodes.length) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	const byId = new Map(tree.nodes.map((n) => [n.nodeId, n]))
	for (const node of nodes) if (node.nodeId) byId.set(node.nodeId, node)
	const ids = new Set(nodes.map((n) => n.nodeId))
	commit({ ...trees.get(), [treeId]: { ...tree, nodes: [...byId.values()], removed: tree.removed.filter((id) => !ids.has(id)) } })
}

/** Deletes a node from its tree, leaving a tombstone. */
export function removeNodeDef(treeId: string, nodeId: string): void {
	const tree = trees.get()[treeId]
	if (!tree || !tree.nodes.some((n) => n.nodeId === nodeId)) return
	commit({
		...trees.get(),
		[treeId]: { ...tree, nodes: tree.nodes.filter((n) => n.nodeId !== nodeId), removed: [...new Set([...tree.removed, nodeId])] },
	})
}

/** Sets a tree's name, goal, sectors, rings or mount, making the tree if there is none. */
export function updateTreeMeta(treeId: string, meta: Partial<TreeMeta>): void {
	if (!treeId) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	commit({ ...trees.get(), [treeId]: { ...tree, ...meta } })
}

/** Removes a whole tree from the vault. Its shapes on boards become loose copies. */
export function removeTreeDef(treeId: string): void {
	if (!trees.get()[treeId]) return
	const next = { ...trees.get() }
	delete next[treeId]
	commit(next)
}

/** For tests. */
export function resetTreeDefs(): void {
	trees.set({})
}

/** What one board holds of a tree: its node shapes' fields, by node id. */
export type BoardNodes = ReadonlyMap<string, NodeDef>

/**
 * How a board and the vault reconcile, for one tree, when the board opens or the vault changes:
 * nodes the vault has never heard of are added to it, nodes it deleted are removed from the board,
 * and every other node takes the vault's fields. Pure.
 */
export function reconcile(def: TreeDef | undefined, board: BoardNodes): { adopt: NodeDef[]; remove: string[]; update: NodeDef[] } {
	const adopt: NodeDef[] = []
	const remove: string[] = []
	const update: NodeDef[] = []
	for (const [nodeId, shape] of board) {
		const known = def?.nodes.find((n) => n.nodeId === nodeId)
		if (known) {
			if (NODE_FIELDS.some((f) => known[f] !== shape[f])) update.push(known)
		} else if (def?.removed.includes(nodeId)) remove.push(nodeId)
		else adopt.push(shape)
	}
	return { adopt, remove, update }
}
