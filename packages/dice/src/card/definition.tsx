import {
	createShapePropsMigrationSequence,
	type NodeDefinition,
} from '@lifeboard/node-kit'
import { Dices } from 'lucide-react'
import { T } from 'tldraw'
import { RollCard } from './RollCard'

export const ROLL_NODE_TYPE = 'node.roll'

export interface RollNodeProps {
	/** What was rolled, as written: `2d20 + 10`. */
	notation: string
	/** The dice and their faces, encoded `d20:14,d6:3` — see `encode.ts` for why it is a string. */
	faces: string
	/** The flat bonus, already included in `total`. */
	modifier: number
	/** The number you read off the roll: the faces plus the modifier. */
	total: number
	/** See registry.tsx: `h` tracks the rendered card until a vertical handle pins it. */
	autoHeight: boolean
}

export const ROLL_MIN_HEIGHT = 74

/**
 * A roll, kept.
 *
 * Off by default — a roll is a moment, and the tray's whole design is that throwing dice costs you
 * nothing to tidy up. This exists for the times you *are* keeping score, and it is what makes that
 * possible without a second feature: because it is a real node, its total is a property, so a table
 * can group and sum your rolls exactly like anything else on the board.
 *
 * Deliberately not editable. The card is a record of something that happened; a roll you can type a
 * different number into is not a record of anything. Re-roll instead.
 */
export const rollNodeDefinition: NodeDefinition<RollNodeProps> = {
	type: ROLL_NODE_TYPE,
	label: 'Roll',
	icon: '⚄',
	toolbarIcon: Dices,
	/*
	 * No `kbd`, and no dock button worth having: a roll card is *made by rolling*. The generated
	 * "Add roll" command still exists, as it does for every registered type, and produces an empty
	 * card — which is the honest consequence of the registry being uniform, and harmless.
	 */
	props: {
		notation: T.string,
		faces: T.string,
		modifier: T.number,
		total: T.number,
		autoHeight: T.boolean,
	},
	// Required from v1 even when empty (§7): the sequence has to exist before it has anything in it,
	// or the first props change has nowhere to hang a migration.
	migrations: createShapePropsMigrationSequence({ sequence: [] }),
	defaultProps: () => ({ notation: '', faces: '', modifier: 0, total: 0, autoHeight: true }),
	defaultSize: { w: 168, h: ROLL_MIN_HEIGHT },
	autoHeight: { minHeight: ROLL_MIN_HEIGHT },
	component: RollCard,
	// A readout, not a text surface — so its properties belong *under* the card, the way a book's do.
	strips: 'below',
	getLabel: (shape) => shape.props.notation || 'Roll',
}
