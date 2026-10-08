import {
	AssetRecordType,
	BaseBoxShapeUtil,
	Editor,
	HTMLContainer,
	TLAssetId,
	TLBookmarkAsset,
	TLBookmarkShape,
	TLOnBeforeCreateHandler,
	TLOnBeforeUpdateHandler,
	bookmarkShapeMigrations,
	bookmarkShapeProps,
	debounce,
	getHashForString,
	isValidUrl,
	stopEventPropagation,
	toDomPrecision,
} from '@lifeboard/canvas-editor'
import { useEffect, useState } from 'react'
import { truncateStringWithEllipsis } from '../../utils/text/text'
import { HyperlinkButton } from '../shared/HyperlinkButton'
import { getRotatedBoxShadow } from '../shared/rotated-box-shadow'

/** @public */
export class BookmarkShapeUtil extends BaseBoxShapeUtil<TLBookmarkShape> {
	static override type = 'bookmark' as const
	static override props = bookmarkShapeProps
	static override migrations = bookmarkShapeMigrations

	// Any size: a narrow card drops its description and keeps the picture (see the CSS).
	override canResize = () => true

	override getDefaultProps(): TLBookmarkShape['props'] {
		return {
			url: '',
			w: 300,
			h: 320,
			assetId: null,
		}
	}

	override component(shape: TLBookmarkShape) {
		const asset = (
			shape.props.assetId ? this.editor.getAsset(shape.props.assetId) : null
		) as TLBookmarkAsset

		const pageRotation = this.editor.getShapePageTransform(shape)!.rotation()

		const address = getHumanReadableAddress(shape)

		return (
			<HTMLContainer>
				<div
					className="tl-bookmark__container"
					style={{
						boxShadow: getRotatedBoxShadow(pageRotation),
					}}
				>
					<div className="tl-bookmark__image_container">
						{asset?.props.image ? (
							<BookmarkImage editor={this.editor} src={asset.props.image} alt={asset.props.title || ''} />
						) : (
							<div className="tl-bookmark__placeholder" />
						)}
						<HyperlinkButton url={shape.props.url} zoomLevel={this.editor.getZoomLevel()} />
					</div>
					<div className="tl-bookmark__copy_container">
						{asset?.props.title && (
							<h2 className="tl-bookmark__heading">
								{truncateStringWithEllipsis(asset?.props.title || '', 54)}
							</h2>
						)}
						{asset?.props.description && (
							<p className="tl-bookmark__description">
								{truncateStringWithEllipsis(asset?.props.description || '', 128)}
							</p>
						)}
						<a
							className="tl-bookmark__link"
							href={shape.props.url || ''}
							target="_blank"
							rel="noopener noreferrer"
							onPointerDown={stopEventPropagation}
							onPointerUp={stopEventPropagation}
							onClick={stopEventPropagation}
						>
							{truncateStringWithEllipsis(address, 45)}
						</a>
					</div>
				</div>
			</HTMLContainer>
		)
	}

	override indicator(shape: TLBookmarkShape) {
		return (
			<rect
				width={toDomPrecision(shape.props.w)}
				height={toDomPrecision(shape.props.h)}
				rx="8"
				ry="8"
			/>
		)
	}

	override onBeforeCreate?: TLOnBeforeCreateHandler<TLBookmarkShape> = (shape) => {
		updateBookmarkAssetOnUrlChange(this.editor, shape)
	}

	override onBeforeUpdate?: TLOnBeforeUpdateHandler<TLBookmarkShape> = (prev, shape) => {
		if (prev.props.url !== shape.props.url) {
			if (!isValidUrl(shape.props.url)) {
				return { ...shape, props: { ...shape.props, url: prev.props.url } }
			} else {
				updateBookmarkAssetOnUrlChange(this.editor, shape)
			}
		}
	}
}

/** @internal */
export const getHumanReadableAddress = (shape: TLBookmarkShape) => {
	try {
		const url = new URL(shape.props.url)
		const path = url.pathname.replace(/\/*$/, '')
		return `${url.hostname}${path}`
	} catch (e) {
		return shape.props.url
	}
}

function updateBookmarkAssetOnUrlChange(editor: Editor, shape: TLBookmarkShape) {
	const { url } = shape.props

	// Derive the asset id from the URL
	const assetId: TLAssetId = AssetRecordType.createId(getHashForString(url))

	if (editor.getAsset(assetId)) {
		// Existing asset for this URL?
		if (shape.props.assetId !== assetId) {
			editor.updateShapes<TLBookmarkShape>([
				{
					id: shape.id,
					type: shape.type,
					props: { assetId },
				},
			])
		}
	} else {
		// No asset for this URL?

		// First, clear out the existing asset reference
		editor.updateShapes<TLBookmarkShape>([
			{
				id: shape.id,
				type: shape.type,
				props: { assetId: null },
			},
		])

		// Then try to asyncronously create a new one
		createBookmarkAssetOnUrlChange(editor, shape)
	}
}

const createBookmarkAssetOnUrlChange = debounce(async (editor: Editor, shape: TLBookmarkShape) => {
	const { url } = shape.props

	// Create the asset using the external content manager's createAssetFromUrl method.
	// This may be overwritten by the user (for example, we overwrite it on tldraw.com)
	const asset = await editor.getAssetForExternalContent({ type: 'url', url })

	if (!asset) {
		// No asset? Just leave the bookmark as a null assetId.
		return
	}

	editor.batch(() => {
		// Create the new asset
		editor.createAssets([asset])

		// And update the shape
		editor.updateShapes<TLBookmarkShape>([
			{
				id: shape.id,
				type: shape.type,
				props: { assetId: asset.id },
			},
		])
	})
}, 500)

/**
 * A card's preview picture. Usually a web address; a card can also keep its picture as a file of the
 * board's own (`asset:<hash>`, as cards brought over from Freeform do), which resolves through the asset
 * store the way an image's does. The store hands a web address back unchanged.
 */
function BookmarkImage({ editor, src, alt }: { editor: Editor; src: string; alt: string }) {
	const [url, setUrl] = useState<string | null>(null)
	useEffect(() => {
		let cancelled = false
		const preview = AssetRecordType.create({
			id: AssetRecordType.createId(getHashForString(src)),
			type: 'image',
			props: { src, name: '', w: 0, h: 0, mimeType: null, isAnimated: false },
			meta: {},
		})
		void Promise.resolve(
			editor.store.props.assets.resolve(preview, {
				screenScale: 1,
				steppedScreenScale: 1,
				dpr: 1,
				networkEffectiveType: null,
				shouldResolveToOriginal: true,
			})
		).then((resolved) => {
			if (!cancelled) setUrl(resolved ?? null)
		})
		return () => {
			cancelled = true
		}
	}, [editor, src])
	if (!url) return <div className="tl-bookmark__placeholder" />
	return <img className="tl-bookmark__image" draggable={false} src={url} alt={alt} />
}
