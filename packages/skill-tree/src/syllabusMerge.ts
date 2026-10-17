import type { ItemDef, TrackDef } from './syllabus'
import type { DocItem, SyllabusDoc } from './syllabusYaml'

/**
 * How a syllabus document lands in the vault (docs/skill-tree-plan.md, "The YAML format"). Pure.
 *
 * A new item or track arrives as a draft of the importing board. One the vault already has is
 * updated in place: titles, tags, kind, medium and rules from the document, never its tick. Works
 * the document lists come first, in its order, then any the item already had; a track likewise.
 */
export interface Merged {
	items: ItemDef[]
	tracks: TrackDef[]
	created: number
	updated: number
}

export function mergeDoc(
	doc: SyllabusDoc,
	items: Readonly<Record<string, ItemDef>>,
	tracks: Readonly<Record<string, TrackDef>>,
	boardId: string
): Merged {
	const out = new Map<string, ItemDef>()
	let created = 0
	let updated = 0
	const put = (item: DocItem, parent: string, inherited: readonly string[]) => {
		const had = items[item.itemId]
		const tags = [...new Set([...item.tags, ...inherited])]
		const children = [...item.children.map((c) => c.itemId), ...(had?.children ?? []).filter((id) => !item.children.some((c) => c.itemId === id))]
		out.set(item.itemId, {
			itemId: item.itemId,
			title: item.title,
			kind: item.kind || had?.kind || '',
			medium: item.medium || had?.medium || '',
			tags,
			core: item.core,
			childRule: item.childRule,
			parent,
			children,
			done: had?.done ?? false,
			doneAt: had?.doneAt ?? '',
			draft: had ? had.draft : boardId,
		})
		if (had) updated++
		else created++
		for (const child of item.children) put(child, item.itemId, [])
	}
	const outTracks: TrackDef[] = []
	for (const track of doc.tracks) {
		for (const item of track.items) put(item, '', track.defaultTags)
		const had = tracks[track.trackId]
		outTracks.push({
			trackId: track.trackId,
			name: track.name,
			goal: doc.name,
			state: had?.state ?? track.state,
			order: [...track.order, ...(had?.order ?? []).filter((id) => !track.order.includes(id))],
			defaultTags: track.defaultTags,
			draft: had ? had.draft : boardId,
		})
		if (had) updated++
		else created++
	}
	return { items: [...out.values()], tracks: outTracks, created, updated }
}
