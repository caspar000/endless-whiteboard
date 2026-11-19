import type { Editor } from '@lifeboard/canvas'
import type { CommandContext } from '@lifeboard/node-kit'
import { describe, expect, it, vi } from 'vitest'
import { SHUFFLE_COMMAND_ID, onShuffleRequest, randomizerCommands } from './commands'
import { RANDOMIZER_TYPE } from './props'

const shuffle = randomizerCommands.find((command) => command.id === SHUFFLE_COMMAND_ID)!

/** An editor with one shape selected: all the command reads of it. */
const editorSelecting = (shape: { id: string; type: string } | null) => ({ getOnlySelectedShape: () => shape }) as unknown as Editor

const ctx = (editor: Editor | null): CommandContext => ({ editor, view: 'board' })

describe('the shuffle command', () => {
	it('is offered only with exactly one randomizer selected, on a board', () => {
		expect(shuffle.when?.(ctx(editorSelecting({ id: 'shape:a', type: RANDOMIZER_TYPE })))).toBe(true)
		expect(shuffle.when?.(ctx(editorSelecting({ id: 'shape:a', type: 'node.markdown' })))).toBe(false)
		expect(shuffle.when?.(ctx(editorSelecting(null)))).toBe(false)
		expect(shuffle.when?.({ editor: editorSelecting({ id: 'shape:a', type: RANDOMIZER_TYPE }), view: 'help' })).toBe(false)
	})

	it('shuffles the card on the board it was invoked on when another open board has the same shape id', () => {
		// A board restored as a copy keeps its shape ids, and open tabs keep their editors mounted.
		const original = editorSelecting({ id: 'shape:same', type: RANDOMIZER_TYPE })
		const copy = editorSelecting({ id: 'shape:same', type: RANDOMIZER_TYPE })
		const onOriginal = vi.fn()
		const onCopy = vi.fn()
		const stopOriginal = onShuffleRequest(original, 'shape:same', onOriginal)
		const stopCopy = onShuffleRequest(copy, 'shape:same', onCopy)

		void shuffle.run(ctx(original))
		expect(onOriginal).toHaveBeenCalledTimes(1)
		expect(onCopy).not.toHaveBeenCalled()

		// Closing the copy leaves the original listening.
		stopCopy()
		void shuffle.run(ctx(original))
		expect(onOriginal).toHaveBeenCalledTimes(2)
		stopOriginal()
		void shuffle.run(ctx(original))
		expect(onOriginal).toHaveBeenCalledTimes(2)
	})
})
