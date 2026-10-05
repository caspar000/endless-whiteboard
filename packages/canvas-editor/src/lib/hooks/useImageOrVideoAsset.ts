import { useValue } from '@tldraw/state-react'
import type { TLAssetId, TLImageAsset, TLShapeId, TLVideoAsset } from '@tldraw/tlschema'
import { useEffect, useState } from 'react'
import { useEditor } from './useEditor'

/**
 * An image or video asset and the URL to show it at, resolved through the store's asset store.
 *
 * `width` is how wide it is drawn, in page units; with the zoom it decides how large it is on screen,
 * so the store can pick a resolution. The URL is looked up again when that size crosses a power of
 * two, and when the asset record changes (an upload finishing, say).
 *
 * @public
 */
export function useImageOrVideoAsset({
	assetId,
	width,
}: {
	assetId: TLAssetId | null
	width?: number
	shapeId?: TLShapeId
}): { asset: TLImageAsset | TLVideoAsset | undefined; url: string | null } {
	const editor = useEditor()
	const asset = useValue(
		'asset',
		() => {
			const record = assetId ? editor.getAsset(assetId) : undefined
			return record && (record.type === 'image' || record.type === 'video') ? record : undefined
		},
		[editor, assetId]
	)

	const steppedScreenScale = useValue(
		'asset screen scale',
		() => {
			if (!asset || !asset.props.w) return 1
			const scale = ((width ?? asset.props.w) * editor.getZoomLevel()) / asset.props.w
			return Math.max(1 / 8, 2 ** Math.ceil(Math.log2(scale)))
		},
		[editor, asset, width]
	)

	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		editor.resolveAssetUrl(asset?.id ?? null, { screenScale: steppedScreenScale }).then(
			(resolved) => {
				if (!cancelled) setUrl(resolved)
			},
			() => {
				if (!cancelled) setUrl(null)
			}
		)
		return () => {
			cancelled = true
		}
	}, [editor, asset, steppedScreenScale])

	return { asset, url }
}
