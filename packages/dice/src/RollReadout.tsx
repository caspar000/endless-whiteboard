import { useEffect, useState } from 'react'
import { useEditor, useValue } from 'tldraw'
import { DieIcon, toneFor } from './DieIcon'
import { clearRolls, type ActiveRoll } from './rolls'

/** How long the result is held at full strength before it starts to go. */
const HOLD_MS = 3_200
/** The fade itself. Must match `.lb-dice-readout`'s transition in the app's styles.css. */
const FADE_MS = 500

type Phase = 'live' | 'fading'

/**
 * What you rolled, where you rolled it.
 *
 * Positioned from a **page** point through the camera, so the readout stays on the spot you threw at
 * while you pan and zoom around it — the same treatment `AgentPresence` gives its rings, and the
 * reason the roll stores a page point rather than a screen one.
 *
 * Drawn at a fixed size rather than scaled by the camera: this is a label, and a label that becomes a
 * billboard at 400% zoom has stopped being one. (The dice themselves, when they arrive, do the
 * opposite — they are objects on the paper and scale with it.)
 */
export function RollReadout({ roll }: { roll: ActiveRoll }) {
	const editor = useEditor()
	const settlement = roll.settlement
	// The fade clock starts when the dice stop, not when they were thrown — otherwise a long tumble
	// would eat the time the number is legible for.
	const phase = useFade(settlement ? roll.seq : -roll.seq)
	// Re-read on every camera change, so this stays glued to the board through pans and zooms.
	useValue('lifeboard:dice-camera', () => editor.getCamera(), [editor])

	// Nothing to say until the dice have landed — see `RollSettlement`.
	if (!settlement) return null

	const at = editor.pageToViewport({ x: settlement.centreX, y: settlement.top })
	const { dice, modifier, total, notation } = roll.result
	// One die's face *is* the total, so a "= 4" beside a lone 4 is just the number twice — unless a
	// modifier has been added, in which case the sum is the whole point.
	const showTotal = dice.length > 1 || modifier !== 0

	return (
		<div
			className="lb-dice-readout"
			data-phase={phase}
			/*
			 * Anchored to the top of the settled dice and lifted clear of them by its own height, so the
			 * card describes the pile rather than covering it. Two translates rather than one: the first is
			 * in pixels from the camera, the second in percentages of the card.
			 */
			style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -118%)` }}
			role="status"
			aria-live="polite"
		>
			<div className="lb-dice-readout__notation">{notation}</div>
			<div className="lb-dice-readout__faces">
				{dice.map((die, index) => (
					// Index-keyed on purpose: two d6 that both came up 4 are two dice, and keying by
					// value would collapse them into one.
					<span className="lb-dice-readout__face" key={index}>
						<DieIcon
							kind={die.kind}
							size={26}
							label={String(die.value)}
							tone={toneFor(die.kind, die.value)}
						/>
					</span>
				))}
				{modifier !== 0 && (
					// Shown as a term of its own rather than folded silently into the total: “18 + 10 = 28” is
					// checkable, and “28” from a d20 is not.
					<span className="lb-dice-readout__modifier">
						{modifier < 0 ? '−' : '+'}
						{Math.abs(modifier)}
					</span>
				)}
			</div>
			{showTotal && (
				<div className="lb-dice-readout__total">
					<span className="lb-dice-readout__totallabel">Total</span>
					<span className="lb-dice-readout__totalvalue">{total}</span>
				</div>
			)}
		</div>
	)
}

/**
 * Ages one roll: shown, then fading, then gone.
 *
 * The middle state is what makes it fade at all — an element removed from the tree cannot transition,
 * so the readout has to outlive its own disappearance long enough to animate. Keyed on `seq`, so
 * throwing again restarts the clock instead of letting the previous roll's timer cut the new one off.
 */
function useFade(seq: number): Phase {
	const [phase, setPhase] = useState<Phase>('live')

	useEffect(() => {
		setPhase('live')
		const fade = setTimeout(() => setPhase('fading'), HOLD_MS)
		// Clearing the store is what unmounts this. Doing it from here rather than from the thrower
		// keeps the lifetime in one place: whoever throws a roll does not have to know how long it lives.
		const gone = setTimeout(() => clearRolls(), HOLD_MS + FADE_MS)
		return () => {
			clearTimeout(fade)
			clearTimeout(gone)
		}
	}, [seq])

	return phase
}
