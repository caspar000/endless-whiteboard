/**
 * The push pin on a sticky note, from Lifeboard's design (Figma, "Pin"): a needle, a wide head, a
 * neck with a shine, and a cap, each an ellipse or rectangle placed by an affine transform. The
 * transforms were rebuilt from the design's CSS (Figma gives each layer's bounding box), and the
 * result matches the design's export at 2× to 98% of its pixels.
 */
import { DefaultColorStyle, StyleProp, type TLDefaultColorTheme } from '@lifeboard/canvas-editor'
import type React from 'react'

/** The design's frame. The needle's tip, where the pin goes in, is at `PIN_TIP`. */
export const PIN_SIZE = { w: 129.6, h: 138.17 }
export const PIN_TIP = { x: 18.4, y: 125.2 }

const NEEDLE = '#C4C4C4'

/**
 * A pinned note's pin colour: the design's crimson, or any colour of the palette. A style, so the next
 * pinned note and a selection of them take it the way they take a colour.
 *
 * @public
 */
export const PinColorStyle = StyleProp.defineEnum('lifeboard:pinColor', {
	defaultValue: 'crimson',
	values: ['crimson', ...DefaultColorStyle.values],
})

/** @public */
export type PinColor = (typeof PinColorStyle)['defaultValue']

/** The two paints of a pin: its head, and the shine down its neck. */
export interface PinPaint {
	head: string
	shine: string
}

/** The design's own pin. */
const CRIMSON: PinPaint = { head: '#991B1B', shine: '#881414' }

/** A pin's paints in a colour: the palette's, with a shine a shade darker, as the design's has. */
export function getPinPaint(color: PinColor, theme: TLDefaultColorTheme): PinPaint {
	if (color === 'crimson') return CRIMSON
	const head = theme[color].solid
	return { head, shine: darken(head, 0.11) }
}

function darken(hex: string, amount: number): string {
	const n = parseInt(hex.slice(1, 7), 16)
	const channel = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount))
	return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, '0')).join('')}`
}

type Part = {
	kind: 'rect' | 'ellipse'
	w: number
	h: number
	fill: 'needle' | 'head' | 'shine'
	/** a b c d e f, as SVG's `matrix()`, about the part's centre. */
	matrix: [number, number, number, number, number, number]
}

const PARTS: Part[] = [
	{ kind: 'rect', w: 7.91, h: 38.37, fill: 'needle', matrix: [0.8, 0.6, -0.63, 0.77, 30.61, 110.15] },
	{ kind: 'ellipse', w: 7.97, h: 3.84, fill: 'needle', matrix: [0.81, 0.58, -0.62, 0.79, 18.42, 125.17] },
	{ kind: 'ellipse', w: 84.16, h: 57.7, fill: 'head', matrix: [0.76, 0.65, -0.65, 0.76, 50.75, 88.95] },
	{ kind: 'rect', w: 34.32, h: 42.07, fill: 'head', matrix: [0.76, 0.66, -0.66, 0.76, 70.95, 62.91] },
	{ kind: 'ellipse', w: 34.79, h: 17, fill: 'head', matrix: [0.8, 0.6, -0.6, 0.8, 58.02, 78.24] },
	{ kind: 'rect', w: 15.78, h: 45.29, fill: 'shine', matrix: [0.76, 0.66, -0.66, 0.76, 69.19, 68.27] },
	{ kind: 'ellipse', w: 16, h: 7.82, fill: 'shine', matrix: [0.8, 0.6, -0.6, 0.8, 54.75, 85.11] },
	{ kind: 'ellipse', w: 63.56, h: 48.12, fill: 'head', matrix: [0.76, 0.65, -0.65, 0.76, 89.8, 38.9] },
]

const geometry = ({ kind, w, h }: Part) =>
	kind === 'rect' ? { x: -w / 2, y: -h / 2, width: w, height: h } : { rx: w / 2, ry: h / 2 }

const paintOf = (part: Part, paint: PinPaint) => (part.fill === 'needle' ? NEEDLE : paint[part.fill])

/** The pin, `width` wide, as an `<svg>` for the canvas. */
export function NotePin({
	width,
	paint = CRIMSON,
	className,
	style,
}: {
	width: number
	paint?: PinPaint
	className?: string
	style?: React.CSSProperties
}) {
	return (
		<svg
			className={className}
			style={style}
			width={width}
			height={(width * PIN_SIZE.h) / PIN_SIZE.w}
			viewBox={`0 0 ${PIN_SIZE.w} ${PIN_SIZE.h}`}
			aria-hidden="true"
		>
			{PARTS.map((part, i) => {
				const props = { ...geometry(part), fill: paintOf(part, paint), transform: `matrix(${part.matrix.join(' ')})` }
				return part.kind === 'rect' ? <rect key={i} {...props} /> : <ellipse key={i} {...props} />
			})}
		</svg>
	)
}

/** The same pin as SVG elements, for export: a `<g>` in the design's units, to be placed by the caller. */
export function getNotePinSvg(paint: PinPaint = CRIMSON): SVGGElement {
	const g = document.createElementNS('http://www.w3.org/2000/svg', 'g')
	for (const part of PARTS) {
		const el = document.createElementNS('http://www.w3.org/2000/svg', part.kind)
		for (const [key, value] of Object.entries(geometry(part))) el.setAttribute(key, String(value))
		el.setAttribute('fill', paintOf(part, paint))
		el.setAttribute('transform', `matrix(${part.matrix.join(' ')})`)
		g.appendChild(el)
	}
	return g
}
