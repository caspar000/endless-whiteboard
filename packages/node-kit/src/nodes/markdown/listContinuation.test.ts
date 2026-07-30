import { describe, expect, it } from 'vitest'
import { decideEnter, parseContinuation } from './listContinuation'

describe('parseContinuation', () => {
	it('carries a bullet over unchanged', () => {
		expect(parseContinuation('- item')).toEqual({ prefix: '- ', next: '- ' })
		expect(parseContinuation('* item')).toEqual({ prefix: '* ', next: '* ' })
		expect(parseContinuation('+ item')).toEqual({ prefix: '+ ', next: '+ ' })
	})

	it('increments an ordered list', () => {
		expect(parseContinuation('1. first')).toEqual({ prefix: '1. ', next: '2. ' })
		expect(parseContinuation('9. ninth')).toEqual({ prefix: '9. ', next: '10. ' })
		expect(parseContinuation('3) third')).toEqual({ prefix: '3) ', next: '4) ' })
	})

	it('starts a new task unchecked, even after a completed one', () => {
		expect(parseContinuation('- [ ] todo')).toEqual({ prefix: '- [ ] ', next: '- [ ] ' })
		expect(parseContinuation('- [x] done')).toEqual({ prefix: '- [x] ', next: '- [ ] ' })
		expect(parseContinuation('- [X] done')).toEqual({ prefix: '- [X] ', next: '- [ ] ' })
	})

	it('preserves indentation, so nested lists stay nested', () => {
		expect(parseContinuation('  - nested')).toEqual({ prefix: '  - ', next: '  - ' })
		expect(parseContinuation('    1. deep')).toEqual({ prefix: '    1. ', next: '    2. ' })
		expect(parseContinuation('  - [x] nested task')).toEqual({
			prefix: '  - [x] ',
			next: '  - [ ] ',
		})
	})

	it('carries a blockquote over', () => {
		expect(parseContinuation('> quoted')).toEqual({ prefix: '> ', next: '> ' })
	})

	it('returns null for prose, headings and code', () => {
		expect(parseContinuation('just prose')).toBeNull()
		expect(parseContinuation('# Heading')).toBeNull()
		expect(parseContinuation('```js')).toBeNull()
		// A hyphen with no space is not a list item.
		expect(parseContinuation('-not-a-list')).toBeNull()
		// Neither is a bare number.
		expect(parseContinuation('1984 was a year')).toBeNull()
	})
})

describe('decideEnter', () => {
	it('inserts a bare newline in prose', () => {
		expect(decideEnter('just prose', 10)).toEqual({ kind: 'insert', text: '\n' })
	})

	it('prefills the marker when continuing a list', () => {
		expect(decideEnter('- item', 6)).toEqual({ kind: 'insert', text: '\n- ' })
		expect(decideEnter('1. first', 8)).toEqual({ kind: 'insert', text: '\n2. ' })
		expect(decideEnter('- [x] done', 10)).toEqual({ kind: 'insert', text: '\n- [ ] ' })
		expect(decideEnter('  - nested', 10)).toEqual({ kind: 'insert', text: '\n  - ' })
	})

	it('leaves the list when Enter is pressed on an empty marker', () => {
		// The empty marker becomes a blank line, not merely deleted: without the blank line the next
		// paragraph is a lazy continuation of the last item and renders indented under it.
		expect(decideEnter('- ', 2)).toEqual({ kind: 'exitList', prefixLength: 2, insert: '\n' })
		expect(decideEnter('1. ', 3)).toEqual({ kind: 'exitList', prefixLength: 3, insert: '\n' })
		expect(decideEnter('- [ ] ', 6)).toEqual({ kind: 'exitList', prefixLength: 6, insert: '\n' })
		expect(decideEnter('  - ', 4)).toEqual({ kind: 'exitList', prefixLength: 4, insert: '\n' })
		expect(decideEnter('> ', 2)).toEqual({ kind: 'exitList', prefixLength: 2, insert: '\n' })
	})

	it('treats a marker followed by only whitespace as empty', () => {
		expect(decideEnter('-    ', 5).kind).toBe('exitList')
	})

	it('splits mid-item and carries the marker onto the remainder', () => {
		// "- one|two" → Enter → "- one" / "- two", which is what every list editor does.
		expect(decideEnter('- onetwo', 5)).toEqual({ kind: 'insert', text: '\n- ' })
	})

	it('inserts a plain newline when the caret is inside the marker', () => {
		// Prefilling here would produce "- - item".
		expect(decideEnter('- item', 0)).toEqual({ kind: 'insert', text: '\n' })
		expect(decideEnter('- item', 1)).toEqual({ kind: 'insert', text: '\n' })
		expect(decideEnter('1. first', 2)).toEqual({ kind: 'insert', text: '\n' })
	})
})
