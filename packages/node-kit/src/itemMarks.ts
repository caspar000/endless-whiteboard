import { atom } from '@lifeboard/canvas'
import { isExtensionEnabled } from './registry'
import type { SourceEntry } from './itemSources'

/**
 * What one extension says about an item another one lists (DARK-13): that it was ranked, and how it
 * was stamped. Kept in the kit for the reason the sources are (`itemSources.ts`): a ranking can't know
 * a randomizer or a syllabus is there, and either can be off.
 *
 * - **Reactions.** A ranking says an item went from Unranked into a tier; the randomizer stamps it
 *   Liked, the syllabus ticks the same work. Every enabled reaction runs; none can stop another.
 * - **Stamps.** Whoever stamps items (the randomizer) says what an item's latest stamp is, so a ranking
 *   can draw it on the cover and hide the kinds you'd rather not see.
 */

/** An item put in a tier, from a ranking's Unranked. */
export interface RankedItem {
	entry: SourceEntry
	/** The source key it was ranked from: `syllabus:mucore`, `feeds:all`. */
	from: string
	/** The ranking it was ranked in. */
	rankingId: string
}

export interface ItemReaction {
	/** Namespaced and stable. Registering it again replaces it. */
	id: string
	/** The extension it comes with: while that is off, it doesn't run. */
	extensionId?: string
	ranked?(item: RankedItem): void
}

const reactions = new Map<string, ItemReaction>()

export function registerItemReaction(reaction: ItemReaction): void {
	reactions.set(reaction.id, reaction)
}

/** Tells every enabled extension an item was ranked. One that throws is logged, and the rest run. */
export function itemRanked(item: RankedItem): void {
	for (const reaction of reactions.values()) {
		if (!reaction.ranked || (reaction.extensionId && !isExtensionEnabled(reaction.extensionId))) continue
		try {
			reaction.ranked(item)
		} catch (error) {
			console.error(`[item reaction ${reaction.id}]`, error)
		}
	}
}

/* ------------------------------------------------------------------------------------- stamps */

/** One kind of stamp: Liked, Unsure, Disliked. */
export interface StampKindInfo {
	id: string
	label: string
	/** Its ink, for a badge. */
	ink: string
}

/** An item's latest stamp. */
export interface ItemStamp {
	kind: string
	date: string
}

export interface ItemStamps {
	/** The extension that stamps: while it is off, nothing is stamped. */
	extensionId?: string
	/**
	 * The source it lists its stamps as (`stamped`), one choice per kind. A ranking of it can take
	 * several kinds at once.
	 */
	sourceId: string
	kinds: readonly StampKindInfo[]
	/** An item's latest stamp, by its title and creator, wherever it was stamped. Read reactively. */
	stampOf(entry: Pick<SourceEntry, 'title' | 'creator'>): ItemStamp | null
}

const stamps = atom<ItemStamps | null>('lifeboard:item-stamps', null)

/** Who stamps items. One extension does; registering again replaces it. */
export function registerItemStamps(provider: ItemStamps): void {
	stamps.set(provider)
}

/** Who stamps items, while it is on, or `null`. Read reactively. */
export function getItemStamps(): ItemStamps | null {
	const provider = stamps.get()
	return provider && (!provider.extensionId || isExtensionEnabled(provider.extensionId)) ? provider : null
}

/** For tests. */
export function clearItemMarks(): void {
	reactions.clear()
	stamps.set(null)
}

/** How a title or a creator is compared across sources: case, spacing and punctuation aside. */
export function sameText(a: string, b: string): boolean {
	return foldText(a) === foldText(b)
}

export function foldText(text: string): string {
	return text
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()
}

/** Whether an item matches what was typed into a search: every word, in its title or its creator. */
export function matchesSearch(entry: Pick<SourceEntry, 'title' | 'creator'>, query: string): boolean {
	const words = foldText(query).split(' ').filter(Boolean)
	if (!words.length) return true
	const text = `${foldText(entry.title)} ${foldText(entry.creator)}`
	return words.every((w) => text.includes(w))
}

/* ------------------------------------------------------------------------------- cover shapes */

/** A window or cover shape a card can be set to: `''` is the card's own (square, or the source's). */
export const COVER_ASPECTS: ReadonlyArray<{ id: string; label: string }> = [
	{ id: '', label: 'Auto' },
	{ id: '1:1', label: 'Square, 1:1' },
	{ id: '4:3', label: '4:3' },
	{ id: '3:2', label: '3:2' },
	{ id: '16:9', label: 'Wide, 16:9' },
	{ id: '3:4', label: '3:4' },
	{ id: '2:3', label: 'Poster, 2:3' },
]

/** Width over height for an aspect id, or `null` for Auto or anything unknown. */
export function aspectRatio(id: string): number | null {
	if (!COVER_ASPECTS.some((a) => a.id === id) || !id) return null
	const [w, h] = id.split(':').map(Number)
	return w && h ? w / h : null
}
