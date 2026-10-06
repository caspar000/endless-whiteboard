import { registerFontSource } from '@lifeboard/canvas-editor'
import { useEffect, useMemo, useState } from 'react'
import { TLEditorAssetUrls } from '../../utils/static-assets/assetUrls'

/**
 * A font family's faces: regular, and bold and italic where the assets have them (tldraw 5 has all
 * four for every family). Without its own bold, a label's bold text draws at the regular weight.
 */
function getFaces(assetUrls: TLEditorAssetUrls): { family: string; url: string; weight: string; style: string }[] {
	const { fonts } = assetUrls
	const families = [
		['tldraw_draw', 'draw'],
		['tldraw_serif', 'serif'],
		['tldraw_sans', 'sansSerif'],
		['tldraw_mono', 'monospace'],
	] as const
	return families.flatMap(([family, key]) =>
		(
			[
				[fonts[key], 'normal', 'normal'],
				[fonts[`${key}Bold`], 'bold', 'normal'],
				[fonts[`${key}Italic`], 'normal', 'italic'],
				[fonts[`${key}BoldItalic`], 'bold', 'italic'],
			] as const
		).flatMap(([url, weight, style]) => (url ? [{ family, url, weight, style }] : []))
	)
}

// todo: Expose this via a public API (prop on <Tldraw>).

export function usePreloadAssets(assetUrls: TLEditorAssetUrls) {
	const faces = useMemo(() => getFaces(assetUrls), [assetUrls])
	const [state, setState] = useState<{ done: boolean; error: boolean }>({ done: false, error: false })

	useEffect(() => {
		let cancelled = false
		setState({ done: false, error: false })

		const loaded = faces.map(({ family, url, weight, style }) => {
			const font = new FontFace(family, `url(${url})`, { weight, style })
			// Read by exports, which embed the fonts a picture uses (getFontDefForExport, exportLabelFromDom).
			registerFontSource(font, url)
			// @ts-expect-error
			font.$$_url = url
			// @ts-expect-error
			font.$$_fontface = `
@font-face {
	font-family: ${family};
	font-weight: ${weight};
	font-style: ${style};
	src: url("${url}") format("woff2")
}`
			return font.load().then(() => {
				if (!cancelled) document.fonts.add(font)
				return font
			})
		})

		Promise.allSettled(loaded).then((results) => {
			if (cancelled) return
			for (const result of results) if (result.status === 'rejected') console.error(result.reason)
			setState({ done: true, error: results.some((result) => result.status === 'rejected') })
		})

		return () => {
			cancelled = true
			for (const font of loaded) void font.then((font) => document.fonts.delete(font), () => {})
		}
	}, [faces])

	return state
}
