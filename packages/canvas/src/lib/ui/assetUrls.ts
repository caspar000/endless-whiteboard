import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import { EMBED_DEFINITIONS, LANGUAGES, RecursivePartial } from '@lifeboard/canvas-editor'
import { TLEditorAssetUrls, defaultEditorAssetUrls } from '../utils/static-assets/assetUrls'
import { TLUiIconType } from './icon-types'

export type TLUiAssetUrls = TLEditorAssetUrls & {
	icons: Record<TLUiIconType | Exclude<string, TLUiIconType>, string>
	translations: Record<(typeof LANGUAGES)[number]['locale'], string>
	embedIcons: Record<(typeof EMBED_DEFINITIONS)[number]['type'], string>
}

/** @public */
export type TLUiAssetUrlOverrides = RecursivePartial<TLUiAssetUrls>

const bundled = getAssetUrlsByImport()

/**
 * Icons, translations and embed icons bundled with the app, as the fonts are (see
 * `defaultEditorAssetUrls`). Today's language list is longer than the 2023 translations; the
 * languages without one get English.
 */
export let defaultUiAssetUrls: TLUiAssetUrls = {
	...bundled,
	...defaultEditorAssetUrls,
	translations: Object.fromEntries(
		LANGUAGES.map(({ locale }) => [
			locale,
			(bundled.translations as Record<string, string | undefined>)[locale] ?? bundled.translations.en,
		])
	) as TLUiAssetUrls['translations'],
}

/** @internal */
export function setDefaultUiAssetUrls(urls: TLUiAssetUrls) {
	defaultUiAssetUrls = urls
}

/** @internal */
export function useDefaultUiAssetUrlsWithOverrides(
	overrides?: RecursivePartial<TLUiAssetUrls>
): TLUiAssetUrls {
	if (!overrides) return defaultUiAssetUrls

	return {
		fonts: Object.assign({ ...defaultUiAssetUrls.fonts }, { ...overrides?.fonts }),
		icons: Object.assign({ ...defaultUiAssetUrls.icons }, { ...overrides?.icons }),
		embedIcons: Object.assign({ ...defaultUiAssetUrls.embedIcons }, { ...overrides?.embedIcons }),
		translations: Object.assign(
			{ ...defaultUiAssetUrls.translations },
			{ ...overrides?.translations }
		),
	}
}
