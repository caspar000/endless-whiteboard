import type { CSSProperties } from 'react'
import { facesOf, type DieKind } from './kinds'

/**
 * A die, as a silhouette with a number in it.
 *
 * Drawn here rather than taken from lucide, which has `Dice1`–`Dice6` and nothing polyhedral — there
 * is no icon set with a d10 in it. The number inside is not decoration: a d8 and a d10 have nearly
 * the same outline at 20px, so the silhouette alone would make two of the seven buttons a guess.
 *
 * The d100 shares the d10's kite, because that is what it is — a second d10, read as tens — and gets
 * the percentile die's own marking instead of a number that would not fit.
 *
 * One component draws both the tray's face count *and* the rolled value (`label`), so "where the
 * number goes" is decided once. It used to be decided twice: the readout hid this text and floated an
 * HTML span over the icon instead, centred on the icon's bounding box rather than on the shape — which
 * is a different point for every die that is not symmetrical about its middle.
 */
const OUTLINES: Record<DieKind, string> = {
	d4: 'M12 3 L21.5 20 L2.5 20 Z',
	d6: 'M4.5 4.5 H19.5 V19.5 H4.5 Z',
	d8: 'M12 2.5 L21 12 L12 21.5 L3 12 Z',
	d10: 'M12 2.5 L20.5 10.5 L12 21.5 L3.5 10.5 Z',
	d12: 'M12 2.5 L21.4 9.3 L17.8 20.5 L6.2 20.5 L2.6 9.3 Z',
	d20: 'M12 2.5 L20.4 7.25 L20.4 16.75 L12 21.5 L3.6 16.75 L3.6 7.25 Z',
	d100: 'M12 2.5 L20.5 10.5 L12 21.5 L3.5 10.5 Z',
}

/**
 * Where the number sits in each outline — the shape's own middle, not the viewBox's.
 *
 * Only the square, the rhombus and the hexagon are symmetrical top-to-bottom, so only those three
 * centre at 12. The rest are computed from the path and then nudged for legibility rather than left
 * at the bare centroid:
 *
 *  - **d4** — a triangle's centroid (14.3) is not where a number looks centred, because the shape is
 *    still narrowing above it. The incircle's centre (14.4) is, and leaves the glyph inside the sides.
 *  - **d10 / d100** — the kite's centroid is 11.5; a touch lower sits the digits under its widest line
 *    (y=10.5) instead of straddling it, which is what makes room for two of them.
 *  - **d12** — a vertex-up regular pentagon with its apex at 2.5 and base at 20.5 has its centre at
 *    12.45, not 12.
 *
 * Paired with `dominant-baseline: central` in the stylesheet, which is what makes this a *centre* at
 * all: an SVG `<text>` y is otherwise the baseline, so every number here used to sit high by half a
 * glyph.
 */
const CENTRE: Record<DieKind, number> = {
	d4: 14.4,
	d6: 12,
	d8: 12,
	d10: 11.9,
	d12: 12.45,
	d20: 12,
	d100: 11.9,
}

/**
 * How far a rolled value leans toward the best or the worst the die could do.
 *
 * A gradient rather than two flags: on a d20, a 17 and a 20 are both good and only one of them is
 * remarkable, and a scheme that painted them identically would be throwing that away. `strength` is
 * how far from the middle the roll is, so the colour arrives in proportion to how much there is to say.
 *
 * The path goes red → *neutral* → blue rather than straight from red to blue. A direct interpolation
 * runs through a muddy mauve, so every middling roll would come out faintly purple and look like a
 * rendering fault; passing through the ordinary text colour means an ordinary roll looks ordinary,
 * which is the honest thing for it to look like.
 */
export interface DieTone {
	/** Which end it leans toward. */
	side: 'max' | 'min'
	/** `0` at the exact middle of the die, `1` at its highest or lowest face. */
	strength: number
}

/**
 * The lean of one face, or nothing for a die whose middle it sits exactly on.
 *
 * Read off the *die*, never off the number: 20 is the top of a d20 and the middle of nothing else, and
 * a 6 is a triumph on a d6 and a poor showing on a d20.
 */
export function toneFor(kind: DieKind, value: number): DieTone | undefined {
	const faces = facesOf(kind)
	if (faces < 2) return undefined
	// 0 at face 1, 1 at the highest face.
	const t = (value - 1) / (faces - 1)
	if (t === 0.5) return undefined
	return t > 0.5
		? { side: 'max', strength: (t - 0.5) * 2 }
		: { side: 'min', strength: (0.5 - t) * 2 }
}

/**
 * The tone, as something CSS can interpolate.
 *
 * A custom property rather than a computed colour, so the two ends stay `--lb-accent` and `--lb-danger`
 * — theme tokens — and the mixing happens in `color-mix(in oklab, …)` where it belongs. Handing back a
 * hex would have meant this module owning a palette, and a light-mode roll coming out in dark-mode
 * colours.
 */
function toneStyle(tone: DieTone | undefined): CSSProperties | undefined {
	if (!tone) return undefined
	return { '--lb-die-strength': tone.strength } as CSSProperties
}

export function DieIcon({
	kind,
	size = 22,
	/** Overrides the face count — the rolled value, on a result card. */
	label,
	tone,
}: {
	kind: DieKind
	size?: number
	label?: string
	tone?: DieTone
}) {
	return (
		<svg
			className="lb-dice-icon"
			viewBox="0 0 24 24"
			width={size}
			height={size}
			data-side={tone?.side}
			style={toneStyle(tone)}
			aria-hidden="true"
			focusable="false"
		>
			<path d={OUTLINES[kind]} />
			<text x="12" y={CENTRE[kind]}>
				{label ?? (kind === 'd100' ? '%' : facesOf(kind))}
			</text>
		</svg>
	)
}
