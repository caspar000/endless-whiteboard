import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import { RecursivePartial } from '@lifeboard/canvas-editor'
import { useMemo } from 'react'

/** @public */
export type TLEditorAssetUrls = {
	fonts: {
		monospace: string
		serif: string
		sansSerif: string
		draw: string
	}
}

/**
 * The fonts bundled with the app from `@lifeboard/canvas-assets`. Upstream pointed these at a CDN;
 * the fork never loads anything from one, so a board works offline and nothing is fetched from
 * tldraw's servers.
 *
 * @public
 */
export let defaultEditorAssetUrls: TLEditorAssetUrls = { fonts: getAssetUrlsByImport().fonts }

/** @public */
export function setDefaultEditorAssetUrls(assetUrls: TLEditorAssetUrls) {
	defaultEditorAssetUrls = assetUrls
}

/** @internal */
export function useDefaultEditorAssetsWithOverrides(
	overrides?: RecursivePartial<TLEditorAssetUrls>
): TLEditorAssetUrls {
	return useMemo(() => {
		if (!overrides) return defaultEditorAssetUrls

		return {
			fonts: { ...defaultEditorAssetUrls.fonts, ...overrides?.fonts },
		}
	}, [overrides])
}
