import type { DieKind } from '../kinds'
import type { RolledDie } from '../roll'
import { rotateLabels } from './faces'
import { solidFor } from './solids'

/**
 * One die you can actually pick up, as opposed to one entry in a roll.
 *
 * Almost always the same thing — but not for the percentile die, which is where this abstraction earns
 * its keep. A `d100` result is a uniform 1–100 (`roll.ts`), and a pentagonal trapezohedron has ten
 * faces. Printing "37" on one of them would be a prop, not a die. So a d100 rolls the way it does on a
 * real table: **two ten-siders**, one marked in tens and one in units, read together. `00` and `0` is
 * the hundred, which is the convention that makes the tens die's high face its low one.
 *
 * Everything downstream — the mesh, the physics body, the textures — consumes this rather than a
 * `RolledDie`, so none of it needs to know that one of the seven dice is really two.
 */
export interface PhysicalDie {
	/** Which solid to build. The percentile die's two halves are both `d10` shapes. */
	solid: DieKind
	/** What is printed on each face, in face order. Already rotated so `wantedFace` is the result. */
	labels: readonly string[]
	/** The face that must finish upward. Set once the simulation has said where the die came to rest. */
	wantedFace: number
}

/** The natural markings of a solid: `1` to however many faces it has. */
function naturalLabels(solid: DieKind): string[] {
	return solidFor(solid).faces.map((_, i) => String(i + 1))
}

/** A percentile die's tens: `00`, `10` … `90`, in face order, with `00` first as on a real one. */
export const PERCENTILE_TENS: readonly string[] = Array.from({ length: 10 }, (_, i) =>
	i === 0 ? '00' : String(i * 10)
)

/** Its units: `0` to `9`. A separate ten-sider, as at a real table. */
export const PERCENTILE_UNITS: readonly string[] = Array.from({ length: 10 }, (_, i) => String(i))

/**
 * The dice that have to be thrown to show one rolled result, and which face each must land on.
 *
 * `settledFaces` is what the simulation reported — one entry per physical die, in the order this
 * function returns them — and is what the labels are rotated around. Called *after* the throw has been
 * simulated, which is the whole trick: physics picks an orientation, and then the die is renumbered so
 * the face it happens to be showing is the number that was drawn.
 */
export function physicalDiceFor(die: RolledDie, settledFaces: readonly number[]): PhysicalDie[] {
	if (die.kind !== 'd100') {
		const labels = naturalLabels(die.kind)
		return [
			{
				solid: die.kind,
				labels: rotateLabels(labels, settledFaces[0] ?? 0, die.value - 1),
				wantedFace: settledFaces[0] ?? 0,
			},
		]
	}

	// 1–100 split the way a table does it: 37 is "30" and "7"; 100 is "00" and "0".
	const units = die.value % 10
	const tens = (die.value - units) % 100
	const tensIndex = tens / 10
	return [
		{
			solid: 'd10',
			labels: rotateLabels(PERCENTILE_TENS, settledFaces[0] ?? 0, tensIndex),
			wantedFace: settledFaces[0] ?? 0,
		},
		{
			solid: 'd10',
			labels: rotateLabels(PERCENTILE_UNITS, settledFaces[1] ?? 0, units),
			wantedFace: settledFaces[1] ?? 0,
		},
	]
}

/** How many bodies one rolled die needs. Two only for the percentile die. */
export function bodyCount(kind: DieKind): number {
	return kind === 'd100' ? 2 : 1
}

/** Which solid each of a die's bodies uses, in order. */
export function bodySolids(kind: DieKind): DieKind[] {
	return kind === 'd100' ? ['d10', 'd10'] : [kind]
}

/** Every body a whole roll needs, flattened — what the stage actually creates. */
export function bodySolidsForRoll(dice: readonly RolledDie[]): DieKind[] {
	return dice.flatMap((die) => bodySolids(die.kind))
}
