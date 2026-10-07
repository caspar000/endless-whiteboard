import { Editor, Rectangle2d, TLImageAsset, TLImageShape, Vec2d } from '@lifeboard/canvas-editor'

/**
 * Where a picture is see-through, a click goes to what's behind it (docs/fork-parity.md X5).
 *
 * Each picture is read once, from its smallest copy, into a coarse grid of alpha values. Until that's
 * read, and for pictures that can't be (a JPEG has no transparency; another origin's can't be read
 * back), the whole picture counts as solid, as before.
 */
export class SeeThroughRectangle extends Rectangle2d {
	constructor(
		config: ConstructorParameters<typeof Rectangle2d>[0],
		private readonly isSeeThroughAt: (point: Vec2d) => boolean
	) {
		super(config)
	}

	override distanceToPoint(point: Vec2d, hitInside = false) {
		const distance = super.distanceToPoint(point, hitInside)
		// Inside, but nothing drawn there: as far away as the nearest edge.
		return distance < 0 && this.isSeeThroughAt(point) ? -distance : distance
	}
}

/** The grid's longer side, in cells. */
const MASK_SIZE = 128
/** Alpha (of 255) below which a cell counts as empty. */
const SEE_THROUGH = 16

interface Mask {
	w: number
	h: number
	alpha: Uint8ClampedArray
}

/** By asset record, which is replaced when the picture changes, so a new one is read again. */
const masks = new WeakMap<TLImageAsset, Mask | null | 'loading'>()

/** Whether the picture shows nothing at this point, in the shape's own space. */
export function isImageSeeThroughAt(editor: Editor, shape: TLImageShape, point: Vec2d): boolean {
	const asset = shape.props.assetId ? editor.getAsset(shape.props.assetId) : undefined
	if (asset?.type !== 'image' || asset.props.mimeType === 'image/jpeg') return false

	const mask = masks.get(asset)
	if (mask === undefined) {
		masks.set(asset, 'loading')
		readMask(editor, asset).then((read) => masks.set(asset, read))
		return false
	}
	if (!mask || mask === 'loading') return false

	// Shape space to the picture's: the crop is a window on the picture as shown (flipped or not).
	const { w, h, crop, flipX, flipY } = shape.props
	let u = point.x / w
	let v = point.y / h
	if (crop) {
		u = crop.topLeft.x + u * (crop.bottomRight.x - crop.topLeft.x)
		v = crop.topLeft.y + v * (crop.bottomRight.y - crop.topLeft.y)
	}
	if (flipX) u = 1 - u
	if (flipY) v = 1 - v
	const x = Math.min(mask.w - 1, Math.max(0, Math.floor(u * mask.w)))
	const y = Math.min(mask.h - 1, Math.max(0, Math.floor(v * mask.h)))
	return mask.alpha[y * mask.w + x]! < SEE_THROUGH
}

async function readMask(editor: Editor, asset: TLImageAsset): Promise<Mask | null> {
	try {
		const url = await editor.resolveAssetUrl(asset.id, { screenScale: 1 / 8 })
		if (!url) return null
		const image = new Image()
		if (!/^(data|blob):/.test(url)) image.crossOrigin = 'anonymous'
		image.src = url
		await image.decode()

		// An SVG without a size of its own has no natural one; the asset knows its proportions.
		const naturalW = image.naturalWidth || asset.props.w
		const naturalH = image.naturalHeight || asset.props.h
		const scale = Math.min(1, MASK_SIZE / Math.max(naturalW, naturalH))
		const w = Math.max(1, Math.round(naturalW * scale))
		const h = Math.max(1, Math.round(naturalH * scale))
		const canvas = document.createElement('canvas')
		canvas.width = w
		canvas.height = h
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) return null
		ctx.drawImage(image, 0, 0, w, h)
		const pixels = ctx.getImageData(0, 0, w, h).data
		const alpha = new Uint8ClampedArray(w * h)
		for (let i = 0; i < alpha.length; i++) alpha[i] = pixels[i * 4 + 3]!
		return { w, h, alpha }
	} catch {
		// Not readable (another origin, a broken file): solid, as it always was.
		return null
	}
}

/** For tests: a picture's alpha, as if it had been read. */
export function setImageMaskForTests(asset: TLImageAsset, mask: Mask | null) {
	masks.set(asset, mask)
}
