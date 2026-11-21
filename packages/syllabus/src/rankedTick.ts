import type { TLShapeId } from '@lifeboard/canvas'
import { foldText, parseSourceKey, type ItemReaction, type SourceEntry } from '@lifeboard/node-kit'
import { tick } from './ops'
import { albumParts, syllabusRandomizerSource } from './randomizerSource'
import { getItems, type ItemDef } from './syllabus'

/**
 * Ranking something ticks it in the syllabus (DARK-13): put an album of /mu/core in a tier, and that
 * album is done.
 *
 * Ranked from a syllabus track, the entry is the work itself, by id. Ranked from anything else (a feed,
 * the stamped lists, a backlog), it is the work of the same title and creator, read the way the
 * randomizer reads a work (`syllabusEntries`): an album as album and artist, anything else under its
 * entry's name. A side with no creator matches on the title alone.
 *
 * A tick as the list makes one (`ops.ts`): the day recorded, and its write-up note filed beside the
 * ranking card it was ranked on, unless that board has one for it already.
 */

type Items = Readonly<Record<string, ItemDef>>

/** A work as the randomizer shows it, folded for comparing. */
function workFace(work: ItemDef, all: Items): { title: string; creator: string } {
	const album = work.medium === 'album' ? albumParts(work.title) : null
	return { title: foldText(album?.title ?? work.title), creator: foldText(album?.creator ?? all[work.parent]?.title ?? '') }
}

/** The works a ranked entry stands for: by id from a syllabus, else by title and creator. Leaves only, drafts left out. */
export function worksFor(entry: Pick<SourceEntry, 'id' | 'title' | 'creator'>, from: string, all: Items): string[] {
	const isWork = (item: ItemDef | undefined): item is ItemDef => !!item && !item.children.length && !item.draft
	if (parseSourceKey(from)?.sourceId === syllabusRandomizerSource.id) return isWork(all[entry.id]) ? [entry.id] : []
	const title = foldText(entry.title)
	const creator = foldText(entry.creator)
	if (!title) return []
	return Object.values(all)
		.filter(isWork)
		.filter((work) => {
			const face = workFace(work, all)
			return face.title === title && (!creator || !face.creator || face.creator === creator)
		})
		.map((work) => work.itemId)
}

/** A ranked item ticked in the syllabus, wherever it has a work. */
export const rankedTickReaction: ItemReaction = {
	id: 'lifeboard.syllabus.done-when-ranked',
	extensionId: 'lifeboard.syllabus',
	ranked: ({ entry, from, editor, shapeId }) => {
		const all = getItems()
		for (const itemId of worksFor(entry, from, all)) if (!all[itemId]!.done) tick(editor ?? null, itemId, true, shapeId as TLShapeId | undefined)
	},
}
