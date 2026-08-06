/**
 * Background removal, without a model.
 *
 * A flood fill inward from the image's own edges: whatever colour the border is, everything connected
 * to it within a tolerance becomes transparent. That is the classic magic wand, and on the images that
 * actually land on a whiteboard — screenshots, logos, diagrams, product shots on white — it is as good
 * as a segmentation model and costs nothing to download.
 *
 * What it deliberately cannot do is a photo of a person against a room. Apple's Freeform lifts subjects
 * with an on-device neural net; nothing here pretends to compete with that. Connectivity from the
 * border is the whole idea: a white shirt in the middle of the picture survives because no path of
 * background-coloured pixels reaches it, and that is also why a busy background defeats it entirely.
 *
 * Kept as a pure function over pixels, with the canvas work confined to `removeImageBackground`, so the
 * maths is unit-testable without a DOM.
 */

/** Long edge above which we refuse: the fill is O(pixels) but the ImageData copy is the real cost. */
const MAX_EDGE = 4096

export interface RemoveBackgroundOptions {
	/**
	 * How far a pixel may differ from the sampled background and still count as background, 0–1.
	 *
	 * Omitted means "work it out from the image" — see `estimateTolerance`. A hand-set value is
	 * absolute, so a caller offering a slider gets predictable behaviour.
	 */
	tolerance?: number
}

export interface BackgroundMaskResult {
	/** Fraction of pixels that ended up fully or partly transparent, 0–1. */
	removed: number
}

/**
 * Perceptual-ish colour distance, normalised to 0–1.
 *
 * "Redmean" — a cheap weighted Euclidean that tracks human perception far better than raw RGB, which
 * matters here because the tolerance is a *perceptual* judgement. Proper CIEDE2000 would be better
 * still and about thirty times the arithmetic, for a difference invisible at these tolerances.
 */
function colourDistance(
	r1: number,
	g1: number,
	b1: number,
	r2: number,
	g2: number,
	b2: number
): number {
	const rmean = (r1 + r2) / 2
	const dr = r1 - r2
	const dg = g1 - g2
	const db = b1 - b2
	const d = Math.sqrt(
		(2 + rmean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rmean) / 256) * db * db
	)
	// The metric's maximum (black↔white) is ~765.
	return Math.min(1, d / 765)
}

/** Every pixel index on the outer ring, which is where the fill starts and what it samples. */
function borderIndices(width: number, height: number): number[] {
	const out: number[] = []
	for (let x = 0; x < width; x++) {
		out.push(x)
		out.push((height - 1) * width + x)
	}
	for (let y = 1; y < height - 1; y++) {
		out.push(y * width)
		out.push(y * width + width - 1)
	}
	return out
}

/**
 * The dominant border colour.
 *
 * The *mode* of a coarsely quantised histogram rather than the mean: averaging a border that is mostly
 * white but clips a dark object gives a grey that matches neither, and then the fill either does
 * nothing or eats the object. Quantising to 4 bits per channel makes "nearly the same white" one
 * bucket, which is what makes the mode stable on a photographed or JPEG-compressed background.
 */
export function sampleBorderColour(
	data: Uint8ClampedArray,
	width: number,
	height: number
): { r: number; g: number; b: number } {
	const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
	for (const i of borderIndices(width, height)) {
		const p = i * 4
		const r = data[p]!
		const g = data[p + 1]!
		const b = data[p + 2]!
		const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
		const bucket = buckets.get(key)
		if (bucket) {
			bucket.n++
			bucket.r += r
			bucket.g += g
			bucket.b += b
		} else {
			buckets.set(key, { n: 1, r, g, b })
		}
	}
	let best = { n: 0, r: 255, g: 255, b: 255 }
	for (const bucket of buckets.values()) if (bucket.n > best.n) best = bucket
	// The bucket's own mean, so the reference colour is exact rather than snapped to a 16-step grid.
	return { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n }
}

/**
 * A tolerance derived from how uniform the border actually is.
 *
 * A flat export needs almost none; a photographed backdrop with gradient and noise needs a lot. Using
 * the spread of the border against its own dominant colour means one click behaves sensibly on both,
 * which is what lets the feature ship with no slider.
 */
export function estimateTolerance(
	data: Uint8ClampedArray,
	width: number,
	height: number,
	bg: { r: number; g: number; b: number }
): number {
	const indices = borderIndices(width, height)
	const distances: number[] = []
	for (const i of indices) {
		const p = i * 4
		distances.push(colourDistance(data[p]!, data[p + 1]!, data[p + 2]!, bg.r, bg.g, bg.b))
	}
	distances.sort((a, b) => a - b)
	// The 90th percentile, not the max: a border that clips the subject has a few huge outliers, and
	// letting them set the tolerance is exactly how a fill runs away and eats the picture.
	const spread = distances[Math.floor(distances.length * 0.9)] ?? 0
	// The floor covers a perfectly flat background where the spread is 0 but antialiased edges still
	// need somewhere to ramp. The ceiling stops a busy border authorising a runaway fill.
	return Math.min(0.35, Math.max(0.08, spread * 2.5))
}

/**
 * Makes the background transparent, in place.
 *
 * Two thresholds rather than one, which is what produces a soft edge instead of a jagged one: the fill
 * *spreads* through anything within the outer threshold, and a pixel's alpha then ramps from fully
 * transparent below the inner threshold to fully opaque at the outer. Antialiased text and logo edges
 * come out feathered for free, with no blur pass.
 */
export function applyBackgroundMask(
	data: Uint8ClampedArray,
	width: number,
	height: number,
	options: RemoveBackgroundOptions = {}
): BackgroundMaskResult {
	const total = width * height
	if (total === 0) return { removed: 0 }

	const bg = sampleBorderColour(data, width, height)
	const tolerance = options.tolerance ?? estimateTolerance(data, width, height, bg)
	const inner = tolerance * 0.7
	const outer = tolerance * 1.3

	const distance = new Float32Array(total)
	for (let i = 0; i < total; i++) {
		const p = i * 4
		distance[i] = colourDistance(data[p]!, data[p + 1]!, data[p + 2]!, bg.r, bg.g, bg.b)
	}

	// Multi-source breadth-first fill from every border pixel that already looks like background.
	// An explicit stack, not recursion: a 2048² image is four million pixels and would blow the call
	// stack many times over.
	const reached = new Uint8Array(total)
	const stack = new Int32Array(total)
	let top = 0
	for (const i of borderIndices(width, height)) {
		if (distance[i]! <= outer && !reached[i]) {
			reached[i] = 1
			stack[top++] = i
		}
	}
	while (top > 0) {
		const i = stack[--top]!
		const x = i % width
		const y = (i / width) | 0
		// Four-connected: eight-connected leaks diagonally through antialiased hairlines, which on a
		// screenshot means the fill escapes through a 1px border and empties the whole image.
		if (x > 0) push(i - 1)
		if (x < width - 1) push(i + 1)
		if (y > 0) push(i - width)
		if (y < height - 1) push(i + width)
	}

	function push(j: number) {
		if (reached[j] || distance[j]! > outer) return
		reached[j] = 1
		stack[top++] = j
	}

	let removed = 0
	const span = Math.max(1e-6, outer - inner)
	for (let i = 0; i < total; i++) {
		if (!reached[i]) continue
		const d = distance[i]!
		// 0 at the inner threshold, 1 at the outer.
		const alpha = d <= inner ? 0 : Math.min(1, (d - inner) / span)
		const p = i * 4
		const previous = data[p + 3]!
		const next = Math.round(previous * alpha)
		if (next >= previous) continue
		removed += 1 - alpha

		if (next > 0) {
			// Defringe. A boundary pixel is a mix of subject and background; leaving it as-is keeps a
			// halo of the old background — the white outline that gives a bad cut-out away. Recovering
			// the subject's own colour is the inverse of that mix, clamped because the estimate goes
			// wild as alpha approaches zero.
			const a = next / 255
			for (let c = 0; c < 3; c++) {
				const observed = data[p + c]!
				const base = c === 0 ? bg.r : c === 1 ? bg.g : bg.b
				data[p + c] = Math.max(0, Math.min(255, (observed - base * (1 - a)) / a))
			}
		}
		data[p + 3] = next
	}

	return { removed: removed / total }
}

export interface RemoveBackgroundResult {
	blob: Blob
	/** Fraction of the image made transparent — lets the caller say "nothing to remove" honestly. */
	removed: number
}

/**
 * Runs the fill over an image blob and re-encodes it.
 *
 * WebP rather than PNG: it carries alpha, and a screenshot cut-out is several times smaller than the
 * lossless equivalent. Quality is higher than the import pipeline's because this runs on an image that
 * has already been re-encoded once, and stacking lossy passes shows.
 */
export async function removeImageBackground(
	source: Blob,
	options: RemoveBackgroundOptions = {}
): Promise<RemoveBackgroundResult> {
	const bitmap = await createImageBitmap(source)
	try {
		const { width, height } = bitmap
		if (width > MAX_EDGE || height > MAX_EDGE) {
			throw new Error(`Image is too large to process (${width}×${height})`)
		}
		const canvas = new OffscreenCanvas(width, height)
		// `willReadFrequently` because the very next thing we do is read every pixel back.
		const ctx = canvas.getContext('2d', { willReadFrequently: true })
		if (!ctx) throw new Error('Could not get a 2D context')
		ctx.drawImage(bitmap, 0, 0)

		const image = ctx.getImageData(0, 0, width, height)
		const { removed } = applyBackgroundMask(image.data, width, height, options)
		ctx.putImageData(image, 0, 0)

		const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.92 })
		return { blob, removed }
	} finally {
		bitmap.close()
	}
}
