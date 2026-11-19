import type { Command, CommandContext } from '@lifeboard/node-kit'
import { Shuffle } from 'lucide-react'
import { RANDOMIZER_TYPE } from './props'

/**
 * The keyboard way to shuffle. The animation lives in the card, so the command only asks: each card
 * listens for its own id here, and the one asked runs exactly what its button runs.
 */
const shuffleListeners = new Map<string, () => void>()

export function onShuffleRequest(shapeId: string, run: () => void): () => void {
	shuffleListeners.set(shapeId, run)
	return () => {
		if (shuffleListeners.get(shapeId) === run) shuffleListeners.delete(shapeId)
	}
}

export const SHUFFLE_COMMAND_ID = 'randomizer.shuffle'

function selectedRandomizer({ editor }: CommandContext): string | null {
	const shape = editor?.getOnlySelectedShape()
	return shape?.type === RANDOMIZER_TYPE ? shape.id : null
}

export const randomizerCommands: Command[] = [
	{
		id: SHUFFLE_COMMAND_ID,
		title: 'Shuffle the randomizer',
		group: 'Randomizer',
		icon: Shuffle,
		kbd: 'cmd+enter',
		when: (ctx) => ctx.view === 'board' && selectedRandomizer(ctx) !== null,
		run: (ctx) => {
			const id = selectedRandomizer(ctx)
			if (id) shuffleListeners.get(id)?.()
		},
	},
]
