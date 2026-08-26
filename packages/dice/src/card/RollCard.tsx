import type { NodeComponentProps } from '@lifeboard/node-kit'
import { RollFaces, RollTotal } from '../RollFaces'
import { decodeDice } from './encode'
import type { RollNodeProps } from './definition'

/**
 * A kept roll, on the board.
 *
 * Laid out exactly like the readout it replaces (`RollFaces` is shared), because that is the whole
 * claim of the card: it is the roll you watched, still there. Nothing here is editable — see the
 * definition for why a record you can retype is not a record.
 *
 * No `<NodeStrips>`: the definition declares `strips: 'below'`, so the app draws its properties under
 * the card. Rendering them here as well would show them twice.
 */
export function RollCard({ shape }: NodeComponentProps<RollNodeProps>) {
	const { notation, faces, modifier, total } = shape.props
	const dice = decodeDice(faces)

	return (
		<div className="lb-roll-card">
			{/* An empty card is what "Add roll" from the palette produces — a real, if pointless, state. */}
			{dice.length === 0 ? (
				<span className="lb-roll-card__empty">No roll</span>
			) : (
				<>
					<div className="lb-dice-readout__notation">{notation}</div>
					<RollFaces dice={dice} modifier={modifier} size={24} />
					{(dice.length > 1 || modifier !== 0) && <RollTotal total={total} />}
				</>
			)}
		</div>
	)
}
