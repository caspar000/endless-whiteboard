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
	/** The board whose import added this node and has not confirmed it; absent once confirmed. */
	draft?: string
	/**
	 * The node this one grows from on a path, drawn as a line like a prerequisite but asking nothing:
	 * a tree made from a syllabus is its entries on one path, done in any order. Vault only, like `draft`.
	 */
	after?: string
	/**
	 * The item this node stands for (a path's entry): a view draws the item's works from the node rather
	 * than the item beside it. Vault only, like `draft`.
	 */
	item?: string
}

export interface TreeDef {
	treeId: string
	name: string
	goal: string
	/** Comma-separated, in fan order. */
	sectors: string
	rings: string
	/** Nodes of other trees this tree hangs from, so a view of any of them shows this tree too. */
	mounts: readonly string[]
	nodes: NodeDef[]
	/** Node ids deleted from this tree. */
	removed: string[]
	/** The board whose import made this tree and has not confirmed it; '' once confirmed. */
	draft: string
	/** Nodes ticked by hand (a `manual` requirement), node id to `YYYY-MM-DD`. Kept here, not on the shapes. */
	ticked: Readonly<Record<string, string>>
	/** What the tree was made from (a source's maker ids, `syllabus:adler/canon`): it goes when they all have. */
	madeFrom: readonly string[]
	/**
	 * Deleted: no nodes, every one of them in `removed`, kept so a board that still shows the tree drops
	 * it rather than writing it back. Making the tree again brings it back.
	 */
	deleted: boolean
}

export type TreeDefs = Readonly<Record<string, TreeDef>>

export const NODE_FIELDS = ['name', 'kind', 'icon', 'sector', 'ring', 'requires'] as const
/** A node's fields a shape carries: the rest (`draft`, `after`, `item`) live in the vault only, and a shape's schema refuses them. */
export const shapeFieldsOf = (def: NodeDef): Pick<NodeDef, (typeof NODE_FIELDS)[number]> => ({
	name: def.name,
	kind: def.kind,
	icon: def.icon,
	sector: def.sector,
	ring: def.ring,
	requires: def.requires,
})
export const TREE_FIELDS = ['name', 'goal', 'sectors', 'rings', 'mounts'] as const
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

/** `mounts`, or the one `mount` a tree had before it could hang from several nodes. */
export function mountsOf(r: Record<string, unknown>): string[] {
	const raw = Array.isArray(r.mounts) ? r.mounts : str(r.mount) ? [r.mount] : []
	return [...new Set(raw.filter((m): m is string => typeof m === 'string' && !!m))]
}

function parseNode(raw: unknown): NodeDef | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	if (!str(r.nodeId)) return null
	return {
		nodeId: str(r.nodeId),
		name: str(r.name),
		kind: str(r.kind) || 'skill',
		icon: str(r.icon),
		sector: str(r.sector),
		ring: str(r.ring),
		requires: str(r.requires),
		...(str(r.draft) ? { draft: str(r.draft) } : {}),
		...(str(r.after) ? { after: str(r.after) } : {}),
		...(str(r.item) ? { item: str(r.item) } : {}),
	}
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
		mounts: mountsOf(r),
		nodes: (Array.isArray(r.nodes) ? r.nodes : []).map(parseNode).filter((n): n is NodeDef => !!n),
		removed: (Array.isArray(r.removed) ? r.removed : []).filter((id): id is string => typeof id === 'string'),
		draft: str(r.draft),
		ticked: Object.fromEntries(
			Object.entries(r.ticked && typeof r.ticked === 'object' ? (r.ticked as Record<string, unknown>) : {}).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1])
		),
		madeFrom: (Array.isArray(r.madeFrom) ? r.madeFrom : []).filter((id): id is string => typeof id === 'string' && !!id),
		deleted: r.deleted === true,
	}
}

/**
 * The starter trees the Mastery demo hung under its pillars, by tree id, with their node ids. The
 * demo is gone, but a vault that ran it still holds them, and they are nobody's trees.
 */
const DEMO_TREES: Readonly<Record<string, readonly string[]>> = {
	body: ['move', 'strength', 'mobility', 'endurance', 'recovery'],
	mind: ['focus', 'reading', 'memory', 'writing'],
	spirit: ['stillness', 'meditation', 'gratitude', 'reflection'],
	craft: ['play', 'film', 'theatre', 'prototype'],
	people: ['show-up', 'listen', 'host', 'mentor'],
}

/**
 * A demo tree that holds nothing but the demo's own nodes, deleted: every node tombstoned, so a board
 * still showing the demo drops its shapes rather than writing the tree back. A tree that only shares
 * the id, or that someone added a node to, is kept as it is.
 */
export function retireDemoTree(def: TreeDef): TreeDef {
	const demo = DEMO_TREES[def.treeId]?.map((id) => `${def.treeId}/${id}`)
	if (!demo || !def.nodes.length || !def.nodes.every((n) => demo.includes(n.nodeId))) return def
	return tombstone(def)
}

/**
 * Loads the vault's copy (localStorage or the server); drops what it can't read. Persisted back only
 * when it retired a demo tree, so the vault forgets them too.
 */
export function replaceTreeDefs(raw: unknown): void {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return
	const next: Record<string, TreeDef> = {}
	let retired = false
	for (const value of Object.values(raw as Record<string, unknown>)) {
		const parsed = parseTreeDef(value)
		if (!parsed) continue
		const def = retireDemoTree(parsed)
		retired ||= def !== parsed
		next[def.treeId] = def
	}
	trees.set(next)
	if (retired) persist?.(next)
}

const emptyTree = (treeId: string): TreeDef => ({
	treeId,
	name: '',
	goal: '',
	sectors: '',
	rings: '',
	mounts: [],
	nodes: [],
	removed: [],
	draft: '',
	ticked: {},
	madeFrom: [],
	deleted: false,
})

/** A node keeps its draft mark, path and item through an edit that doesn't name them: a shape's fields carry none. */
const keepDraft = (node: NodeDef, had: NodeDef | undefined): NodeDef => ({
	...node,
	...(node.draft === undefined && had?.draft ? { draft: had.draft } : {}),
	...(node.after === undefined && had?.after ? { after: had.after } : {}),
	...(node.item === undefined && had?.item ? { item: had.item } : {}),
})

/** Adds or updates one node; un-deletes it if it had been deleted (an undo, say). */
export function upsertNodeDef(treeId: string, node: NodeDef): void {
	if (!treeId || !node.nodeId) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	const at = tree.nodes.findIndex((n) => n.nodeId === node.nodeId)
	const nodes = at < 0 ? [...tree.nodes, node] : tree.nodes.map((n, i) => (i === at ? keepDraft(node, n) : n))
	commit({ ...trees.get(), [treeId]: { ...tree, nodes, removed: tree.removed.filter((id) => id !== node.nodeId), deleted: false } })
}

/** Adds or updates many nodes of one tree in a single change: one write, one redraw. */
export function upsertNodeDefs(treeId: string, nodes: readonly NodeDef[]): void {
	if (!treeId || !nodes.length) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	const byId = new Map(tree.nodes.map((n) => [n.nodeId, n]))
	for (const node of nodes) if (node.nodeId) byId.set(node.nodeId, keepDraft(node, byId.get(node.nodeId)))
	const ids = new Set(nodes.map((n) => n.nodeId))
	commit({ ...trees.get(), [treeId]: { ...tree, nodes: [...byId.values()], removed: tree.removed.filter((id) => !ids.has(id)), deleted: false } })
}

/** Whether a node is still a draft: its own mark, or its whole tree's. */
export function isDraftNode(treeId: string, nodeId: string): boolean {
	const tree = trees.get()[treeId]
	return !!tree && (!!tree.draft || !!tree.nodes.find((n) => n.nodeId === nodeId)?.draft)
}

/** Confirms what an import on this board added to the trees. Returns how many trees and nodes it touched. */
export function confirmTreeDrafts(boardId: string): number {
	let count = 0
	const next: Record<string, TreeDef> = {}
	for (const [id, tree] of Object.entries(trees.get())) {
		const nodes = tree.nodes.map((n) => {
			if (n.draft !== boardId) return n
			count++
			const { draft: _, ...rest } = n
			void _
			return rest
		})
		if (tree.draft === boardId) count++
		next[id] = { ...tree, nodes, draft: tree.draft === boardId ? '' : tree.draft }
	}
	commit(next)
	return count
}

/**
 * Takes back what an import on this board added: trees it made go entirely, nodes it added to other
 * trees go without a tombstone (they were never confirmed). Returns the node ids that went, so the
 * board can delete their shapes.
 */
export function discardTreeDrafts(boardId: string): string[] {
	const gone: string[] = []
	const next: Record<string, TreeDef> = {}
	for (const [id, tree] of Object.entries(trees.get())) {
		if (tree.draft === boardId) {
			gone.push(...tree.nodes.map((n) => n.nodeId))
			continue
		}
		const kept = tree.nodes.filter((n) => n.draft !== boardId)
		gone.push(...tree.nodes.filter((n) => n.draft === boardId).map((n) => n.nodeId))
		next[id] = kept.length === tree.nodes.length ? tree : { ...tree, nodes: kept }
	}
	commit(next)
	return gone
}

export const hasTreeDrafts = (boardId: string): boolean =>
	Object.values(trees.get()).some((t) => t.draft === boardId || t.nodes.some((n) => n.draft === boardId))

/** Deletes a node from its tree, leaving a tombstone. */
export function removeNodeDef(treeId: string, nodeId: string): void {
	const tree = trees.get()[treeId]
	if (!tree || !tree.nodes.some((n) => n.nodeId === nodeId)) return
	commit({
		...trees.get(),
		[treeId]: { ...tree, nodes: tree.nodes.filter((n) => n.nodeId !== nodeId), removed: [...new Set([...tree.removed, nodeId])] },
	})
}

/** Sets a tree's name, goal, sectors, rings, mount, draft mark or makers, making the tree if there is none. */
export function updateTreeMeta(treeId: string, meta: Partial<TreeMeta & Pick<TreeDef, 'draft' | 'madeFrom' | 'deleted'>>): void {
	if (!treeId) return
	const tree = trees.get()[treeId] ?? emptyTree(treeId)
	commit({ ...trees.get(), [treeId]: { ...tree, ...meta } })
}

/** Puts a tree's nodes in this order (ids it doesn't list keep their place at the end). */
export function orderNodeDefs(treeId: string, ids: readonly string[]): void {
	const tree = trees.get()[treeId]
	if (!tree) return
	const rank = new Map(ids.map((id, i) => [id, i]))
	const nodes = [...tree.nodes].sort((a, b) => (rank.get(a.nodeId) ?? ids.length) - (rank.get(b.nodeId) ?? ids.length))
	commit({ ...trees.get(), [treeId]: { ...tree, nodes } })
}

/** Ticks a node by hand (`at`, `YYYY-MM-DD`), or takes the tick back (''). */
export function setTicked(treeId: string, nodeId: string, at: string): void {
	const tree = trees.get()[treeId]
	if (!tree) return
	const ticked = { ...tree.ticked }
	if (at) ticked[nodeId] = at
	else delete ticked[nodeId]
	commit({ ...trees.get(), [treeId]: { ...tree, ticked } })
}

/** The trees that exist: every one but the deleted. */
export const liveTreeDefs = (all: TreeDefs = trees.get()): TreeDef[] => Object.values(all).filter((t) => !t.deleted)

/** A deleted tree: no nodes, mounts or ticks, every node it had tombstoned. */
const tombstone = (tree: TreeDef): TreeDef => ({
	...tree,
	nodes: [],
	removed: [...new Set([...tree.removed, ...tree.nodes.map((n) => n.nodeId)])],
	mounts: [],
	ticked: {},
	madeFrom: [],
	draft: '',
	deleted: true,
})

/**
 * Deletes trees from the vault, and with each the trees made together with it and hung only from it
 * (the branches of a shared root). Every board showing them drops their shapes (`reconcile`); trees
 * hung from their nodes otherwise stay, unhung. Returns the ids of the trees deleted.
 */
export function deleteTreeDefs(treeIds: readonly string[]): string[] {
	const all = { ...trees.get() }
	const going = new Set(treeIds.filter((id) => all[id] && !all[id]!.deleted))
	// The branches of a tree going: made from nothing it wasn't, hung from nothing but it.
	for (let grew = true; grew; ) {
		grew = false
		const goneNodes = new Set([...going].flatMap((id) => all[id]!.nodes.map((n) => n.nodeId)))
		const makers = new Set([...going].flatMap((id) => all[id]!.madeFrom))
		for (const tree of Object.values(all)) {
			if (going.has(tree.treeId) || tree.deleted || !tree.madeFrom.length || !tree.mounts.length) continue
			if (tree.mounts.every((m) => goneNodes.has(m)) && tree.madeFrom.every((m) => makers.has(m))) {
				going.add(tree.treeId)
				grew = true
			}
		}
	}
	if (!going.size) return []
	const goneNodes = new Set([...going].flatMap((id) => all[id]!.nodes.map((n) => n.nodeId)))
	for (const tree of Object.values(all)) {
		if (going.has(tree.treeId)) all[tree.treeId] = tombstone(tree)
		else if (tree.mounts.some((m) => goneNodes.has(m))) all[tree.treeId] = { ...tree, mounts: tree.mounts.filter((m) => !goneNodes.has(m)) }
	}
	commit(all)
	return [...going]
}

/**
 * Something trees were made from has gone (a syllabus deleted): it is taken off every tree made from
 * it, and a tree left made from nothing is deleted. Returns the ids of the trees deleted.
 */
export function forgetMaker(makerId: string): string[] {
	const all = trees.get()
	const made = liveTreeDefs(all).filter((t) => t.madeFrom.includes(makerId))
	if (!made.length) return []
	const left = made.filter((t) => t.madeFrom.length > 1)
	const next = { ...all }
	for (const tree of left) next[tree.treeId] = { ...tree, madeFrom: tree.madeFrom.filter((m) => m !== makerId) }
	commit(next)
	return deleteTreeDefs(made.filter((t) => t.madeFrom.length === 1).map((t) => t.treeId))
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
	// A deleted tree takes every shape of it off the board, even one it never heard of.
	if (def?.deleted) return { adopt, remove: [...board.keys()], update }
	for (const [nodeId, shape] of board) {
		const known = def?.nodes.find((n) => n.nodeId === nodeId)
		if (known) {
			if (NODE_FIELDS.some((f) => known[f] !== shape[f])) update.push(known)
		} else if (def?.removed.includes(nodeId)) remove.push(nodeId)
		else adopt.push(shape)
	}
	return { adopt, remove, update }
}
