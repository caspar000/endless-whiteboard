import type { CSSProperties } from 'react'
import { OUTLINE_BOX, dieOutline } from './dieOutline'
import { facesOf, type DieKind } from './kinds'

/**
 * A die, as a projected wireframe with a number in the middle of it.
 *
 * Drawn here rather than taken from lucide, which has `Dice1`–`Dice6` and nothing polyhedral — there is
 * no icon set with a d10 in it. The geometry comes from `dieOutline`, which projects the *same* vertex
 * and face tables the rolling dice are built from, so an icon is a true picture of the die it stands
 * for and cannot drift from it.
 *
 * It replaced a set of flat silhouettes — a triangle, a square, a rhombus, a kite, a pentagon, a
 * hexagon. Legible, but they were not dice, and two of them were nearly the same shape: a d8 and a d10
 * are both "a diamond" in outline. The facets are what tell them apart.
 *
 * **One component for every surface** — the tray, the held-dice cursor, the palette, Settings, and the
 * result card — so a d20 is the same d20 wherever it appears. That is why the number is always dead
 * centre and always carries a halo: it has to stay readable over the creases, at 38px in the tray and
 * at 24px on a card, on a die of any colour.
 */

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
	const outline = dieOutline(kind)
	/*
	 * Below this the numeral is a smudge, so the wireframe stands alone.
	 *
	 * A d20 has twelve visible facets; adding two illegible digits and a halo on top of them at 15px made
	 * the palette's rows unreadable in both directions. Nothing is lost: at these sizes the icon sits
	 * beside a label that already says which die it is, and the shape alone distinguishes them — which is
	 * the whole reason for drawing the geometry rather than a silhouette.
	 */
	const NUMERAL_LEGIBLE_AT = 18
	const numeral = size >= NUMERAL_LEGIBLE_AT
	return (
		<svg
			className="lb-dice-icon"
			viewBox={`0 0 ${OUTLINE_BOX} ${OUTLINE_BOX}`}
			width={size}
			height={size}
			data-side={tone?.side}
			style={toneStyle(tone)}
			aria-hidden="true"
			focusable="false"
		>
			{/* Creases first, so the outer edge draws over the points where they meet it. */}
			<path className="lb-dice-icon__crease" d={outline.creases} />
			<path className="lb-dice-icon__rim" d={outline.silhouette} />
			{/*
			 * Dead centre, on both axes. For a die viewed down a face normal that is exactly where the front
			 * face's own middle projects to, so the number sits on the face it belongs to — and for the
			 * cube, seen from a corner, the centre is the only place it can go and still look deliberate.
			 */}
			{numeral && (
				<text x={OUTLINE_BOX / 2} y={OUTLINE_BOX / 2}>
					{label ?? (kind === 'd100' ? '%' : facesOf(kind))}
				</text>
			)}
		</svg>
	)
}
