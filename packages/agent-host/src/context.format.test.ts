import { describe, expect, it } from 'vitest'
import { formatTurnContext } from './session.js'

/**
 * The block that starts every turn.
 *
 * It exists to stop the agent opening each conversation with two discovery calls, so what matters is
 * that it is unambiguous and short: the model has to be able to tell it from the user's words, and
 * every line in it is paid for on every message.
 */

describe('the turn context block', () => {
	it('says nothing at all when there is nothing to say', () => {
		// An older panel sends no context, and that turn should read exactly as it always did.
		expect(formatTurnContext(null)).toBe('')
	})

	it('names the board, which is what replaces an opening board.list', () => {
		expect(
			formatTurnContext({ boardId: 'b1', boardName: 'Home office shopping', selection: [] })
		).toBe('<lifeboard-context>\nboard: Home office shopping (b1)\n</lifeboard-context>')
	})

	it('says when no board is open rather than staying silent about it', () => {
		// Silence would read as "no context available", and the agent would go looking.
		expect(formatTurnContext({ boardId: null, boardName: null, selection: [] })).toContain(
			'board: none open'
		)
	})

	it('lists the selection with ids, so the next call needs no lookup', () => {
		const block = formatTurnContext({
			boardId: 'b1',
			boardName: 'Trip',
			selection: [
				{ id: 'shape:a', type: 'node.markdown', label: 'Reykjavik' },
				{ id: 'shape:b', type: 'text', label: '' },
			],
		})

		expect(block).toContain('selected:')
		expect(block).toContain('shape:a node.markdown — Reykjavik')
		// No trailing dash for a shape with nothing to call it.
		expect(block).toContain('shape:b text')
		expect(block).not.toContain('shape:b text —')
	})

	it('admits when the list was cut', () => {
		// A model shown three of thirty ids would otherwise reasonably conclude three is all there are.
		const block = formatTurnContext({
			boardId: 'b1',
			boardName: 'Trip',
			selection: [{ id: 'shape:a', type: 'text', label: 'One' }],
			selectionTotal: 30,
		})
		expect(block).toContain('selected (1 of 30)')
	})

	it('is one tagged block, so it cannot be mistaken for the user talking', () => {
		const block = formatTurnContext({ boardId: 'b1', boardName: 'Trip', selection: [] })
		expect(block.startsWith('<lifeboard-context>')).toBe(true)
		expect(block.endsWith('</lifeboard-context>')).toBe(true)
	})
})
