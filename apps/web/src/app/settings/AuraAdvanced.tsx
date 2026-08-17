import { useValue } from 'tldraw'
import { auraOutlines } from '../../canvas/auraGeometry'
import { useAuraPhase } from '../../canvas/auraPhase'
import {
	AURA_RANGES,
	DEFAULT_AURA,
	getAuraPreset,
	resetAuraPreset,
	setAuraPreset,
	type AuraPreset,
} from '../../canvas/auraPreset'

/**
 * The tracing aura's look, as a slider per number.
 *
 * Behind a closed disclosure on purpose. These are not decisions anyone needs to make — the defaults
 * are settled — but they are the kind of thing that is impossible to settle *without* being able to
 * drag something and look, and a look that has to be described in prose converges slowly. So the
 * panel stays, out of the way, rather than being deleted and rebuilt the next time the aura is
 * revisited.
 *
 * The preview is what makes it usable here at all: Settings is a page of its own, so the canvas — and
 * with it the thing being tuned — is not on screen. It draws the real outline on the real clock, from
 * the same code the canvas uses, so what you see is the effect rather than an impression of it.
 */

const LABELS: Record<keyof AuraPreset, string> = {
	offset: 'Offset',
	wobble: 'Wobble',
	feature: 'Feature size',
	octaves: 'Detail',
	roughness: 'Roughness',
	warp: 'Warp',
	merge: 'Merge',
	drift: 'Drift speed',
	samplesPerFeature: 'Samples',
	stroke: 'Stroke',
	softness: 'Softness',
	ribbon: 'Relation ribbon',
	fill: 'Fill %',
}

const HINTS: Partial<Record<keyof AuraPreset, string>> = {
	offset: 'How far the outline sits from the shape.',
	wobble: 'How far it strays from that.',
	feature: 'Length of the biggest lobes. Lower is scribblier.',
	octaves: 'Bands of detail, each half the size of the last.',
	roughness: 'How much of each band survives into the next. No effect at one band.',
	warp: 'Bends the noise through itself — what makes shapes rather than roughness.',
	merge: 'How close two shapes have to be before their outlines join into one.',
	samplesPerFeature: 'Points drawn per lobe. The performance dial.',
	softness: 'Blur under the stroke. 0 is the crisp, drawn look.',
	ribbon: 'How far a traced relation pushes the outline out, on top of the offset.',
	fill: 'Opacity of the wash between the outline and the shape.',
}

const KEYS = Object.keys(DEFAULT_AURA) as (keyof AuraPreset)[]

/**
 * Two cards joined by a relation — the smallest scene that shows what every slider does.
 *
 * One card would leave `merge` and `ribbon` with nothing to demonstrate, which are the two hardest to
 * picture from a number.
 */
const PREVIEW = { w: 340, h: 150 }
const CARDS = [
	{ x: 40, y: 34, w: 96, h: 40, r: 10 },
	{ x: 214, y: 78, w: 96, h: 40, r: 10 },
]
const RELATION = { ax: 88, ay: 54, bx: 262, by: 98, r: 0 }

function AuraPreview({ preset }: { preset: AuraPreset }) {
	const phase = useAuraPhase(preset.drift > 0)
	const scene = {
		boxes: CARDS,
		capsules: [{ ...RELATION, r: preset.ribbon }],
	}
	return (
		<svg
			className="lb-aura-preview"
			viewBox={`0 0 ${PREVIEW.w} ${PREVIEW.h}`}
			role="img"
			aria-label="Preview of the tracing aura"
		>
			<path
				className="lb-aura-preview__outline"
				strokeWidth={preset.stroke}
				fillOpacity={preset.fill / 100}
				fillRule="evenodd"
				style={
					preset.softness > 0
						? { filter: `drop-shadow(0 0 ${preset.softness}px var(--lb-glow))` }
						: undefined
				}
				d={auraOutlines(scene, phase, 0.42, preset)}
			/>
			<line
				className="lb-aura-preview__relation"
				x1={RELATION.ax}
				y1={RELATION.ay}
				x2={RELATION.bx}
				y2={RELATION.by}
			/>
			{CARDS.map((card) => (
				<rect
					key={card.x}
					className="lb-aura-preview__card"
					x={card.x}
					y={card.y}
					width={card.w}
					height={card.h}
					rx={card.r}
				/>
			))}
		</svg>
	)
}

export function AuraAdvanced() {
	const preset = useValue('lb:aura-preset', () => getAuraPreset(), [])

	return (
		<details className="lb-advanced">
			<summary className="lb-advanced__summary">Advanced — tracing aura</summary>

			<div className="lb-advanced__body">
				<p className="lb-advanced__note">
					The outline drawn around a shape and its relations while the tracing lens is on. The
					defaults are settled; these are here for when they are not.
				</p>

				<AuraPreview preset={preset} />

				{KEYS.map((key) => {
					const range = AURA_RANGES[key]
					return (
						<label className="lb-advanced__row" key={key}>
							<span className="lb-advanced__label" title={HINTS[key] ?? ''}>
								{LABELS[key]}
							</span>
							<input
								className="lb-advanced__range"
								type="range"
								min={range.min}
								max={range.max}
								step={range.step}
								value={preset[key]}
								onChange={(e) => setAuraPreset({ [key]: Number(e.target.value) })}
							/>
							<span className="lb-advanced__value">{preset[key]}</span>
						</label>
					)
				})}

				<button className="lb-advanced__btn" onClick={() => resetAuraPreset()}>
					Reset to defaults
				</button>
			</div>
		</details>
	)
}
