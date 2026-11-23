import type { ItemSource, SourceChoice, SourceEntry, SourceKind } from '@lifeboard/node-kit'
import { getTreeDefs, liveTreeDefs, parentsOf, reachFrom, treeGraph, type TreeDefs, type TreeGraph } from '@lifeboard/skill-tree'
import { GraduationCap } from 'lucide-react'
import { isTrack, TRACK_TYPE } from './board'
import { getItems, getTracks, type ItemDef, type TrackDef } from './syllabus'

/**
 * Syllabi as something a randomizer can shuffle (DARK-8): every work of a track, such as /mu/core's
 * 1111 albums. The randomizer knows nothing of syllabi; this is the whole of the connection, as
 * Feeds' `randomizerSource.ts` is for feeds.
 *
 * A choice is a track's id, or a skill node's (`node:mucore/rock-metal`). What is shuffled is its
 * works, the leaves under its entries in reading order, ticked or not: the card's stamps are what
 * take one out of the shuffle, and a syllabus tick is about having written it up, not about whether to
 * hear it again. A node's works are those of every entry tagged to it or to any node below it, so
 * Metal shuffles every metal genre's albums and Black Metal only its own.
 */

type Items = Readonly<Record<string, ItemDef>>
type Tracks = Readonly<Record<string, TrackDef>>

/** Every confirmed track, under the name of the syllabus it belongs to, by syllabus and then by name. */
export function syllabusChoices(tracks: Tracks): SourceChoice[] {
	return Object.values(tracks)
		.filter((t) => !t.draft)
		.sort((a, b) => a.goal.localeCompare(b.goal) || a.name.localeCompare(b.name))
		.map((t) => ({ id: t.trackId, label: t.name || t.trackId, group: t.goal }))
}

/** A track's works with the entry each sits under, in reading order, each once. Empty for a track that is gone. */
export function worksOf(items: Items, tracks: Tracks, trackId: string): Array<{ work: ItemDef; entry: ItemDef | null }> {
	const track = tracks[trackId]
	if (!track || track.draft) return []
	return leavesOf(items, track.order.map((id) => items[id]).filter((i): i is ItemDef => !!i))
}

/** The works under some entries, each with the entry it sits under, in order, each once. */
function leavesOf(items: Items, entries: readonly ItemDef[]): Array<{ work: ItemDef; entry: ItemDef | null }> {
	const out: Array<{ work: ItemDef; entry: ItemDef | null }> = []
	const seen = new Set<string>()
	const walk = (item: ItemDef, parent: ItemDef | null, depth: number) => {
		if (seen.has(item.itemId) || item.draft) return
		seen.add(item.itemId)
		const children = item.children.map((id) => items[id]).filter((c): c is ItemDef => !!c && !c.draft)
		if (!children.length || depth >= 16) out.push({ work: item, entry: parent })
		else for (const child of children) walk(child, item, depth + 1)
	}
	for (const entry of entries) walk(entry, null, 0)
	return out
}

const NODE = 'node:'

/** The confirmed trees still in the vault, as one graph. */
function liveGraph(trees: TreeDefs): { graph: TreeGraph; live: ReturnType<typeof liveTreeDefs> } {
	const live = liveTreeDefs(trees).filter((t) => !t.draft)
	return { graph: treeGraph(Object.fromEntries(live.map((t) => [t.treeId, t]))), live }
}

/** The confirmed entries tagged to any of these nodes, in the vault's order. */
function entriesTagged(items: Items, nodes: ReadonlySet<string>): ItemDef[] {
	return Object.values(items).filter((item) => !item.draft && item.tags.some((t) => nodes.has(t)))
}

/** A node's works: those of every entry tagged to it or to a node below it. Empty for a node that is gone. */
export function nodeWorks(items: Items, trees: TreeDefs, nodeId: string): Array<{ work: ItemDef; entry: ItemDef | null }> {
	const { graph } = liveGraph(trees)
	return leavesOf(items, entriesTagged(items, reachFrom(graph, nodeId)))
}

/** "Rock › Metal › Black Metal": a node's name after those of the nodes it grows from, its tree's root left out. */
function pathLabel(graph: TreeGraph, nodeId: string): string {
	const names: string[] = []
	const seen = new Set<string>()
	for (let id: string | undefined = nodeId; id && !seen.has(id); ) {
		seen.add(id)
		const node = graph.nodes.get(id)
		if (!node) break
		const parent = parentsOf(node.def).find((p) => graph.nodes.get(p)?.treeId === node.treeId)
		if (parent || id === nodeId) names.unshift(node.def.name || id)
		id = parent
	}
	return names.join(' › ')
}

/**
 * Every node of a confirmed tree that has works below it, as a choice: labelled by its path, listed
 * under its tree, the root first and then in the order of the paths, so a family sits above its genres.
 */
export function nodeChoices(items: Items, trees: TreeDefs): SourceChoice[] {
	const { graph, live } = liveGraph(trees)
	const tagged = new Set(Object.values(items).filter((i) => !i.draft).flatMap((i) => i.tags))
	const out: SourceChoice[] = []
	for (const tree of live) {
		const root = graph.rootOf.get(tree.treeId)
		const group = `${tree.name || tree.treeId} (skill tree)`
		const choices = tree.nodes
			.filter((n) => [...reachFrom(graph, n.nodeId)].some((id) => tagged.has(id)))
			.map((n) => ({ id: `${NODE}${n.nodeId}`, label: pathLabel(graph, n.nodeId), group, root: n.nodeId === root }))
		choices.sort((a, b) => Number(b.root) - Number(a.root) || a.label.localeCompare(b.label))
		out.push(...choices.map(({ id, label, group }) => ({ id, label, group })))
	}
	return out
}

/** One node's choice, or null when the node is gone: what a card pointed at it shows. */
export function nodeChoice(trees: TreeDefs, choiceId: string): SourceChoice | null {
	const { graph } = liveGraph(trees)
	const node = graph.nodes.get(choiceId.slice(NODE.length))
	if (!node) return null
	const tree = trees[node.treeId]
	return { id: choiceId, label: pathLabel(graph, node.def.nodeId), group: `${tree?.name || node.treeId} (skill tree)` }
}

/**
 * An album's title as /mu/core writes it, `Genre: Artist - Album (Year)`, taken apart for the card's
 * tiles. The year is whatever the brackets hold when it has a digit ("1972", "1950 BC - 400 AD").
 * `null` when there is no artist to be found. syllabi/mucore_covers.py reads titles the same way.
 */
export function albumParts(title: string): { title: string; creator: string; year: string } | null {
	const colon = title.indexOf(': ')
	let rest = colon >= 0 ? title.slice(colon + 2) : title
	let year = ''
	const bracket = /\s*\(([^()]*\d[^()]*)\)\s*$/.exec(rest)
	if (bracket) {
		year = bracket[1]!.trim()
		rest = rest.slice(0, bracket.index)
	}
	// "Artist - Album", and the near misses the list has ("Rameau- Hippolyte", "kaDinuzulu -The Zulu Songs").
	const dash = /\s+-\s*|\s*-\s+/.exec(rest)
	if (!dash) return null
	const creator = rest.slice(0, dash.index).trim()
	const album = rest.slice(dash.index + dash[0].length).trim()
	return creator && album ? { title: album, creator, year } : null
}

/** A track's works as a randomizer's entries: an album as album, artist and year; anything else under its entry's name. */
export function syllabusEntries(items: Items, tracks: Tracks, trackId: string): SourceEntry[] {
	return asEntries(worksOf(items, tracks, trackId))
}

/** A skill node's works as a randomizer's entries, as a track's are. */
export function nodeEntries(items: Items, trees: TreeDefs, choiceId: string): SourceEntry[] {
	return asEntries(nodeWorks(items, trees, choiceId.slice(NODE.length)))
}

function asEntries(works: Array<{ work: ItemDef; entry: ItemDef | null }>): SourceEntry[] {
	return works.map(({ work, entry }) => {
		const album = work.medium === 'album' ? albumParts(work.title) : null
		return {
			id: work.itemId,
			title: album?.title ?? work.title,
			creator: album?.creator ?? entry?.title ?? '',
			year: album?.year ?? '',
			cover: work.cover,
			url: work.url,
			...(work.tracks ? { detail: `${work.tracks} ${work.tracks === 1 ? 'track' : 'tracks'}` } : {}),
		}
	})
}

const ALBUMS: SourceKind = { noun: 'albums', one: 'album', creator: 'Artist', tag: '', shape: 'square' }
const WORKS: SourceKind = { noun: 'works', one: 'work', creator: 'From', tag: '', shape: 'square' }

/** Albums when every work of the track (or skill node) is one, works otherwise. */
export function syllabusKind(items: Items, tracks: Tracks, choiceId: string, trees: TreeDefs = {}): SourceKind {
	const works = choiceId.startsWith(NODE) ? nodeWorks(items, trees, choiceId.slice(NODE.length)) : worksOf(items, tracks, choiceId)
	return works.length > 0 && works.every(({ work }) => work.medium === 'album') ? ALBUMS : WORKS
}

export const syllabusRandomizerSource: ItemSource = {
	id: 'syllabus',
	label: 'Syllabi',
	icon: GraduationCap,
	extensionId: 'lifeboard.syllabus',
	choices: () => [...syllabusChoices(getTracks()), ...nodeChoices(getItems(), getTreeDefs())],
	choice: (id) =>
		id.startsWith(NODE) ? nodeChoice(getTreeDefs(), id) : (syllabusChoices(getTracks()).find((c) => c.id === id) ?? null),
	entries: (id) => (id.startsWith(NODE) ? nodeEntries(getItems(), getTreeDefs(), id) : syllabusEntries(getItems(), getTracks(), id)),
	kind: (id) => syllabusKind(getItems(), getTracks(), id, getTreeDefs()),
	// A track's card on the board is that track: dropped on a backlog, the backlog takes the track (DARK-11).
	fromShape: {
		types: [TRACK_TYPE],
		choiceOf: (shape) => {
			if (!isTrack(shape)) return null
			const track = getTracks()[shape.props.trackId]
			return track && !track.draft ? track.trackId : null
		},
	},
}
