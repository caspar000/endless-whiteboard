/**
 * Drawing a page curl.
 *
 * The model is the one every implementation of this uses: the sheet is flat up to a vertical fold
 * line, and from there it wraps a cylinder lying against the page. A point at arc length `s` past
 * the fold has turned through `s / radius`, so it lands at `fold + radius · sin θ` — which is why
 * the paper appears to compress as it curves away, and why the far side of the roll comes back
 * over the near side.
 *
 * Two passes, because both halves of the roll project onto the same strip of screen and the near
 * one must win: everything up to a quarter turn is the printed side curving away, everything past
 * it is the blank underside curling back towards the reader.
 *
 * A cylinder about a *vertical* axis, deliberately — the corner-lift of a real page needs a cone
 * and a mesh, and at the speed a page turns nobody can tell. What they can tell is whether the
 * paper compresses and shades as it rolls, which this does.
 */
export interface CurlOptions {
	/** How tight the roll is, in page pixels. */
	radius: number
	/** Leaving by the right edge rather than the left — a turn going backwards. */
	back: boolean
	/** The colour of the back of the sheet. */
	paper: string
	/** Whether the roll darkens the page it uncovers. */
	shadow: boolean
	/** How far the fold leans off vertical, in degrees. */
	angle: number
}

/** Width of one strip of the roll, in page pixels. Small enough that the seams do not show. */
const STEP = 1.5

/**
 * Draws the sheet at `progress` (0 = flat, 1 = gone). Does not clear first — the caller owns that,
 * because the angled path below has to clear the whole board and then draw within a clip.
 *
 * Everything the sheet does not cover is left untouched, so the page underneath — the one being
 * turned to, which is a real element in the DOM — shows through it. The curl never has to know
 * what it is revealing.
 */
export function drawCurl(
	ctx: CanvasRenderingContext2D,
	texture: CanvasImageSource,
	textureWidth: number,
	textureHeight: number,
	width: number,
	height: number,
	progress: number,
	{ radius, back, paper, shadow }: CurlOptions
): void {
	const rollLength = Math.PI * radius
	const travel = width + rollLength
	/*
	 * Which way the sheet leaves, as *arithmetic* rather than as a flipped canvas.
	 *
	 * Mirroring the frame was the obvious way to write this and it is wrong twice over: it reflects
	 * what is printed on the sheet along with the geometry, and — once the fold is also leaning —
	 * a reflection between two rotations composes into a reflection about a slanted axis, which
	 * lands the page on screen rotated *and* backwards. Mirroring the numbers has neither problem.
	 */
	const dir = back ? -1 : 1
	const fold = back ? progress * travel : width - progress * travel
	const scaleX = textureWidth / width

	// The flat part: still lying on the page, still itself.
	const flatFrom = back ? clamp(fold, 0, width) : 0
	const flatTo = back ? width : clamp(fold, 0, width)
	if (flatTo - flatFrom > 0.5) {
		ctx.drawImage(
			texture,
			flatFrom * scaleX,
			0,
			(flatTo - flatFrom) * scaleX,
			textureHeight,
			flatFrom,
			0,
			flatTo - flatFrom,
			height
		)
	}

	// The shadow the roll throws onto the page it has uncovered.
	const edge = fold + dir * radius
	if (shadow && edge > -radius && edge < width + radius) {
		const span = radius * 1.2
		const gradient = ctx.createLinearGradient(edge, 0, edge + dir * span, 0)
		gradient.addColorStop(0, 'rgb(0 0 0 / 16%)')
		gradient.addColorStop(1, 'rgb(0 0 0 / 0%)')
		ctx.fillStyle = gradient
		ctx.fillRect(Math.min(edge, edge + dir * span), 0, span, height)
	}

	// The printed side, curving away from the reader.
	for (let s = 0; s < rollLength / 2; s += STEP) {
		const source = dir > 0 ? fold + s : fold - s - STEP
		if (source >= width || source + STEP <= 0) continue
		const turned = s / radius
		const x = fold + dir * radius * Math.sin(turned)
		const strip = STEP * Math.cos(turned) + 0.7
		const left = dir > 0 ? x : x - strip
		ctx.drawImage(
			texture,
			Math.max(0, source) * scaleX,
			0,
			STEP * scaleX,
			textureHeight,
			left,
			0,
			strip,
			height
		)
		// Darkening with the turn, so the roll reads as round rather than as a flat smear. Painted
		// only where the sheet already is, or it would band the empty corners of a leaning frame.
		ctx.save()
		ctx.globalCompositeOperation = 'source-atop'
		ctx.fillStyle = `rgb(0 0 0 / ${(0.22 * Math.sin(turned) * 100).toFixed(1)}%)`
		ctx.fillRect(left, 0, strip, height)
		ctx.restore()
	}

	// The underside, coming back over the top towards the reader — drawn second, because on a
	// cylinder it is the nearer surface.
	for (let s = rollLength / 2; s < rollLength; s += STEP) {
		const source = dir > 0 ? fold + s : fold - s
		if (source >= width || source <= 0) continue
		const turned = s / radius
		const x = fold + dir * radius * Math.sin(turned)
		const strip = Math.abs(STEP * Math.cos(turned)) + 0.7
		const left = dir > 0 ? x - strip : x
		// Paper, lit most where it faces the reader most directly.
		ctx.fillStyle = paper
		ctx.fillRect(left, 0, strip, height)
		const shade = 0.26 * (1 - Math.sin(turned))
		ctx.fillStyle = `rgb(0 0 0 / ${(shade * 100).toFixed(1)}%)`
		ctx.fillRect(left, 0, strip, height)
	}
}

/** The roll for a page of this width, from the setting's percentage. */
export function curlRadius(width: number, percent: number): number {
	return Math.max(12, (width * percent) / 100)
}

/**
 * Draws the sheet with the fold leaning, which is what a real page does.
 *
 * A page is not held at its edge — it is picked up by a corner, so the fold runs at a slant and the
 * far corner lifts first. Rather than solve a cone, this rolls the page in a *rotated* frame: the
 * picture is turned by the angle, curled about a vertical fold there, and turned back. Two pure
 * rotations, so the flat part of the sheet comes back exactly as it went in — the page is never
 * left sitting at an angle, only the fold across it is.
 *
 * The working canvases are the page's diagonal on a side, so nothing clips as it turns, and the
 * roll is drawn inside a clip of the page's own outline: without it the underside would paint paper
 * across the empty corners of the rotated frame.
 */
export function drawAngledCurl(
	ctx: CanvasRenderingContext2D,
	/** Two working canvases, both at least the page's diagonal on a side. Reused every frame. */
	straighten: CanvasRenderingContext2D,
	roll: CanvasRenderingContext2D,
	texture: CanvasImageSource,
	textureWidth: number,
	textureHeight: number,
	width: number,
	height: number,
	progress: number,
	options: CurlOptions
): void {
	const radians = (options.angle * Math.PI) / 180
	if (!radians) {
		ctx.clearRect(0, 0, width, height)
		drawCurl(ctx, texture, textureWidth, textureHeight, width, height, progress, options)
		return
	}

	const sin = Math.abs(Math.sin(radians))
	const cos = Math.abs(Math.cos(radians))
	// The page's bounding box once turned — the frame the roll has to happen in.
	const w = width * cos + height * sin
	const h = width * sin + height * cos

	// The page, straightened into the rotated frame.
	straighten.setTransform(1, 0, 0, 1, 0, 0)
	straighten.clearRect(0, 0, straighten.canvas.width, straighten.canvas.height)
	straighten.save()
	straighten.translate(w / 2, h / 2)
	straighten.rotate(-radians)
	straighten.drawImage(texture, -width / 2, -height / 2, width, height)
	straighten.restore()

	// Curled there, where the fold is vertical again, and only within the page's own outline.
	roll.setTransform(1, 0, 0, 1, 0, 0)
	roll.clearRect(0, 0, roll.canvas.width, roll.canvas.height)
	roll.save()
	roll.beginPath()
	roll.translate(w / 2, h / 2)
	roll.rotate(-radians)
	roll.rect(-width / 2, -height / 2, width, height)
	roll.setTransform(1, 0, 0, 1, 0, 0)
	roll.clip()
	drawCurl(roll, straighten.canvas, w, h, w, h, progress, options)
	roll.restore()

	// And turned back, cropped to the page by the canvas it is drawn onto.
	ctx.save()
	ctx.clearRect(0, 0, width, height)
	ctx.translate(width / 2, height / 2)
	ctx.rotate(radians)
	ctx.drawImage(roll.canvas, 0, 0, w, h, -w / 2, -h / 2, w, h)
	ctx.restore()
}

function clamp(value: number, low: number, high: number): number {
	return Math.min(high, Math.max(low, value))
}
