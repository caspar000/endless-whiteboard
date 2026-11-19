import { getAssetBridge } from '@lifeboard/node-kit'
import {
	AssetRecordType,
	createShapeId,
	getHashForString,
	type Editor,
	type TLAssetId,
	type TLBookmarkAsset,
	type TLBookmarkShape,
	type TLShapeId,
	type VecLike,
} from '@lifeboard/canvas'
import { downscaleImage } from '../../persistence/downscale'
import { fetchLinkPreview, fetchLinkPreviewImage } from '../../server/serverVault'
import { LINK_PREVIEW_SIZE, linkDomain } from './linkPreview'

/**
 * Where a link card's details come from: the page, read by the server, its picture and icon kept as
 * the board's own files. A dead link, or a site that later blocks its pictures from other sites,
 * still shows its card, as cards brought over from Freeform do. Without a server the card goes by its
 * domain and can be named by hand.
 */

/** The asset every card of this address shares. Its id is the address's, as tldraw's own is. */
export const bookmarkAssetId = (url: string): TLAssetId => AssetRecordType.createId(getHashForString(url))

/** A preview picture as a card shows it: big enough for a large card, far under a photo. */
const IMAGE_EDGE = 1200
/** An icon is drawn at 14 pixels. */
const ICON_EDGE = 128

/** A picture as one of the board's own files, or `''` if it couldn't be had. */
async function keep(blob: Blob | null, maxEdge: number): Promise<string> {
	if (!blob || !blob.type.startsWith('image/')) return ''
	try {
		const { blob: small } = await downscaleImage(blob, { maxEdge })
		return await getAssetBridge().store(small)
	} catch {
		return ''
	}
}

/** The card details for an address, and whether they came from the page rather than its domain. */
interface Lookup {
	asset: TLBookmarkAsset
	fromPage: boolean
}

/** Lookups in flight, so cards of the same address dropped together ask once. */
const pending = new Map<string, Promise<Lookup>>()

/** The card details for an address: read from the page when there is a server, its domain otherwise. */
export function lookUpBookmark(url: string): Promise<Lookup> {
	let lookup = pending.get(url)
	if (!lookup) {
		lookup = readBookmark(url).finally(() => pending.delete(url))
		pending.set(url, lookup)
	}
	return lookup
}

async function readBookmark(url: string): Promise<Lookup> {
	const page = await fetchLinkPreview(url)
	const [image, favicon] = await Promise.all([
		keep(page?.image ? await fetchLinkPreviewImage(page.image) : null, IMAGE_EDGE),
		keep(page?.favicon ? await fetchLinkPreviewImage(page.favicon) : null, ICON_EDGE),
	])
	const asset: TLBookmarkAsset = {
		id: bookmarkAssetId(url),
		typeName: 'asset',
		type: 'bookmark',
		props: {
			src: url,
			title: page?.title || linkDomain(url) || url,
			description: page?.description ?? '',
			image,
			favicon,
		},
		meta: {},
	}
	return { asset, fromPage: !!page?.title }
}

/**
 * Gives a card its details: the shared asset of its address if the board has one, the page's
 * otherwise. `refresh` reads the page again even when the board has them, and replaces them for every
 * card of the address.
 *
 * Out of the undo history: the details arrive on their own after the card does, and undoing the drop
 * should take the card away, not leave a nameless one behind.
 *
 * Says whether the page could be read, which a refetch reports.
 */
export async function fillBookmark(editor: Editor, id: TLShapeId, { refresh = false } = {}): Promise<boolean> {
	const shape = editor.getShape<TLBookmarkShape>(id)
	if (!shape?.props.url) return false
	const url = shape.props.url
	const assetId = bookmarkAssetId(url)
	const known = !refresh && editor.getAsset(assetId)
	const lookup = known ? null : await lookUpBookmark(url)
	const asset = lookup?.asset

	editor.run(
		() => {
			if (asset) {
				if (editor.getAsset(asset.id)) editor.updateAssets([asset])
				else editor.createAssets([asset])
			}
			// The card may have been deleted, or pointed somewhere else, while the page was read.
			const now = editor.getShape<TLBookmarkShape>(id)
			if (now?.props.url === url && now.props.assetId !== assetId) {
				editor.updateShape<TLBookmarkShape>({ id, type: 'bookmark', props: { assetId } })
			}
		},
		{ history: 'ignore' }
	)
	return lookup ? lookup.fromPage : true
}

/**
 * A link dropped or pasted on the board, as a square card centred where it landed. Its details follow
 * as they arrive (`LinkPreviewShapeUtil.onBeforeCreate`).
 */
export function createLinkPreview(editor: Editor, url: string, point: VecLike): TLShapeId {
	const id = createShapeId()
	const size = LINK_PREVIEW_SIZE
	editor.run(() => {
		editor.markHistoryStoppingPoint('drop link')
		editor.createShape<TLBookmarkShape>({
			id,
			type: 'bookmark',
			x: point.x - size / 2,
			y: point.y - size / 2,
			props: { url, w: size, h: size, assetId: null },
		})
		editor.select(id)
	})
	return id
}
