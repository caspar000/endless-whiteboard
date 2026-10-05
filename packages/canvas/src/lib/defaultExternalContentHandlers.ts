import {
	toRichText,
	AssetRecordType,
	Editor,
	MediaHelpers,
	TLAsset,
	TLAssetId,
	TLBookmarkShape,
	TLEmbedShape,
	TLShapeId,
	TLShapePartial,
	TLTextShape,
	TLTextShapeProps,
	Vec2d,
	VecLike,
	compact,
	createShapeId,
	TLFilesExternalContent,
	TLTextExternalContent,
	TLUrlExternalContent,
	getHashForString,
	FileHelpers,
	dataUrlToFile,
} from '@lifeboard/canvas-editor'
import { FONT_FAMILIES, FONT_SIZES, TEXT_PROPS } from './shapes/shared/default-shape-constants'
import { containBoxSize, getResizedImageDataUrl, isGifAnimated } from './utils/assets/assets'
import { getEmbedInfo } from './utils/embeds/embeds'
import { cleanupText, isRightToLeftLanguage, truncateStringWithEllipsis } from './utils/text/text'

/** @public */
export type TLExternalContentProps = {
	// The maximum dimension (width or height) of an image. Images larger than this will be rescaled to fit. Defaults to infinity.
	maxImageDimension: number
	// The maximum size (in bytes) of an asset. Assets larger than this will be rejected. Defaults to 10mb (10 * 1024 * 1024).
	maxAssetSize: number
	// The mime types of images that are allowed to be handled. Defaults to ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'].
	acceptedImageMimeTypes: string[]
	// The mime types of videos that are allowed to be handled. Defaults to ['video/mp4', 'video/webm', 'video/quicktime'].
	acceptedVideoMimeTypes: string[]
}

export function registerDefaultExternalContentHandlers(
	editor: Editor,
	{
		maxImageDimension,
		maxAssetSize,
		acceptedImageMimeTypes,
		acceptedVideoMimeTypes,
	}: TLExternalContentProps
) {
	// files -> asset, stored through the store's asset store (docs/fork-parity.md E10)
	editor.registerExternalAssetHandler('file', async ({ file }) => {
		const isImageType = acceptedImageMimeTypes.includes(file.type)
		if (!isImageType && !acceptedVideoMimeTypes.includes(file.type)) {
			throw Error(`File type not allowed: ${file.type}`)
		}
		if (file.size > maxAssetSize) {
			throw Error(
				`File size too big: ${(file.size / 1024).toFixed()}kb > ${(maxAssetSize / 1024).toFixed()}kb`
			)
		}

		const measured = isImageType
			? await MediaHelpers.getImageSize(file)
			: await MediaHelpers.getVideoSize(file)
		let size: { w: number; h: number } = { w: measured.w, h: measured.h }
		const isAnimated = isImageType ? file.type === 'image/gif' && (await isGifAnimated(file)) : true

		// Large JPEGs and PNGs are scaled down before they are stored, as in 2023.
		let toStore: File = file
		if (isFinite(maxImageDimension) && (file.type === 'image/jpeg' || file.type === 'image/png')) {
			const resized = containBoxSize(size, { w: maxImageDimension, h: maxImageDimension })
			if (resized !== size) {
				const dataUrl = await getResizedImageDataUrl(
					await FileHelpers.blobToDataUrl(file),
					resized.w,
					resized.h,
					{ type: file.type, quality: 0.92 }
				)
				toStore = await dataUrlToFile(dataUrl, file.name, file.type)
				size = resized
			}
		}

		const asset = AssetRecordType.create({
			id: AssetRecordType.createId(),
			type: isImageType ? 'image' : 'video',
			typeName: 'asset',
			props: {
				name: file.name,
				src: null,
				w: size.w,
				h: size.h,
				mimeType: file.type,
				isAnimated,
				fileSize: toStore.size,
			},
			meta: {},
		}) as TLAsset

		const { src, meta } = await editor.uploadAsset(asset, toStore)
		return { ...asset, props: { ...asset.props, src }, meta: { ...asset.meta, ...meta } } as TLAsset
	})

	// urls -> bookmark asset
	editor.registerExternalAssetHandler('url', async ({ url }) => {
		let meta: { image: string; title: string; description: string }

		try {
			const resp = await fetch(url, { method: 'GET', mode: 'no-cors' })
			const html = await resp.text()
			const doc = new DOMParser().parseFromString(html, 'text/html')
			meta = {
				image: doc.head.querySelector('meta[property="og:image"]')?.getAttribute('content') ?? '',
				title:
					doc.head.querySelector('meta[property="og:title"]')?.getAttribute('content') ??
					truncateStringWithEllipsis(url, 32),
				description:
					doc.head.querySelector('meta[property="og:description"]')?.getAttribute('content') ?? '',
			}
		} catch (error) {
			console.error(error)
			meta = { image: '', title: truncateStringWithEllipsis(url, 32), description: '' }
		}

		// Create the bookmark asset from the meta
		return {
			id: AssetRecordType.createId(getHashForString(url)),
			typeName: 'asset',
			type: 'bookmark',
			props: {
				src: url,
				description: meta.description,
				image: meta.image,
				favicon: '',
				title: meta.title,
			},
			meta: {},
		}
	})

	// svg text
	editor.registerExternalContentHandler('svg-text', async ({ point, text }) => {
		const position =
			point ??
			(editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageCenter())

		const svg = new DOMParser().parseFromString(text, 'image/svg+xml').querySelector('svg')
		if (!svg) {
			throw new Error('No <svg/> element present')
		}

		let width = parseFloat(svg.getAttribute('width') || '0')
		let height = parseFloat(svg.getAttribute('height') || '0')

		if (!(width && height)) {
			document.body.appendChild(svg)
			const box = svg.getBoundingClientRect()
			document.body.removeChild(svg)

			width = box.width
			height = box.height
		}

		const asset = await editor.getAssetForExternalContent({
			type: 'file',
			file: new File([text], 'asset.svg', { type: 'image/svg+xml' }),
		})

		if (!asset) throw Error('Could not create an asset')

		createShapesForAssets(editor, [asset], position)
	})

	// embeds
	editor.registerExternalContentHandler('embed', ({ point, url, embed }) => {
		const position =
			point ??
			(editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageCenter())

		const { width, height } = embed

		const id = createShapeId()

		const shapePartial: TLShapePartial<TLEmbedShape> = {
			id,
			type: 'embed',
			x: position.x - (width || 450) / 2,
			y: position.y - (height || 450) / 2,
			props: {
				w: width,
				h: height,
				url,
			},
		}

		editor.createShapes([shapePartial]).select(id)
	})

	// files
	editor.registerExternalContentHandler('files', (content) =>
		defaultHandleExternalFileContent(editor, content, {
			maxAssetSize,
			acceptedImageMimeTypes,
			acceptedVideoMimeTypes,
		})
	)

	// text
	editor.registerExternalContentHandler('text', (content) =>
		defaultHandleExternalTextContent(editor, content)
	)

	// url
	editor.registerExternalContentHandler('url', (content) =>
		defaultHandleExternalUrlContent(editor, content)
	)
}

export async function createShapesForAssets(
	editor: Editor,
	assets: TLAsset[],
	position: VecLike
): Promise<TLShapeId[]> {
	if (!assets.length) return []

	const currentPoint = Vec2d.From(position)
	const partials: TLShapePartial[] = []

	for (const asset of assets) {
		switch (asset.type) {
			case 'bookmark': {
				partials.push({
					id: createShapeId(),
					type: 'bookmark',
					x: currentPoint.x - 150,
					y: currentPoint.y - 160,
					opacity: 1,
					props: {
						assetId: asset.id,
						url: asset.props.src ?? '',
					},
				})

				currentPoint.x += 300
				break
			}
			case 'image': {
				partials.push({
					id: createShapeId(),
					type: 'image',
					x: currentPoint.x - asset.props.w / 2,
					y: currentPoint.y - asset.props.h / 2,
					opacity: 1,
					props: {
						assetId: asset.id,
						w: asset.props.w,
						h: asset.props.h,
					},
				})

				currentPoint.x += asset.props.w
				break
			}
			case 'video': {
				partials.push({
					id: createShapeId(),
					type: 'video',
					x: currentPoint.x - asset.props.w / 2,
					y: currentPoint.y - asset.props.h / 2,
					opacity: 1,
					props: {
						assetId: asset.id,
						w: asset.props.w,
						h: asset.props.h,
					},
				})

				currentPoint.x += asset.props.w
			}
		}
	}

	editor.batch(() => {
		// Create any assets
		const assetsToCreate = assets.filter((asset) => !editor.getAsset(asset.id))
		if (assetsToCreate.length) {
			editor.createAssets(assetsToCreate)
		}

		// Create the shapes
		editor.createShapes(partials).select(...partials.map((p) => p.id))

		// Re-position shapes so that the center of the group is at the provided point
		centerSelectionAroundPoint(editor, position)
	})

	return partials.map((p) => p.id)
}

function centerSelectionAroundPoint(editor: Editor, position: VecLike) {
	// Re-position shapes so that the center of the group is at the provided point
	const viewportPageBounds = editor.getViewportPageBounds()
	let selectionPageBounds = editor.getSelectionPageBounds()

	if (selectionPageBounds) {
		const offset = selectionPageBounds!.center.sub(position)

		editor.updateShapes(
			editor.getSelectedShapes().map((shape) => {
				const localRotation = editor.getShapeParentTransform(shape).decompose().rotation
				const localDelta = Vec2d.Rot(offset, -localRotation)
				return {
					id: shape.id,
					type: shape.type,
					x: shape.x! - localDelta.x,
					y: shape.y! - localDelta.y,
				}
			})
		)
	}

	// Zoom out to fit the shapes, if necessary
	selectionPageBounds = editor.getSelectionPageBounds()
	if (selectionPageBounds && !viewportPageBounds.contains(selectionPageBounds)) {
		editor.zoomToSelection()
	}
}

export function createEmptyBookmarkShape(
	editor: Editor,
	url: string,
	position: VecLike
): TLBookmarkShape {
	const partial: TLShapePartial = {
		id: createShapeId(),
		type: 'bookmark',
		x: position.x - 150,
		y: position.y - 160,
		opacity: 1,
		props: {
			assetId: null,
			url,
		},
	}

	editor.batch(() => {
		editor.createShapes([partial]).select(partial.id)
		centerSelectionAroundPoint(editor, position)
	})

	return editor.getShape(partial.id) as TLBookmarkShape
}

/** Options for the default file handler; Lifeboard passes its own size limit and toasts. @public */
export interface TLDefaultExternalContentHandlerOpts {
	maxAssetSize?: number
	acceptedImageMimeTypes?: readonly string[]
	acceptedVideoMimeTypes?: readonly string[]
	toasts?: { addToast(toast: { title: string; description?: string; severity?: 'success' | 'info' | 'warning' | 'error' }): unknown }
	msg?: (key: string) => string
}

/** @public */
export const DEFAULT_ACCEPTED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/svg+xml']
/** @public */
export const DEFAULT_ACCEPTED_VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime']
/** @public */
export const DEFAULT_MAX_ASSET_SIZE = 10 * 1024 * 1024

/**
 * Dropped or pasted files: images and videos become shapes, through the asset store. What an app
 * doesn't take itself can be handed on to this.
 *
 * @public
 */
export async function defaultHandleExternalFileContent(
	editor: Editor,
	{ point, files }: TLFilesExternalContent,
	{
		maxAssetSize = DEFAULT_MAX_ASSET_SIZE,
		acceptedImageMimeTypes = DEFAULT_ACCEPTED_IMAGE_MIME_TYPES,
		acceptedVideoMimeTypes = DEFAULT_ACCEPTED_VIDEO_MIME_TYPES,
		toasts,
		msg,
	}: TLDefaultExternalContentHandlerOpts = {}
) {
	const position =
		point ??
		(editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageCenter())

	const pagePoint = new Vec2d(position.x, position.y)

	const assets: TLAsset[] = []

	await Promise.all(
		files.map(async (file, i) => {
			if (file.size > maxAssetSize) {
				toasts?.addToast({
					title: msg?.('assets.files.size-too-big') ?? 'File too large',
					description: file.name,
					severity: 'error',
				})
				console.warn(
					`File size too big: ${(file.size / 1024).toFixed()}kb > ${(
						maxAssetSize / 1024
					).toFixed()}kb`
				)
				return null
			}

			// Use mime type instead of file ext, this is because
			// window.navigator.clipboard does not preserve file names
			// of copied files.
			if (!file.type) {
				throw new Error('No mime type')
			}

			// We can only accept certain extensions (either images or a videos)
			if (!acceptedImageMimeTypes.concat(acceptedVideoMimeTypes).includes(file.type)) {
				console.warn(`${file.name} not loaded - Extension not allowed.`)
				return null
			}

			try {
				const asset = await editor.getAssetForExternalContent({ type: 'file', file })

				if (!asset) {
					throw Error('Could not create an asset')
				}

				assets[i] = asset
			} catch (error) {
				console.error(error)
				return null
			}
		})
	)

	createShapesForAssets(editor, compact(assets), pagePoint)
}

/** Dropped or pasted text: a text shape, sized to it. @public */
export async function defaultHandleExternalTextContent(
	editor: Editor,
	{ point, text }: TLTextExternalContent
) {
	const p =
		point ??
		(editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageCenter())

	const defaultProps = editor.getShapeUtil<TLTextShape>('text').getDefaultProps()

	const textToPaste = cleanupText(text)

	// Measure the text with default values
	let w: number
	let h: number
	let autoSize: boolean
	let align = 'middle' as TLTextShapeProps['textAlign']

	const isMultiLine = textToPaste.split('\n').length > 1

	// check whether the text contains the most common characters in RTL languages
	const isRtl = isRightToLeftLanguage(textToPaste)

	if (isMultiLine) {
		align = isMultiLine ? (isRtl ? 'end' : 'start') : 'middle'
	}

	const rawSize = editor.textMeasure.measureText(textToPaste, {
		...TEXT_PROPS,
		fontFamily: FONT_FAMILIES[defaultProps.font],
		fontSize: FONT_SIZES[defaultProps.size],
		maxWidth: null,
	})

	const minWidth = Math.min(
		isMultiLine ? editor.getViewportPageBounds().width * 0.9 : 920,
		Math.max(200, editor.getViewportPageBounds().width * 0.9)
	)

	if (rawSize.w > minWidth) {
		const shrunkSize = editor.textMeasure.measureText(textToPaste, {
			...TEXT_PROPS,
			fontFamily: FONT_FAMILIES[defaultProps.font],
			fontSize: FONT_SIZES[defaultProps.size],
			maxWidth: minWidth,
		})
		w = shrunkSize.w
		h = shrunkSize.h
		autoSize = false
		align = isRtl ? 'end' : 'start'
	} else {
		// autosize is fine
		w = rawSize.w
		h = rawSize.h
		autoSize = true
	}

	if (p.y - h / 2 < editor.getViewportPageBounds().minY + 40) {
		p.y = editor.getViewportPageBounds().minY + 40 + h / 2
	}

	editor.createShapes<TLTextShape>([
		{
			id: createShapeId(),
			type: 'text',
			x: p.x - w / 2,
			y: p.y - h / 2,
			props: {
				richText: toRichText(textToPaste),
				// if the text has more than one line, align it to the left
				textAlign: align,
				autoSize,
				w,
			},
		},
	])
}

/** A dropped or pasted link: an embed if it is one, a bookmark card otherwise. @public */
export async function defaultHandleExternalUrlContent(
	editor: Editor,
	{ point, url }: TLUrlExternalContent,
	_opts: TLDefaultExternalContentHandlerOpts = {}
) {
	// try to paste as an embed first
	const embedInfo = getEmbedInfo(url)

	if (embedInfo) {
		return editor.putExternalContent({
			type: 'embed',
			url: embedInfo.url,
			point,
			embed: embedInfo.definition,
		})
	}

	const position =
		point ??
		(editor.inputs.shiftKey ? editor.inputs.currentPagePoint : editor.getViewportPageCenter())

	const assetId: TLAssetId = AssetRecordType.createId(getHashForString(url))
	const shape = createEmptyBookmarkShape(editor, url, position)

	// Use an existing asset if we have one, or else else create a new one
	let asset = editor.getAsset(assetId) as TLAsset
	let shouldAlsoCreateAsset = false
	if (!asset) {
		shouldAlsoCreateAsset = true
		const bookmarkAsset = await editor.getAssetForExternalContent({ type: 'url', url })
		if (!bookmarkAsset) throw Error('Could not create an asset')
		asset = bookmarkAsset
	}

	editor.batch(() => {
		if (shouldAlsoCreateAsset) {
			editor.createAssets([asset])
		}

		editor.updateShapes([
			{
				id: shape.id,
				type: shape.type,
				props: {
					assetId: asset.id,
				},
			},
		])
	})
}
