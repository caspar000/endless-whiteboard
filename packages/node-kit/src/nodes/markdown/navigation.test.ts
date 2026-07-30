import { describe, expect, it } from 'vitest'
import { decideNavigation, type KeyContext } from './navigation'

function ctx(over: Partial<KeyContext> = {}): KeyContext {
	return {
		key: 'a',
		mod: false,
		shift: false,
		composing: false,
		blockType: 'paragraph',
		caret: 0,
		length: 10,
		hasSelection: false,
		index: 1,
		blockCount: 3,
		...over,
	}
}

describe('IME safety', () => {
	// The single easiest thing to get wrong: an IME uses Enter and the arrows to choose candidates.
	// Interpreting those as block navigation makes the editor unusable in Japanese, Chinese or Korean.
	it('ignores every key while a composition is in progress', () => {
		for (const key of ['Enter', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'Escape']) {
			expect(decideNavigation(ctx({ key, composing: true, caret: 0 })).kind).toBe('none')
		}
	})
})

describe('Enter', () => {
	it('splits a paragraph', () => {
		expect(decideNavigation(ctx({ key: 'Enter', caret: 4 })).kind).toBe('split')
	})

	it('splits a heading', () => {
		expect(decideNavigation(ctx({ key: 'Enter', blockType: 'heading' })).kind).toBe('split')
	})

	it('is left to the textarea inside a list, quote, fence or table', () => {
		// A newline there continues the construct — the block stays one block, which is what the
		// markdown actually means.
		for (const blockType of ['list', 'blockquote', 'code', 'table']) {
			expect(decideNavigation(ctx({ key: 'Enter', blockType })).kind).toBe('none')
		}
	})

	it('Shift+Enter inserts a line break rather than splitting', () => {
		expect(decideNavigation(ctx({ key: 'Enter', shift: true })).kind).toBe('none')
	})

	it('⌘/Ctrl+Enter finishes editing', () => {
		expect(decideNavigation(ctx({ key: 'Enter', mod: true })).kind).toBe('exit')
	})
})

describe('Backspace and Delete merge blocks', () => {
	it('merges backwards from offset 0', () => {
		expect(decideNavigation(ctx({ key: 'Backspace', caret: 0 })).kind).toBe('mergeBack')
	})

	it('does nothing at offset 0 of the first block', () => {
		expect(decideNavigation(ctx({ key: 'Backspace', caret: 0, index: 0 })).kind).toBe('none')
	})

	it('deletes the selection rather than merging', () => {
		expect(
			decideNavigation(ctx({ key: 'Backspace', caret: 0, hasSelection: true })).kind
		).toBe('none')
	})

	it('merges forwards from the end', () => {
		expect(decideNavigation(ctx({ key: 'Delete', caret: 10, length: 10 })).kind).toBe(
			'mergeForward'
		)
	})

	it('does nothing at the end of the last block', () => {
		expect(
			decideNavigation(ctx({ key: 'Delete', caret: 10, length: 10, index: 2 })).kind
		).toBe('none')
	})
})

describe('horizontal navigation crosses blocks at the edges', () => {
	it('ArrowLeft at offset 0 moves to the end of the previous block', () => {
		expect(decideNavigation(ctx({ key: 'ArrowLeft', caret: 0 }))).toEqual({
			kind: 'focusBlock',
			direction: -1,
			caret: 'end',
		})
	})

	it('ArrowRight at the end moves to the start of the next block', () => {
		expect(decideNavigation(ctx({ key: 'ArrowRight', caret: 10, length: 10 }))).toEqual({
			kind: 'focusBlock',
			direction: 1,
			caret: 'start',
		})
	})

	it('stays put mid-block', () => {
		expect(decideNavigation(ctx({ key: 'ArrowLeft', caret: 5 })).kind).toBe('none')
		expect(decideNavigation(ctx({ key: 'ArrowRight', caret: 5 })).kind).toBe('none')
	})
})

describe('vertical navigation defers to the browser first', () => {
	// Whether the caret is on the first *visual* line depends on wrapping, which we refuse to
	// compute. `maybeFocusBlock` means "let the browser try, then check if the caret moved".
	it('ArrowUp asks to try then maybe move', () => {
		expect(decideNavigation(ctx({ key: 'ArrowUp' }))).toEqual({
			kind: 'maybeFocusBlock',
			direction: -1,
			caret: 'end',
		})
	})

	it('ArrowDown asks to try then maybe move', () => {
		expect(decideNavigation(ctx({ key: 'ArrowDown' }))).toEqual({
			kind: 'maybeFocusBlock',
			direction: 1,
			caret: 'start',
		})
	})

	it('does not try to leave the first or last block', () => {
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
