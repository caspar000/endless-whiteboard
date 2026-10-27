import { forgetMaker, liveTreeDefs, MASTERY, slug, type DocNode, type DocTree, type TreeDef, type TreeMaker } from '@lifeboard/skill-tree'
import { getItems, getTracks, putItems, removeTrack, type ItemDef, type TrackDef } from './syllabus'
import { dropTrackFromPlans, plansOf } from './treePlans'

/**
 * Skill trees made from syllabi (docs/skill-tree-plan.md, "Trees are made, not imported"). Every
 * confirmed syllabus is something a tree can be made from (a `TreeMaker`):
 *
 * - **The tree its file came with**, kept unused since the import (treePlans.ts). Every track of that
 *   file feeds it, so it is made once and goes with the last of them.
 * - **A tree the vault already had under the file's id**, from before imports stopped making trees:
 *   made from it is taken over, not built again.
 * - Otherwise **a path of its entries**: a root named for the syllabus, then one node per entry, each
 *   growing from the one before (`after`, which asks nothing) and lit once its entry is done (`done:`),
 *   in any order. The node stands for its entry (`item`), so a view showing everything hangs the
 *   entry's works from it, and the entry is tagged to it, so its write-ups count toward it.
 */

export const makerId = (trackId: string) => `syllabus:${trackId}`

const prefixOf = (trackId: string) => (trackId.includes('/') ? trackId.split('/')[0]! : '')

/** Tabler icons for an entry's medium, so a path reads at a glance. */
const MEDIUM_ICONS: Readonly<Record<string, string>> = {
	book: 'book',
	work: 'file-text',
	play: 'masks-theater',
	film: 'movie',
	game: 'device-gamepad-2',
	album: 'vinyl',
	talk: 'microphone-2',
	exercise: 'barbell',
	artefact: 'tools',
	visit: 'map-pin',
}

const asDoc = (def: TreeDef): DocTree => ({
	treeId: def.treeId,
	name: def.name,
	goal: def.goal,
	layout: 'sectors',
	sectors: def.sectors.split(',').map((s) => s.trim()).filter(Boolean),
	rings: def.rings.split(',').map((s) => s.trim()).filter(Boolean),
	mounts: [...def.mounts],
	nodes: def.nodes.map(({ nodeId, name, kind, icon, sector, ring, requires, after, item }) => ({ nodeId, name, kind, icon, sector, ring, requires, after: after ?? '', item: item ?? '' })),
})

/** The id for a path made from a track: its own (`adler/canon` → `adler-canon`), unless another tree has it. */
function pathTreeId(track: TrackDef): string {
	const base = slug(track.trackId).replace(/\//g, '-') || 'syllabus'
	const taken = new Map(liveTreeDefs().map((t) => [t.treeId, t]))
	let id = base
	for (let n = 2; id === MASTERY || (taken.has(id) && !taken.get(id)!.madeFrom.includes(makerId(track.trackId))); n++) id = `${base}-${n}`
	return id
}

/** A track's entries as a path from a root named for it. */
export function pathTree(track: TrackDef, items: Readonly<Record<string, ItemDef>> = getItems()): DocTree {
	const treeId = pathTreeId(track)
	const root: DocNode = { nodeId: `${treeId}/root`, name: track.name || 'Syllabus', kind: 'root', icon: '', sector: '', ring: '', requires: '', after: '', item: '' }
	const taken = new Set([root.nodeId])
	const nodes: DocNode[] = [root]
	for (const itemId of track.order) {
		const entry = items[itemId]
		if (!entry || entry.draft) continue
		const base = `${treeId}/${slug(itemId.split('/').pop() ?? '') || 'entry'}`
		let nodeId = base
		for (let n = 2; taken.has(nodeId); n++) nodeId = `${base}-${n}`
		taken.add(nodeId)
		nodes.push({
			nodeId,
			name: entry.title || 'Untitled',
			kind: 'skill',
			icon: MEDIUM_ICONS[entry.medium.toLowerCase()] ?? '',
			sector: '',
			ring: '',
			requires: `- done: ${JSON.stringify(itemId)}`,
			after: nodes[nodes.length - 1]!.nodeId,
			item: itemId,
		})
	}
	return { treeId, name: track.name || 'Syllabus', goal: track.goal, layout: 'sectors', sectors: [], rings: [], mounts: [], nodes }
}

function makerFor(track: TrackDef): TreeMaker {
	return {
		id: makerId(track.trackId),
		name: track.name || 'Untitled syllabus',
		group: 'Syllabi',
		make() {
			const tracks = getTracks()
			const confirmed = (ids: readonly string[]) => ids.filter((id) => tracks[id] && !tracks[id]!.draft)
			const kept = plansOf(track.trackId)
			if (kept.length) return { trees: kept.map((p) => p.tree), from: confirmed([...new Set(kept.flatMap((p) => p.tracks))]).map(makerId) }
			// A tree an old import of this file left in the vault, under the file's id, nobody made.
			const prefix = prefixOf(track.trackId)
			const old = prefix && prefix !== MASTERY ? liveTreeDefs().find((t) => t.treeId === prefix && !t.madeFrom.length && t.nodes.length) : undefined
			if (old) return { trees: [asDoc(old)], from: confirmed(Object.keys(tracks).filter((id) => prefixOf(id) === prefix)).map(makerId) }
			return { trees: [pathTree(track)], from: [makerId(track.trackId)] }
		},
		made(trees) {
			// Each entry of a path tagged to its node: its works are drawn there, and its write-ups count toward it.
			const items = getItems()
			const tagged: ItemDef[] = []
			for (const node of trees.flatMap((t) => t.nodes)) {
				const entry = items[node.item]
				if (entry && !entry.tags.includes(node.nodeId)) tagged.push({ ...entry, tags: [...entry.tags, node.nodeId] })
			}
			if (tagged.length) putItems(tagged)
		},
	}
}

/** Every confirmed syllabus, as something to make a tree from. */
export const syllabusMakers = (): TreeMaker[] =>
	Object.values(getTracks())
		.filter((t) => !t.draft)
		.sort((a, b) => (a.name || a.trackId).localeCompare(b.name || b.trackId))
		.map(makerFor)

/**
 * The trees deleting a syllabus takes with it: those made from it alone, and the shared roots and
 * file trees whose last feeder it is. For the question before deleting.
 */
export function treesGoingWith(trackId: string): TreeDef[] {
	return liveTreeDefs().filter((t) => t.madeFrom.length === 1 && t.madeFrom[0] === makerId(trackId))
}

/** Deletes a syllabus (its entries only it lists, with their works), and the trees made from it alone. */
export function deleteSyllabus(trackId: string): void {
	removeTrack(trackId)
	dropTrackFromPlans(trackId)
	forgetMaker(makerId(trackId))
}
