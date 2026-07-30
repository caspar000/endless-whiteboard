import { describe, expect, it } from 'vitest'
import {
	insertLineBreak,
	joinWithNext,
	joinWithPrevious,
	lineIndexAtOffset,
	lineStyle,
	splitLines,
	surroundingMarkdown,
} from './lines'

const CORPUS: Record<string, string> = {
	empty: '',
	oneLine: 'hello',
	twoLines: 'one\ntwo',
	trailingNewline: 'one\n',
	blankLineBetween: 'one\n\ntwo',
	heading: '# Title\nbody on the next line',
	list: '- one\n- two\n- three',
	fence: '```js\nconst a = 1\n```',
	manyBlanks: 'a\n\n\n\nb',
	leadingBlank: '\nstarts late',
}

describe('splitLines', () => {
	it.each(Object.entries(CORPUS))('round-trips %s exactly', (_name, source) => {
		const lines = splitLines(source)
		expect(lines.map((l) => source.slice(l.start, l.end)).join('\n')).toBe(source)
	})

	it('gives an empty document one line to type on', () => {
		expect(splitLines('')).toEqual([{ start: 0, end: 0 }])
	})

	it('gives a trailing newline a final empty line, so Enter at the end leaves somewhere to type', () => {
		expect(splitLines('one\n')).toEqual([
			{ start: 0, end: 3 },
			{ start: 4, end: 4 },
		])
	})

	it('treats a blank line as its own line', () => {
		expect(splitLines('a\n\nb')).toHaveLength(3)
	})
})

describe('lineIndexAtOffset', () => {
	const source = '# Title\nbody\ntail'
	const lines = splitLines(source)

	it('finds the line containing an offset', () => {
		expect(lineIndexAtOffset(lines, 0)).toBe(0)
		expect(lineIndexAtOffset(lines, 7)).toBe(0)
		expect(lineIndexAtOffset(lines, 8)).toBe(1)
		expect(lineIndexAtOffset(lines, source.length)).toBe(2)
	})

	it('clamps rather than returning -1', () => {
		expect(lineIndexAtOffset(lines, -3)).toBe(0)
		expect(lineIndexAtOffset(lines, 9999)).toBe(2)
	})
})

describe('surroundingMarkdown', () => {
	it('splits the document around the active line, losing nothing', () => {
		const source = '# Title\nbody\ntail'
		const lines = splitLines(source)
		const { before, after } = surroundingMarkdown(source, lines[1]!)
		expect(before).toBe('# Title\n')
		expect(after).toBe('\ntail')
		// before + active + after must reconstitute the source exactly.
		expect(before + source.slice(lines[1]!.start, lines[1]!.end) + after).toBe(source)
	})

	it('keeps a multi-line list on one side rather than fragmenting it', () => {
		// The point of slicing contiguously: the two rendered sides each stay a real list.
		const source = '- one\n- two\n- three'
		const lines = splitLines(source)
		const { before, after } = surroundingMarkdown(source, lines[1]!)
		expect(before).toBe('- one\n')
		expect(after).toBe('\n- three')
	})

	it('handles the first and last line', () => {
		const source = 'a\nb'
		const lines = splitLines(source)
		expect(surroundingMarkdown(source, lines[0]!)).toEqual({ before: '', after: '\nb' })
		expect(surroundingMarkdown(source, lines[1]!)).toEqual({ before: 'a\n', after: '' })
	})
})

describe('insertLineBreak — what Enter does, in every block type', () => {
	it('splits a line at the caret', () => {
		expect(insertLineBreak('hello world', 5)).toEqual({ source: 'hello\n world', caret: 6 })
	})

	it('appends an empty line at the end', () => {
		expect(insertLineBreak('done', 4)).toEqual({ source: 'done\n', caret: 5 })
	})

	it('works inside a list without ending the list', () => {
		// A single newline keeps the list intact — the new line is just another item to fill in.
		const { source } = insertLineBreak('- one', 5)
		expect(source).toBe('- one\n')
	})

	it('works inside a fenced code block', () => {
		const { source } = insertLineBreak('```js\ncode', 10)
		expect(source).toBe('```js\ncode\n')
	})
})

describe('joinWithPrevious — what Backspace at offset 0 does', () => {
	it('removes the newline and leaves the caret at the join', () => {
		const source = 'one\ntwo'
		expect(joinWithPrevious(source, splitLines(source), 1)).toEqual({
			source: 'onetwo',
			caret: 3,
		})
	})

	it('refuses on the first line', () => {
		const source = 'only'
		expect(joinWithPrevious(source, splitLines(source), 0)).toBeNull()
	})
})

describe('joinWithNext — what Delete at end-of-line does', () => {
	it('pulls the following line up', () => {
		const source = 'one\ntwo'
		expect(joinWithNext(source, splitLines(source), 0)).toEqual({ source: 'onetwo', caret: 3 })
	})

	it('refuses on the last line', () => {
		const source = 'one\ntwo'
		expect(joinWithNext(source, splitLines(source), 1)).toBeNull()
	})
})

describe('lineStyle — the raw line must occupy the rendered line’s space', () => {
	function styleOf(source: string, index: number) {
		const lines = splitLines(source)
		return lineStyle(source, lines[index]!)
	}

	it('detects heading levels', () => {
		expect(styleOf('# One', 0)).toEqual({ kind: 'heading', depth: 1 })
		expect(styleOf('### Three', 0)).toEqual({ kind: 'heading', depth: 3 })
		expect(styleOf('###### Six', 0)).toEqual({ kind: 'heading', depth: 6 })
	})

	it('is not fooled by a hash without a space, which is not a heading', () => {
		expect(styleOf('#hashtag', 0).kind).toBe('body')
	})

	it('treats lines inside a fence as code, which needs context beyond the line', () => {
		const source = '```js\nconst a = 1\n```\nafter'
		expect(styleOf(source, 0).kind).toBe('code') // the opening fence
		expect(styleOf(source, 1).kind).toBe('code') // inside
		expect(styleOf(source, 2).kind).toBe('code') // the closing fence
		expect(styleOf(source, 3).kind).toBe('body') // back outside
	})

	it('treats list items and prose as body', () => {
		expect(styleOf('- an item', 0).kind).toBe('body')
		expect(styleOf('just prose', 0).kind).toBe('body')
	})
})
