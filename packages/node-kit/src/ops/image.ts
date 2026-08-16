import { AssetRecordType, createShapeId, type TLAssetId, type TLImageAsset } from 'tldraw'
import { getAssetBridge } from '../assets'
import { defineOperation, fail, ok, type RegisteredOperation } from '../operations'
import { BOARD_ID_PARAM, resolveEditor } from './shared'

/**
 * Putting a picture on the board.
 *
 * Its own file rather than a row in `node.ts` because an image is not a node: it is tldraw's own
 * `image` shape backed by an asset, so it carries none of the property machinery the node operations
 * exist to drive. Sharing a module would mean sharing helpers that do not apply.
 *
 * This is the operation that makes "look it up and put it on the board" mean pictures as well as
 * text — an agent researching something can bring back the thing it found, not only a description
 * of it.
 */

/**
 * The ceiling on a fetched image.
 *
 * Deliberately far below the app's 64 MB interactive import cap (`persistence/downscale.ts`). That
 * one bounds a file a *person* chose and is watching land; this bounds a URL a model produced, where
 * a mistake is silent and the cost is a frozen tab. An agent that needs a 50 MB image is wrong about
 * something else.
 */
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

/** Widest an image is placed at, so a 6000px original does not arrive filling the whole board. */
const MAX_PLACED_WIDTH = 720

interface Decoded {
	blob: Blob
	width: number
	height: number
	mimeType: string
}

/**
 * Fetches and measures the image, or explains why it could not.
 *
 * Every failure returns a sentence rather than throwing, because the caller is a model reading the
 * result: "that host does not allow it, try Wikimedia" is something it can act on, and a stack trace
 * is not.
 */
async function fetchImage(url: string): Promise<{ ok: true; image: Decoded } | { ok: false; error: string }> {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch {
		return { ok: false, error: `"${url}" is not a URL. Pass a direct link to an image file.` }
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		return { ok: false, error: `Only http and https URLs can be fetched, not "${parsed.protocol}".` }
	}

	let response: Response
	try {
		response = await fetch(parsed.href)
	} catch {
		// Overwhelmingly CORS. The fetch happens in the browser tab, so the image's host has to allow
		// it — and the message says so, because the fix is choosing a different source rather than
		// retrying this one.
		return {
			ok: false,
			error: `Could not fetch ${parsed.href} — the host either refused the request or does not allow other sites to read its images (CORS). Try a direct file URL from a source that permits it, such as upload.wikimedia.org.`,
		}
	}
	if (!response.ok) {
		return { ok: false, error: `${parsed.href} returned HTTP ${response.status}.` }
	}

	const blob = await response.blob()
	if (!blob.type.startsWith('image/')) {
		return {
			ok: false,
			error: `${parsed.href} is ${blob.type || 'of an unknown type'}, not an image. Link directly to the image file rather than to the page containing it.`,
		}
	}
	if (blob.size > MAX_IMAGE_BYTES) {
		return {
			ok: false,
			error: `That image is ${Math.round(blob.size / 1024 / 1024)} MB, over the ${MAX_IMAGE_BYTES / 1024 / 1024} MB limit for images fetched by an agent.`,
		}
	}

	// The real pixel size has to come from decoding: a shape sized from anything else would letterbox
	// or stretch the picture, and neither is recoverable by the user without redoing it.
	try {
		const bitmap = await createImageBitmap(blob)
		const decoded = { blob, width: bitmap.width, height: bitmap.height, mimeType: blob.type }
		bitmap.close()
		return { ok: true, image: decoded }
	} catch {
		return {
			ok: false,
			error: `The file at ${parsed.href} could not be decoded as an image. SVGs and some formats cannot be measured this way — try a PNG or JPEG.`,
		}
	}
}

/**
 * The size to place at: the original, scaled down to fit `MAX_PLACED_WIDTH`, or an explicit width.
 *
 * Exported for its test. Aspect ratio is the whole job — a letterboxed or stretched picture is not
 * something the user can fix without deleting it and asking again.
 */
export function placedSize(
	image: { width: number; height: number },
	requested?: number
): { w: number; h: number } {
	const target = requested && requested > 0 ? requested : Math.min(image.width, MAX_PLACED_WIDTH)
	const scale = target / image.width
	return { w: Math.round(target), h: Math.round(image.height * scale) }
}

export const imageOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'node.image',
		title: 'Add image from URL',
		description:
			'Downloads an image and places it on the board, returning the new shape id. Give a direct link to an image file (ending .png, .jpg, .webp and so on), not a link to the page it appears on. The image is fetched by the browser, so its host has to allow that — Wikimedia and most CDNs do. Position is the centre in page coordinates; omit x and y to place it in the middle of the current view.',
		params: {
			url: { type: 'string', description: 'Direct https URL of the image file.', required: true },
			x: { type: 'number', description: 'Page x of the image’s centre.' },
			y: { type: 'number', description: 'Page y of the image’s centre.' },
			width: {
				type: 'number',
				description:
					'Width to place it at, in page units. Omit to use the image’s own width, capped so a large picture does not swamp the board.',
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const fetched = await fetchImage(args.url)
			if (!fetched.ok) return fail(fetched.error)
			const image = fetched.image

			// Content-addressed, so the same picture fetched twice costs one blob.
			const src = await getAssetBridge().store(image.blob)

			const { w, h } = placedSize(image, args.width)
			const centre = editor.getViewportPageBounds().center
			const x = (args.x ?? centre.x) - w / 2
			const y = (args.y ?? centre.y) - h / 2

			const assetId: TLAssetId = AssetRecordType.createId()
			const asset: TLImageAsset = {
				id: assetId,
				typeName: 'asset',
				type: 'image',
				meta: {},
				props: {
					name: args.url.split('/').pop() || 'image',
					src,
					w: image.width,
					h: image.height,
					mimeType: image.mimeType,
					isAnimated: false,
					fileSize: image.blob.size,
				},
			}

			const shapeId = createShapeId()
			// One `run`, so the asset and the shape are a single undo entry — an agent's image comes off
			// the board in one ⌘Z, like everything else it does.
			editor.run(() => {
				editor.markHistoryStoppingPoint('add image')
				editor.createAssets([asset])
				editor.createShape({ id: shapeId, type: 'image', x, y, props: { assetId, w, h } })
			})

			return ok({
				id: shapeId,
				type: 'image',
				x,
				y,
				w,
				h,
				source: { width: image.width, height: image.height, bytes: image.blob.size },
			})
		},
	}),
]
