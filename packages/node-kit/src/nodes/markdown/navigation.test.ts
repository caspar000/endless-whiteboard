import { describe, expect, it } from 'vitest'
import { crossedLineEdge, decideNavigation, type KeyContext } from './navigation'

function ctx(over: Partial<KeyContext> = {}): KeyContext {
	return {
		key: 'a',
		mod: false,
		shift: false,
		composing: false,
		atLineStart: false,
		atLineEnd: false,
		index: 1,
		lineCount: 3,
		...over,
	}
}

describe('IME safety', () => {
	// The single easiest thing to get wrong: an IME uses Enter and the arrows to choose candidates.
	it('ignores every key while a composition is in progress', () => {
		for (const key of ['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'Escape']) {
			const action = decideNavigation(
				ctx({ key, composing: true, atLineStart: true, atLineEnd: true })
			)
			expect(action.kind).toBe('none')
		}
	})
})

describe('Enter always inserts a line break', () => {
	// The user asked for this explicitly: a new line "no matter what", with no split-vs-continue
	// behaviour that depends on what kind of block you happen to be in.
	it('does so mid-line, at the start, and at the end', () => {
		expect(decideNavigation(ctx({ key: 'Enter' })).kind).toBe('newline')
		expect(decideNavigation(ctx({ key: 'Enter', atLineStart: true })).kind).toBe('newline')
		expect(decideNavigation(ctx({ key: 'Enter', atLineEnd: true })).kind).toBe('newline')
	})

	it('does so on the first and last line alike', () => {
		expect(decideNavigation(ctx({ key: 'Enter', index: 0 })).kind).toBe('newline')
		expect(decideNavigation(ctx({ key: 'Enter', index: 2 })).kind).toBe('newline')
	})

	it('but ⌘/Ctrl+Enter finishes editing instead', () => {
		expect(decideNavigation(ctx({ key: 'Enter', mod: true })).kind).toBe('exit')
	})
})

describe('Backspace and Delete join lines', () => {
	it('joins backwards from the start of a line', () => {
		expect(decideNavigation(ctx({ key: 'Backspace', atLineStart: true })).kind).toBe('joinBack')
	})

	it('does nothing at the start of the first line', () => {
		expect(decideNavigation(ctx({ key: 'Backspace', atLineStart: true, index: 0 })).kind).toBe(
			'none'
		)
	})

	it('joins forwards from the end of a line', () => {
		expect(decideNavigation(ctx({ key: 'Delete', atLineEnd: true })).kind).toBe('joinForward')
	})

	it('does nothing at the end of the last line', () => {
		expect(decideNavigation(ctx({ key: 'Delete', atLineEnd: true, index: 2 })).kind).toBe('none')
	})

	it('deletes normally when there is a selection', () => {
		// `atLineStart`/`atLineEnd` are defined as "and nothing selected", so a selection simply never
		// reports the edge — the textarea handles the deletion itself.
		expect(decideNavigation(ctx({ key: 'Backspace' })).kind).toBe('none')
	})
})

describe('horizontal navigation crosses lines at the edges', () => {
	it('ArrowLeft at the start moves to the end of the previous line', () => {
		expect(decideNavigation(ctx({ key: 'ArrowLeft', atLineStart: true }))).toEqual({
			kind: 'focusLine',
			direction: -1,
			caret: 'end',
		})
	})

	it('ArrowRight at the end moves to the start of the next line', () => {
		expect(decideNavigation(ctx({ key: 'ArrowRight', atLineEnd: true }))).toEqual({
			kind: 'focusLine',
			direction: 1,
			caret: 'start',
		})
	})

	it('stays put mid-line', () => {
		expect(decideNavigation(ctx({ key: 'ArrowLeft' })).kind).toBe('none')
		expect(decideNavigation(ctx({ key: 'ArrowRight' })).kind).toBe('none')
	})
})

describe('vertical navigation defers to the browser first', () => {
	// A long line wraps, so whether the caret is on the first visual line needs measurement.
	// `maybeFocusLine` means "let the browser try, then check whether the caret actually moved".
	it('ArrowUp and ArrowDown ask to try then maybe move', () => {
		expect(decideNavigation(ctx({ key: 'ArrowUp' }))).toEqual({
			kind: 'maybeFocusLine',
			direction: -1,
			caret: 'end',
		})
		expect(decideNavigation(ctx({ key: 'ArrowDown' }))).toEqual({
			kind: 'maybeFocusLine',
			direction: 1,
			caret: 'start',
		})
	})

	it('does not try to leave the first or last line', () => {
		expect(decideNavigation(ctx({ key: 'ArrowUp', index: 0 })).kind).toBe('none')
		expect(decideNavigation(ctx({ key: 'ArrowDown', index: 2 })).kind).toBe('none')
	})
})

describe('session undo', () => {
	it('intercepts ⌘Z and ⌘⇧Z', () => {
		expect(decideNavigation(ctx({ key: 'z', mod: true })).kind).toBe('undo')
		expect(decideNavigation(ctx({ key: 'z', mod: true, shift: true })).kind).toBe('redo')
		// Capital Z arrives when shift is held on some layouts.
		expect(decideNavigation(ctx({ key: 'Z', mod: true, shift: true })).kind).toBe('redo')
	})

	it('leaves a bare z alone', () => {
		expect(decideNavigation(ctx({ key: 'z' })).kind).toBe('none')
	})
})

describe('Escape', () => {
	it('exits editing', () => {
		expect(decideNavigation(ctx({ key: 'Escape' })).kind).toBe('exit')
	})
})

describe('crossedLineEdge', () => {
	it('reports the edge for ArrowUp when the caret lands on offset 0', () => {
		// The bug this replaced: the old test was "did the caret fail to move?", but a single-row textarea
		// moves the caret to 0 on ArrowUp, so the first press appeared to do nothing and leaving a line
		// took two presses.
		expect(crossedLineEdge(-1, 0, 12)).toBe(true)
		expect(crossedLineEdge(-1, 5, 12)).toBe(false)
	})

	it('reports the edge for ArrowDown when the caret lands on the last offset', () => {
		expect(crossedLineEdge(1, 12, 12)).toBe(true)
		expect(crossedLineEdge(1, 5, 12)).toBe(false)
	})

	it('treats an empty line as being at both edges, so arrows never get stuck on it', () => {
		expect(crossedLineEdge(-1, 0, 0)).toBe(true)
		expect(crossedLineEdge(1, 0, 0)).toBe(true)
	})
})
