import type { Editor } from '@lifeboard/canvas'
import type { Command, CommandContext } from '@lifeboard/node-kit'
import { Shuffle } from 'lucide-react'
import { RANDOMIZER_TYPE } from './props'

/**
 * The keyboard way to shuffle. The animation lives in the card, so the command only asks: each card
 * listens here under its editor and its id, and the one asked runs exactly what its button runs.
 *
 * Keyed by editor first because a shape id is only unique within a board: a board restored as a copy
 * keeps its ids, and every open tab keeps its editor mounted, so two live cards can share an id. The
 * same reason `@lifeboard/zettelkasten`'s stack state is a `WeakMap<Editor, …>`.
 */
const shuffleListeners = new WeakMap<Editor, Map<string, () => void>>()

export function onShuffleRequest(editor: Editor, shapeId: string, run: () => void): () => void {
	let forEditor = shuffleListeners.get(editor)
	if (!forEditor) shuffleListeners.set(editor, (forEditor = new Map()))
	forEditor.set(shapeId, run)
	return () => {
		if (forEditor.get(shapeId) === run) forEditor.delete(shapeId)
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
			if (id && ctx.editor) shuffleListeners.get(ctx.editor)?.get(id)?.()
		},
	},
]
