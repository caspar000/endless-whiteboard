import { resolveItemSource, type ItemSource, type ResolvedItemSource } from '@lifeboard/node-kit'
import { TYPED_KIND, TYPED_SOURCE } from './model'

/**
 * What a randomizer shuffles. The card itself is only the front: a split-flap window waiting for
 * something to pick from. It holds a typed list of its own; anything else comes from a source in the
 * kit's registry (`@lifeboard/node-kit`'s `itemSources.ts`), where Feeds offers its videos and the
 * Syllabus its works without knowing a randomizer exists (DARK-7, DARK-11).
 */

/** What a source key points at, as the card shows it. */
export interface ResolvedSource extends Omit<ResolvedItemSource, 'type'> {
	/** `typed` for the card's own list, `none` for no source yet, `missing` for one that is gone. */
	type: ResolvedItemSource['type'] | 'typed'
	source: ItemSource | null
}

/** A source key as the card shows it: the kit's reading, plus the card's own typed list. */
export function resolveSource(key: string): ResolvedSource {
	if (key === TYPED_SOURCE) return { type: 'typed', name: 'My list', kind: TYPED_KIND, source: null, choiceId: '' }
	return resolveItemSource(key)
}
