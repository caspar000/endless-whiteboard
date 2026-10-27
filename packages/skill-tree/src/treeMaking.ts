import { MASTERY } from './board'
import { allMakers, type TreeMaker } from './sources'
import { deleteTreeDefs, getTreeDef, getTreeDefs, liveTreeDefs, updateTreeMeta, upsertNodeDefs, type TreeDef } from './treeDefs'
import { slug, type DocTree } from './treeYaml'

/**
 * Making and deleting trees (docs/skill-tree-plan.md, "Trees are made, not imported"). A tree comes
 * into the vault only when someone asks: from what a source offers (a syllabus), or empty. Made, it
 * is on no board and under no pillar; Settings › Skill trees hangs it, ⌘K › Show a skill tree on this
 * board shows it.
 */

/** What "An empty tree" is called where makers are listed. */
export const EMPTY_TREE = 'An empty tree'

export interface MadeTrees {
	/** The trees made, the shared root first when there is one. */
	made: string[]
	/** Trees that were already made from what was asked for, left as they are. */
	already: string[]
}

/** A tree id no tree in the vault has (a deleted tree's may be taken again), never Mastery's. */
function freeTreeId(name: string): string {
	const all = getTreeDefs()
	const base = slug(name).replace(/\//g, '-') || 'tree'
	let id = base
	for (let n = 2; id === MASTERY || (all[id] && !all[id]!.deleted); n++) id = `${base}-${n}`
	return id
}

const live = (treeId: string): TreeDef | undefined => {
	const def = getTreeDef(treeId)
	return def && !def.deleted ? def : undefined
}

/** One tree written to the vault: its nodes, then its name, mounts and makers. */
function writeTree(doc: DocTree, from: readonly string[], mounts: readonly string[]): void {
	const had = live(doc.treeId)
	upsertNodeDefs(
		doc.treeId,
		doc.nodes.map(({ nodeId, name, kind, icon, sector, ring, requires, after, item }) => ({
			nodeId,
			name,
			kind,
			icon,
			sector,
			ring,
			requires,
			...(after ? { after } : {}),
			...(item ? { item } : {}),
		}))
	)
	updateTreeMeta(doc.treeId, {
		name: doc.name,
		goal: doc.goal,
		sectors: doc.sectors.join(', '),
		rings: doc.rings.join(', '),
		mounts,
		madeFrom: [...new Set([...(had?.madeFrom ?? []), ...from])],
		draft: '',
		deleted: false,
	})
}

/** A tree of one root node, named: an empty tree to grow by hand, or the shared root of several. */
function rootTree(name: string, from: readonly string[]): { treeId: string; rootId: string } {
	const treeId = freeTreeId(name)
	const rootId = `${treeId}/root`
	writeTree(
		{ treeId, name: name.trim(), goal: '', layout: 'sectors', sectors: [], rings: [], mounts: [], nodes: [{ nodeId: rootId, name: name.trim(), kind: 'root', icon: '', sector: '', ring: '', requires: '', after: '', item: '' }] },
		from,
		[]
	)
	return { treeId, rootId }
}

/**
 * Makes trees from the makers named (by id). None: an empty tree called `name`. Several, with
 * `sharedRoot`: a root called `name` with each of their trees hung from it, so the whole goes as one;
 * it is made from all of them and goes with the last. What was already made is left as it is (but
 * still hung from a new shared root).
 *
 * A tree the vault already has under the same id, from before trees were made (an old import), is
 * taken over rather than duplicated: its nodes are brought up to date and where it hangs is kept.
 */
export function makeTrees(makerIds: readonly string[], options: { name?: string; sharedRoot?: boolean } = {}): MadeTrees {
	const name = options.name?.trim() ?? ''
	if (!makerIds.length) {
		if (!name) throw new Error('Name the empty tree.')
		return { made: [rootTree(name, []).treeId], already: [] }
	}
	const byId = new Map(allMakers().map((m) => [m.id, m]))
	const missing = makerIds.filter((id) => !byId.has(id))
	if (missing.length) throw new Error(`Nothing to make a tree from called ${missing.map((m) => `"${m}"`).join(', ')}.`)

	// Two syllabi feeding one tree (Film's tracks) make it once.
	const plans = new Map<string, { maker: TreeMaker; trees: DocTree[]; from: readonly string[] }>()
	for (const id of new Set(makerIds)) {
		const maker = byId.get(id)!
		const plan = maker.make()
		if (!plan?.trees.length) continue
		const main = plan.trees[0]!.treeId
		if (!plans.has(main)) plans.set(main, { maker, ...plan })
	}
	if (!plans.size) throw new Error('There was nothing in that to make a tree of.')
	const shared = options.sharedRoot && plans.size > 1
	if (shared && !name) throw new Error('Name the shared root.')

	const made: string[] = []
	const already: string[] = []
	const mains: string[] = []
	for (const [main, plan] of plans) {
		mains.push(main)
		const had = live(main)
		if (had && plan.from.some((f) => had.madeFrom.includes(f))) {
			already.push(main)
			continue
		}
		// Hung only from each other: where else a tree hangs is decided after it is made, not by its file.
		const inPlan = new Set(plan.trees.flatMap((t) => t.nodes.map((n) => n.nodeId)))
		for (const tree of plan.trees) {
			const kept = live(tree.treeId)?.mounts ?? tree.mounts.filter((m) => inPlan.has(m))
			writeTree(tree, plan.from, kept)
			made.push(tree.treeId)
		}
		plan.maker.made?.(plan.trees)
	}
	if (shared) {
		const from = [...new Set([...plans.values()].flatMap((p) => p.from))]
		const root = rootTree(name, from)
		for (const treeId of mains) updateTreeMeta(treeId, { mounts: [root.rootId] })
		made.unshift(root.treeId)
	}
	return { made, already }
}

/** Deletes a tree from the vault and every board, with the branches made together with it. */
export const deleteTree = (treeId: string): string[] => deleteTreeDefs([treeId])

/** The trees there are, with the name to show for each: its id after it when two share a name. */
export function treeLabels(): { tree: TreeDef; label: string }[] {
	const trees = liveTreeDefs().sort((a, b) => (a.name || a.treeId).localeCompare(b.name || b.treeId))
	const count = new Map<string, number>()
	for (const t of trees) count.set(t.name || t.treeId, (count.get(t.name || t.treeId) ?? 0) + 1)
	return trees.map((tree) => {
		const name = tree.name || tree.treeId
		return { tree, label: (count.get(name) ?? 0) > 1 ? `${name} (${tree.treeId})` : name }
	})
}

/** A tree by the label `treeLabels` gives it, its name, or its id. */
export function findTree(nameOrId: string): TreeDef | undefined {
	const want = nameOrId.trim()
	return live(want) ?? treeLabels().find((t) => t.label === want || t.tree.name === want)?.tree
}

/** What a tree can be made from, with the name to show for each: its id after it when two share a name. */
export function makerLabels(): { maker: TreeMaker; label: string }[] {
	const makers = allMakers()
	const count = new Map<string, number>()
	for (const m of makers) count.set(m.name, (count.get(m.name) ?? 0) + 1)
	return makers.map((maker) => ({ maker, label: (count.get(maker.name) ?? 0) > 1 ? `${maker.name} (${maker.id})` : maker.name }))
}

/** A maker by the label `makerLabels` gives it, its name, or its id. */
export function findMaker(nameOrId: string): TreeMaker | undefined {
	const want = nameOrId.trim()
	return makerLabels().find((m) => m.maker.id === want || m.label === want || m.maker.name === want)?.maker
}
