import { atom } from '@lifeboard/canvas'
import type { LucideIcon } from 'lucide-react'
import { TYPED_KIND, TYPED_SOURCE, parseSourceKey, type SourceEntry, type SourceKind } from './model'

/**
 * What other extensions give a randomizer to shuffle (DARK-7). The card itself is only the front: a
 * split-flap window waiting for something to pick from. It holds a typed list of its own; anything
 * else comes from a source registered here, as Feeds registers its videos and posts. The randomizer
 * never imports a source, the same split as skill trees' sources (`@lifeboard/skill-tree`'s
 * `sources.ts`), which the syllabus feeds without the tree knowing it.
 *
 * Reads go through atoms, so a card reading a source inside `useValue` also follows the source's own
 * atoms: a feed that reads new videos changes the card under it.
 */

/** One thing a source can be pointed at: all feeds, a category, a channel. */
export interface SourceChoice {
	/** Unique within the source, and lasting: the card stores it. */
	id: string
	label: string
	/** The heading it is listed under in the picker: "Categories", "Channels". */
	group: string
}

export interface RandomizerSource {
	/** The first half of every source key it makes: `feeds`. Must not contain a `:`. */
	id: string
	/** Its name in the picker and on the card: "Feeds". */
	label: string
	icon?: LucideIcon
	/** The extension that offers it. While that is turned off it isn't offered, though a card already on it keeps working, as its nodes do. */
	extensionId?: string
	/** What it can be pointed at now. */
	choices(): readonly SourceChoice[]
	/** What a choice holds now, in its own order. Empty for a choice that is gone. */
	entries(choiceId: string): readonly SourceEntry[]
	/** How a choice's items are spoken of: "videos" for YouTube channels. */
	kind(choiceId: string): SourceKind
	/**
	 * Called while a card shows this source, so it can keep itself fresh (a feed reads its channels
	 * every quarter of an hour). Returns the card's release.
	 */
	watch?(choiceId: string): () => void
	/** Opens an entry, as the source's own card would (a video, marked watched). Without it, its `url` opens in a new tab. */
	open?(entry: { id: string; url: string }): void
}

const sources = atom<readonly RandomizerSource[]>('lifeboard:randomizer-sources', [])

/** Adds a source, or replaces the one with its id (a module loaded again in development). */
export function registerRandomizerSource(source: RandomizerSource): void {
	if (source.id.includes(':') || source.id === TYPED_SOURCE) throw new Error(`registerRandomizerSource: "${source.id}" can't be a source id`)
	sources.set([...sources.get().filter((s) => s.id !== source.id), source])
}

export function getRandomizerSources(): readonly RandomizerSource[] {
	return sources.get()
}

/** For tests. */
export function clearRandomizerSources(): void {
	sources.set([])
}

/** What a source key points at, as the card shows it. */
export interface ResolvedSource {
	/** `typed` for the card's own list, `none` for no source yet, `missing` for one that is gone. */
	type: 'typed' | 'none' | 'source' | 'missing'
	/** The heading over the window, as specific as it can be: "Electronics", "Feeds". */
	name: string
	kind: SourceKind
	source: RandomizerSource | null
	choiceId: string
}

/**
 * A source key as the card shows it.
 *
 * A key whose source is gone (its extension turned off, a category deleted) is `missing`: the card
 * says so and keeps the key, so turning the extension back on, or undoing the delete, picks up where
 * it was.
 */
export function resolveSource(key: string): ResolvedSource {
	if (key === TYPED_SOURCE) return { type: 'typed', name: 'My list', kind: TYPED_KIND, source: null, choiceId: '' }
	const parsed = parseSourceKey(key)
	if (!parsed) return { type: 'none', name: 'No source yet', kind: TYPED_KIND, source: null, choiceId: '' }
	const source = sources.get().find((s) => s.id === parsed.sourceId) ?? null
	const choice = source?.choices().find((c) => c.id === parsed.choiceId)
	if (!source || !choice) return { type: 'missing', name: source ? `${source.label}: gone` : 'Source unavailable', kind: TYPED_KIND, source, choiceId: parsed.choiceId }
	return { type: 'source', name: choice.label, kind: source.kind(parsed.choiceId), source, choiceId: parsed.choiceId }
}
