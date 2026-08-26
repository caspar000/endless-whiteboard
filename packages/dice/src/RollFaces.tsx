import { DieIcon, toneFor } from './DieIcon'
import type { RolledDie } from './roll'

/**
 * A roll's dice, as faces — shared by the ephemeral readout and the card it can leave behind.
 *
 * One component because they show the same thing and must not drift: the card exists to be the roll
 * you saw, and a card that laid the numbers out differently from the readout would read as a summary
 * of some other roll.
 */
export function RollFaces({
	dice,
	modifier,
	size = 26,
}: {
	dice: readonly RolledDie[]
	modifier: number
	size?: number
}) {
	return (
		<div className="lb-dice-readout__faces">
			{dice.map((die, index) => (
				// Index-keyed on purpose: two d6 that both came up 4 are two dice, and keying by value
				// would collapse them into one.
				<span className="lb-dice-readout__face" key={index}>
					<DieIcon
						kind={die.kind}
						size={size}
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
	)
}

/** The total, with its label. Also shared, for the same reason. */
export function RollTotal({ total }: { total: number }) {
	return (
		<div className="lb-dice-readout__total">
			<span className="lb-dice-readout__totallabel">Total</span>
			<span className="lb-dice-readout__totalvalue">{total}</span>
		</div>
	)
}
