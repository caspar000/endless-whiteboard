/**
 * How a note's paper is drawn, from Lifeboard's design (Figma, "Sticky Note" and "Pin"). Two kinds:
 *
 * - **A sticky note** (200 wide): flat paper with square corners, and a crease across the top, where
 *   the glued strip bends away from the board. The crease is darker, fading to 8% darker at its edge,
 *   and its edge bends twice: steeply from the left side to the middle, then gently to the right.
 * - **A pinned note** (300 wide): flat paper with no crease, held by a push pin (./pin.tsx) whose
 *   needle goes in just below the top edge.
 *
 * Both have a soft shadow under their lower part, as if the bottom lifts off the board.
 */
import { PIN_SIZE, PIN_TIP } from './pin'

export interface NotePaper {
	/** The paper's width, and its height before text makes it grow. */
	width: number
	crease: boolean
	pin: boolean
	/** Where the text area starts, from the top: below the pin, on a pinned note. */
	textTop: number
}

export const STICKY_PAPER: NotePaper = { width: 200, crease: true, pin: false, textTop: 0 }
/** The pin reaches 33 down a 300-wide note (`pinPlacement`); its text starts just under it. */
export const PINNED_PAPER: NotePaper = { width: 300, crease: false, pin: true, textTop: 30 }

/**
 * The crease's outline for a note `width` wide. Traced from the design (Figma export, its 5° tilt
 * taken out) in units of a 200-wide note: 42 deep at the left side, 21 at the middle, 18 at the right.
 */
export function creasePath(width: number): string {
	const k = width / 200
	const p = (n: number) => Math.round(n * k * 100) / 100
	return `M0 0H${p(200)}V${p(18)}C${p(170)} ${p(18.5)} ${p(140)} ${p(19.5)} ${p(110)} ${p(21)}C${p(80)} ${p(25)} ${p(35)} ${p(33)} 0 ${p(42)}Z`
}

/** The crease's height, for a note `width` wide. */
export const creaseHeight = (width: number) => (42 * width) / 200

/** How dark the crease gets at its edge, as a share of the paper's colour. */
const CREASE_SHADE = 0.92

/** The shadow's ellipse, as shares of the note, and the shadow itself. */
export const SHADOW = { left: 0.15, top: 0.28, width: 0.7, height: 0.66, offsetY: 30, blur: 50, opacity: 0.16 }

/** The pin: how wide, as a share of the note, and where its needle goes in. */
const PIN_SHARE = 0.22
const PIN_DEPTH = 26

/** Where the pin's top-left corner goes on a note `width` wide, and its scale from the design's size. */
export function pinPlacement(width: number) {
	const pinWidth = width * PIN_SHARE
	const scale = pinWidth / PIN_SIZE.w
	return { width: pinWidth, x: width / 2 - PIN_TIP.x * scale, y: PIN_DEPTH - PIN_TIP.y * scale, scale }
}

/** The crease's darker colour: `hex` (`#rrggbb`) darkened. */
export function creaseShade(hex: string): string {
	const match = /^#([0-9a-f]{6})$/i.exec(hex)
	if (!match) return hex
	const value = parseInt(match[1]!, 16)
	const channel = (shift: number) =>
		Math.round(((value >> shift) & 0xff) * CREASE_SHADE)
			.toString(16)
			.padStart(2, '0')
	return `#${channel(16)}${channel(8)}${channel(0)}`
}
