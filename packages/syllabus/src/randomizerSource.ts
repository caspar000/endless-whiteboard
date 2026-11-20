import type { RandomizerSource, SourceChoice, SourceEntry, SourceKind } from '@lifeboard/randomizer'
import { GraduationCap } from 'lucide-react'
import { getItems, getTracks, type ItemDef, type TrackDef } from './syllabus'

/**
 * Syllabi as something a randomizer can shuffle (DARK-8): every work of a track, such as /mu/core's
 * 1111 albums. The randomizer knows nothing of syllabi; this is the whole of the connection, as
 * Feeds' `randomizerSource.ts` is for feeds.
 *
 * A choice is a track's id. What is shuffled is its works, the leaves under its entries in reading
 * order, ticked or not: the card's stamps are what take one out of the shuffle, and a syllabus tick is
 * about having written it up, not about whether to hear it again.
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
	const out: Array<{ work: ItemDef; entry: ItemDef | null }> = []
	const seen = new Set<string>()
	const walk = (item: ItemDef, parent: ItemDef | null, depth: number) => {
		if (seen.has(item.itemId) || item.draft) return
		seen.add(item.itemId)
		const children = item.children.map((id) => items[id]).filter((c): c is ItemDef => !!c && !c.draft)
		if (!children.length || depth >= 16) out.push({ work: item, entry: parent })
		else for (const child of children) walk(child, item, depth + 1)
	}
	for (const id of track.order) {
		const item = items[id]
		if (item) walk(item, null, 0)
	}
	return out
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
	return worksOf(items, tracks, trackId).map(({ work, entry }) => {
		const album = work.medium === 'album' ? albumParts(work.title) : null
		return {
			id: work.itemId,
			title: album?.title ?? work.title,
			creator: album?.creator ?? entry?.title ?? '',
			year: album?.year ?? '',
			cover: work.cover,
			url: '',
		}
	})
}

const ALBUMS: SourceKind = { noun: 'albums', one: 'album', creator: 'Artist', tag: '', shape: 'square' }
const WORKS: SourceKind = { noun: 'works', one: 'work', creator: 'From', tag: '', shape: 'square' }

/** Albums when every work of the track is one, works otherwise. */
export function syllabusKind(items: Items, tracks: Tracks, trackId: string): SourceKind {
	const works = worksOf(items, tracks, trackId)
	return works.length > 0 && works.every(({ work }) => work.medium === 'album') ? ALBUMS : WORKS
}

export const syllabusRandomizerSource: RandomizerSource = {
	id: 'syllabus',
	label: 'Syllabi',
	icon: GraduationCap,
	extensionId: 'lifeboard.syllabus',
	choices: () => syllabusChoices(getTracks()),
	entries: (trackId) => syllabusEntries(getItems(), getTracks(), trackId),
	kind: (trackId) => syllabusKind(getItems(), getTracks(), trackId),
}
