import { useAssetUrl } from './assets'
import { generatedCover } from './generatedCover'
import type { SourceEntry, SourceKind } from './itemSources'

/** A dropped picture, kept in the app's blob store (see `AssetBridge`). */
const isStored = (src: string) => src.startsWith('asset:')

/**
 * Where an item's picture comes from: a dropped one, one from a page or a source, or else one drawn
 * from its title (`generatedCover`), so every item has a cover.
 */
export function useItemCover(item: Pick<SourceEntry, 'title' | 'creator' | 'year' | 'cover'>, shape: SourceKind['shape'] = 'square'): string {
	const stored = useAssetUrl(isStored(item.cover) ? item.cover : '')
	if (isStored(item.cover)) return stored ?? generatedCover(item, shape)
	return item.cover || generatedCover(item, shape)
}
