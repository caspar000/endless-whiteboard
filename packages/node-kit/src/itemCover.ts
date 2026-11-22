import { useAsset } from './assets'
import { generatedCover } from './generatedCover'
import type { SourceEntry, SourceKind } from './itemSources'

/** A dropped picture, kept in the app's blob store (see `AssetBridge`). */
const isStored = (src: string) => src.startsWith('asset:')

/**
 * Where an item's picture comes from: a dropped one, one from a page or a source, or else one drawn
 * from its title (`generatedCover`), so every item has a cover.
 */
export function useItemCover(item: Pick<SourceEntry, 'title' | 'creator' | 'year' | 'cover'>, shape: SourceKind['shape'] = 'square'): string {
	return useItemCoverState(item, shape).url
}

/**
 * The same, with whether the picture is still being found: a dropped one whose stored copy hasn't
 * resolved yet. Until it has, `url` is the drawn cover, never the item before's picture.
 */
export function useItemCoverState(
	item: Pick<SourceEntry, 'title' | 'creator' | 'year' | 'cover'>,
	shape: SourceKind['shape'] = 'square'
): { url: string; pending: boolean } {
	const stored = useAsset(isStored(item.cover) ? item.cover : '')
	if (isStored(item.cover)) return { url: stored.url ?? generatedCover(item, shape), pending: stored.pending }
	return { url: item.cover || generatedCover(item, shape), pending: false }
}
