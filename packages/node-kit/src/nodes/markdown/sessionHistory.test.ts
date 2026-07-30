import { describe, expect, it } from 'vitest'
import { SessionHistory } from './sessionHistory'

describe('SessionHistory', () => {
	it('starts with nothing to undo or redo', () => {
		const history = new SessionHistory({ source: 'a', caret: 0 })
		expect(history.canUndo).toBe(false)
		expect(history.canRedo).toBe(false)
		expect(history.undo()).toBeNull()
		expect(history.redo()).toBeNull()
	})

	it('walks back and forward through states, restoring the caret too', () => {
		const history = new SessionHistory({ source: 'a', caret: 1 })
		history.push({ source: 'ab', caret: 2 })
		history.push({ source: 'abc', caret: 3 })

		expect(history.undo()).toEqual({ source: 'ab', caret: 2 })
		expect(history.undo()).toEqual({ source: 'a', caret: 1 })
		expect(history.undo()).toBeNull()
		expect(history.redo()).toEqual({ source: 'ab', caret: 2 })
		expect(history.redo()).toEqual({ source: 'abc', caret: 3 })
		expect(history.redo()).toBeNull()
	})

	it('collapses a burst of typing into one step when coalescing', () => {
		// Every keystroke coalesces — that is what the editor does.
		const history = new SessionHistory({ source: '', caret: 0 })
		history.push({ source: 'h', caret: 1 }, { coalesce: true })
		history.push({ source: 'he', caret: 2 }, { coalesce: true })
		history.push({ source: 'hel', caret: 3 }, { coalesce: true })
		history.push({ source: 'hell', caret: 4 }, { coalesce: true })

		// One undo returns to the state before the burst, not four keystrokes back.
		expect(history.undo()).toEqual({ source: '', caret: 0 })
	})

	it('keeps structural edits as their own steps even between typing bursts', () => {
		const history = new SessionHistory({ source: 'a', caret: 1 })
		history.push({ source: 'ab', caret: 2 }, { coalesce: true })
		history.push({ source: 'ab\n\n', caret: 4 }) // a block split — not coalesced
		history.push({ source: 'ab\n\nc', caret: 5 }, { coalesce: true })

		expect(history.undo()).toEqual({ source: 'ab\n\n', caret: 4 })
		expect(history.undo()).toEqual({ source: 'ab', caret: 2 })
	})

	it('truncates the redo stack once you type after undoing', () => {
		const history = new SessionHistory({ source: 'a', caret: 1 })
		history.push({ source: 'ab', caret: 2 })
		history.push({ source: 'abc', caret: 3 })
		history.undo()
		history.push({ source: 'abX', caret: 3 })

		expect(history.canRedo).toBe(false)
		// Back to the state you were looking at when you typed, not two steps back.
		expect(history.undo()).toEqual({ source: 'ab', caret: 2 })
	})

	it('does not add a step when only the caret moved', () => {
		const history = new SessionHistory({ source: 'abc', caret: 0 })
		history.push({ source: 'abc', caret: 3 })
		expect(history.canUndo).toBe(false)
		// …but it does remember the newer caret for the next real edit.
		expect(history.current).toEqual({ source: 'abc', caret: 3 })
	})
})
