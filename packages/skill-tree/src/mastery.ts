import { MASTERY, MASTERY_NODE } from './board'
import { getTreeDef, getTreeDefs, orderNodeDefs, removeNodeDef, updateTreeMeta, upsertNodeDef, upsertNodeDefs, type NodeDef, type TreeDef, type TreeDefs } from './treeDefs'
import { slug } from './treeYaml'

/**
 * Mastery (docs/skill-tree-plan.md, "Mastery"): the one tree at the middle of everything. "You" at its
 * root, the pillars around you, and any other tree hung under one or more pillars. Built in
 * Settings › Skill trees; vault data, so every board showing it follows.
 */

export const DEFAULT_PILLARS: readonly { name: string; icon: string }[] = [
	{ name: 'Physical', icon: 'barbell' },
	{ name: 'Mental', icon: 'brain' },
	{ name: 'Spiritual', icon: 'leaf' },
	{ name: 'Practical', icon: 'hammer' },
	{ name: 'Social', icon: 'users' },
]

const PILLAR_REQUIRES = `- node: [${MASTERY_NODE}]`

const pillar = (nodeId: string, name: string, icon = ''): NodeDef => ({ nodeId, name, kind: 'pillar', icon, sector: '', ring: '', requires: PILLAR_REQUIRES })

/** Makes the Mastery tree if the vault has none: you and the five pillars. */
export function ensureMastery(): void {
	if (getTreeDef(MASTERY)?.nodes.some((n) => n.nodeId === MASTERY_NODE)) return
	upsertNodeDefs(MASTERY, [
		{ nodeId: MASTERY_NODE, name: 'You', kind: MASTERY, icon: 'user', sector: '', ring: '', requires: '' },
		...DEFAULT_PILLARS.map((p) => pillar(`${MASTERY}/${slug(p.name)}`, p.name, p.icon)),
	])
	updateTreeMeta(MASTERY, { name: 'You' })
}

/** The pillars, in their order around you. */
export function pillarsOf(trees: TreeDefs = getTreeDefs()): NodeDef[] {
	return trees[MASTERY]?.nodes.filter((n) => n.kind === 'pillar') ?? []
}

/** Every tree but Mastery, by name: what can hang under a pillar. */
export function hangableTrees(trees: TreeDefs = getTreeDefs()): TreeDef[] {
	return Object.values(trees)
		.filter((t) => t.treeId !== MASTERY && !t.draft)
		.sort((a, b) => (a.name || a.treeId).localeCompare(b.name || b.treeId))
}

/** The trees hung under a pillar. */
export const treesUnder = (pillarId: string, trees: TreeDefs = getTreeDefs()): TreeDef[] => hangableTrees(trees).filter((t) => t.mounts.includes(pillarId))

/** Adds a pillar after the others, and returns its id. */
export function addPillar(name: string): string {
	ensureMastery()
	const taken = new Set(getTreeDef(MASTERY)!.nodes.map((n) => n.nodeId))
	const base = `${MASTERY}/${slug(name) || 'pillar'}`
	let nodeId = base
	for (let n = 2; taken.has(nodeId); n++) nodeId = `${base}-${n}`
	upsertNodeDef(MASTERY, pillar(nodeId, name.trim() || 'Pillar'))
	return nodeId
}

export function renamePillar(nodeId: string, name: string): void {
	const node = getTreeDef(MASTERY)?.nodes.find((n) => n.nodeId === nodeId)
	if (node) upsertNodeDef(MASTERY, { ...node, name })
}

/** Takes a pillar away. The trees under it stay in the vault, hung under their other pillars, if any. */
export function removePillar(nodeId: string): void {
	for (const tree of treesUnder(nodeId)) updateTreeMeta(tree.treeId, { mounts: tree.mounts.filter((m) => m !== nodeId) })
	removeNodeDef(MASTERY, nodeId)
}

/** Moves a pillar one place earlier (-1) or later (1) around you. */
export function movePillar(nodeId: string, delta: -1 | 1): void {
	const ids = pillarsOf().map((n) => n.nodeId)
	const at = ids.indexOf(nodeId)
	const to = at + delta
	if (at < 0 || to < 0 || to >= ids.length) return
	;[ids[at], ids[to]] = [ids[to]!, ids[at]!]
	orderNodeDefs(MASTERY, [MASTERY_NODE, ...ids])
}

/** Hangs a tree under a pillar, or takes it down from that one pillar. */
export function hangTree(treeId: string, pillarId: string, hung: boolean): void {
	const tree = getTreeDef(treeId)
	if (!tree || treeId === MASTERY) return
	const mounts = tree.mounts.filter((m) => m !== pillarId)
	updateTreeMeta(treeId, { mounts: hung ? [...mounts, pillarId] : mounts })
}
