import { describe, expect, it } from 'vitest'
import { indentLine, toggleInline, toggleLinePrefix, type LineEdit } from './lineEdits'

const at = (text: string, selStart: number, selEnd = selStart): LineEdit => ({
	text,
	selStart,
	selEnd,
})

describe('indentLine', () => {
	it('nests a list item and keeps the caret on the same character', () => {
		expect(indentLine(at('- milk', 4), 1)).toEqual({ text: '  - milk', selStart: 6, selEnd: 6 })
	})

	it('outdents by one level', () => {
		expect(indentLine(at('    - milk', 8), -1)).toEqual({
			text: '  - milk',
			selStart: 6,
			selEnd: 6,
		})
	})

	it('indents a plain line too, so Tab always does something predictable', () => {
		expect(indentLine(at('prose', 0), 1)).toEqual({ text: '  prose', selStart: 2, selEnd: 2 })
	})

	it('returns null when there is nothing to outdent, so no undo entry is spent', () => {
		expect(indentLine(at('- milk', 2), -1)).toBeNull()
		expect(indentLine(at('', 0), -1)).toBeNull()
	})

	it('normalises odd indentation rather than refusing to outdent it', () => {
		// Markdown in the wild is indented inconsistently; leaving a line stuck is worse than tidying it.
		expect(indentLine(at('   - milk', 5), -1)).toEqual({ text: ' - milk', selStart: 3, selEnd: 3 })
		expect(indentLine(at('\t- milk', 3), -1)).toEqual({ text: '- milk', selStart: 2, selEnd: 2 })
	})

	it('moves a selection with the text', () => {
		expect(indentLine(at('- milk', 2, 6), 1)).toEqual({ text: '  - milk', selStart: 4, selEnd: 8 })
	})

	it('never pulls the selection below zero when outdenting', () => {
		expect(indentLine(at('  x', 0, 1), -1)).toEqual({ text: 'x', selStart: 0, selEnd: 0 })
	})
})

describe('toggleInline', () => {
	it('wraps a selection', () => {
		expect(toggleInline(at('make this bold', 5, 9), '**')).toEqual({
			text: 'make **this** bold',
			selStart: 7,
			selEnd: 11,
		})
	})

	it('unwraps when the selection is already wrapped, rather than nesting the markers', () => {
		// A version that only ever wrapped would give `****this****` on the second press.
		expect(toggleInline(at('make **this** bold', 5, 13), '**')).toEqual({
			text: 'make this bold',
			selStart: 5,
			selEnd: 9,
		})
	})

	it('unwraps when the markers sit just outside the selection', () => {
		expect(toggleInline(at('make **this** bold', 7, 11), '**')).toEqual({
			text: 'make this bold',
			selStart: 5,
			selEnd: 9,
		})
	})

	it('wraps the word under the caret when nothing is selected', () => {
		// What makes ⌘B usable without selecting first.
		expect(toggleInline(at('make this bold', 6), '**')).toEqual({
			text: 'make **this** bold',
			selStart: 7,
			selEnd: 11,
		})
	})

	it('inserts empty markers with the caret between them when there is no word', () => {
		expect(toggleInline(at('a ', 2), '**')).toEqual({ text: 'a ****', selStart: 4, selEnd: 4 })
	})

	it('works for italic and code, not just bold', () => {
		expect(toggleInline(at('x', 0, 1), '*').text).toBe('*x*')
		expect(toggleInline(at('x', 0, 1), '`').text).toBe('`x`')
		expect(toggleInline(at('*x*', 0, 3), '*').text).toBe('x')
	})

	it('does not mistake bold for italic when unwrapping', () => {
		// `*` is a prefix of `**`, so a careless check would strip one asterisk off a bold span and leave
		// the markdown malformed.
		expect(toggleInline(at('**x**', 2, 3), '*').text).toBe('***x***')
	})
})

describe('toggleLinePrefix', () => {
	it('makes a paragraph into a list item', () => {
		expect(toggleLinePrefix(at('milk', 4), '- ')).toEqual({
			text: '- milk',
			selStart: 6,
			selEnd: 6,
		})
	})

	it('removes the marker when it is already that kind', () => {
		expect(toggleLinePrefix(at('- milk', 6), '- ')).toEqual({
			text: 'milk',
			selStart: 4,
			selEnd: 4,
		})
	})

	it('swaps one kind of marker for another rather than nesting them', () => {
		expect(toggleLinePrefix(at('- milk', 6), '- [ ] ').text).toBe('- [ ] milk')
		expect(toggleLinePrefix(at('- [ ] milk', 10), '- ').text).toBe('- milk')
		expect(toggleLinePrefix(at('1. milk', 7), '- ').text).toBe('- milk')
	})

	it('keeps the line’s indentation, so nesting survives', () => {
		expect(toggleLinePrefix(at('  - milk', 8), '- [ ] ').text).toBe('  - [ ] milk')
	})

	it('never puts the caret before the marker', () => {
		expect(toggleLinePrefix(at('milk', 0), '- ').selStart).toBe(2)
	})
})
