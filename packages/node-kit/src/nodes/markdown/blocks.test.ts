import { describe, expect, it } from 'vitest'
import {
	blockIndexAtOffset,
	blockText,
	isMultiLineBlock,
	mergeWithPrevious,
	spliceBlock,
	splitBlockAt,
	splitBlocks,
} from './blocks'

/**
 * A corpus of documents that a hand-rolled "split on blank lines" scanner gets wrong. Each one is a
 * case where block boundaries must agree with what the markdown renderer actually does.
 */
const CORPUS: Record<string, string> = {
	empty: '',
	whitespaceOnly: '   \n\n  \n',
	singleParagraph: 'just some prose',
	twoParagraphs: 'first para\n\nsecond para',
	headingAndProse: '# Title\n\nSome prose under it.',
	// The blank line inside the fence must NOT split the code block.
	fencedCodeWithBlankLines: '```js\nconst a = 1\n\nconst b = 2\n```\n\nafter the fence',
	// A "loose" list has blank lines between items but is still one list.
	looseList: '- one\n\n- two\n\n- three',
	tightList: '- one\n- two\n- three',
	orderedList: '1. first\n2. second',
	taskList: '- [ ] todo\n- [x] done',
	gfmTable: '| a | b |\n| - | - |\n| 1 | 2 |\n\nafter table',
	blockquote: '> quoted line one\n> quoted line two\n\nafter quote',
	// Setext headings are underlined, not prefixed — a line scanner reads them as two paragraphs.
	setextHeading: 'Underlined Title\n================\n\nbody',
	thematicBreak: 'above\n\n---\n\nbelow',
	crlf: 'first para\r\n\r\nsecond para',
	trailingWhitespace: 'para with trailing spaces   \n\nnext',
	manyBlankLines: 'a\n\n\n\n\nb',
	nestedList: '- outer\n  - inner\n  - inner two\n\nafter',
	indentedCode: '    indented code\n    more code\n\nafter',
	leadingBlankLines: '\n\n\nstarts late',
	emphasisAcrossLines: 'some *emphasis\nspanning lines* here',
}

describe('splitBlocks — byte-exact round trip', () => {
	// This is the guarantee the whole editor rests on: a block is a slice of the source, so
	// reassembling untouched blocks reproduces the source exactly, separators included.
	it.each(Object.entries(CORPUS))('reassembles %s unchanged', (_name, source) => {
		const blocks = splitBlocks(source)
		let out = ''
		let cursor = 0
		for (const block of blocks) {
			// Whitespace between blocks belongs to no block; it must be carried through verbatim.
			out += source.slice(cursor, block.start) + blockText(source, block)
			cursor = block.end
		}
		out += source.slice(cursor)
		expect(out).toBe(source)
	})

	it.each(Object.entries(CORPUS))('produces non-overlapping ascending blocks for %s', (_n, src) => {
		const blocks = splitBlocks(src)
		expect(blocks.length).toBeGreaterThan(0)
		let previousEnd = -1
		for (const block of blocks) {
			expect(block.start).toBeGreaterThanOrEqual(previousEnd)
			expect(block.end).toBeGreaterThanOrEqual(block.start)
			expect(block.end).toBeLessThanOrEqual(src.length)
			previousEnd = block.end
		}
	})
})

describe('splitBlocks — boundaries a line scanner would get wrong', () => {
	it('keeps a fenced code block whole despite the blank line inside it', () => {
		const blocks = splitBlocks(CORPUS.fencedCodeWithBlankLines!)
		expect(blocks).toHaveLength(2)
		expect(blocks[0]!.type).toBe('code')
		expect(blockText(CORPUS.fencedCodeWithBlankLines!, blocks[0]!)).toContain('const b = 2')
	})

	it('keeps a loose list as one block, not three paragraphs', () => {
		const blocks = splitBlocks(CORPUS.looseList!)
		expect(blocks).toHaveLength(1)
		expect(blocks[0]!.type).toBe('list')
	})

	it('reads a setext heading as one heading, not two paragraphs', () => {
		const blocks = splitBlocks(CORPUS.setextHeading!)
		expect(blocks[0]!.type).toBe('heading')
		expect(blocks[0]!.depth).toBe(1)
		expect(blocks).toHaveLength(2)
	})

	it('keeps a GFM table whole', () => {
		const blocks = splitBlocks(CORPUS.gfmTable!)
		expect(blocks[0]!.type).toBe('table')
		expect(blocks).toHaveLength(2)
	})

	it('records heading depth so the editor can match its typography', () => {
		const blocks = splitBlocks('# One\n\n### Three')
		expect(blocks.map((b) => b.depth)).toEqual([1, 3])
	})

	it('always yields at least one block, so there is somewhere to type', () => {
		expect(splitBlocks('')).toHaveLength(1)
		expect(splitBlocks('   \n\n  \n')).toHaveLength(1)
	})

	it('synthesises a trailing empty block after a blank line', () => {
		// mdast has no node for an empty block, so pressing Enter at the end of a note produced a
		// separator with nowhere to type — the caret fell back into the block it had just left.
		const blocks = splitBlocks('# Title\n\n')
		expect(blocks).toHaveLength(2)
		expect(blocks[1]).toEqual({ start: 9, end: 9, type: 'paragraph' })
	})

	it('does not sprout a phantom block for a conventional single trailing newline', () => {
		expect(splitBlocks('# Title\n')).toHaveLength(1)
	})
})

describe('spliceBlock', () => {
	it('replaces only that block and reports the offset delta', () => {
		const source = '# Title\n\nbody text'
		const blocks = splitBlocks(source)
		const result = spliceBlock(source, blocks[0]!, '# Longer title')
		expect(result.source).toBe('# Longer title\n\nbody text')
		expect(result.delta).toBe('# Longer title'.length - '# Title'.length)
	})

	it('leaves unusual separators between other blocks untouched', () => {
		const source = 'a\n\n\n\n\nb'
		const blocks = splitBlocks(source)
		expect(spliceBlock(source, blocks[1]!, 'B').source).toBe('a\n\n\n\n\nB')
	})
})

describe('splitBlockAt — what Enter does', () => {
	it('splits a paragraph at the caret into two blocks', () => {
		const source = 'hello world'
		const blocks = splitBlocks(source)
		const { source: next, caret } = splitBlockAt(source, blocks[0]!, 5)
		expect(next).toBe('hello\n\n world')
		expect(splitBlocks(next)).toHaveLength(2)
		// Caret lands at the start of the new block, not before the separator.
		expect(caret).toBe(7)
	})

	it('splitting at the end produces an empty trailing block to type into', () => {
		const source = '# Title'
		const blocks = splitBlocks(source)
		const { source: next } = splitBlockAt(source, blocks[0]!, source.length)
		expect(next).toBe('# Title\n\n')
	})
})

describe('mergeWithPrevious — what Backspace at offset 0 does', () => {
	it('joins two paragraphs and leaves the caret at the join', () => {
		const source = 'first\n\nsecond'
		const blocks = splitBlocks(source)
		const result = mergeWithPrevious(source, blocks, 1)!
		expect(result.source).toBe('firstsecond')
		expect(result.caret).toBe(5)
	})

	it('refuses to merge the first block', () => {
		const source = 'only'
		expect(mergeWithPrevious(source, splitBlocks(source), 0)).toBeNull()
	})
})

describe('blockIndexAtOffset', () => {
	const source = '# Title\n\nbody\n\ntail'
	const blocks = splitBlocks(source)

	it('finds the block containing an offset', () => {
		expect(blockIndexAtOffset(blocks, 2)).toBe(0)
		expect(blockIndexAtOffset(blocks, 10)).toBe(1)
		expect(blockIndexAtOffset(blocks, source.length)).toBe(2)
	})

	it('treats a caret resting at a block end as belonging to that block', () => {
		expect(blockIndexAtOffset(blocks, blocks[0]!.end)).toBe(0)
	})

	it('attributes an offset in the gap between blocks to the preceding one', () => {
		expect(blockIndexAtOffset(blocks, blocks[0]!.end + 1)).toBe(0)
	})

	it('clamps rather than returning -1', () => {
		expect(blockIndexAtOffset(blocks, -5)).toBe(0)
		expect(blockIndexAtOffset(blocks, 9999)).toBe(blocks.length - 1)
	})
})

describe('isMultiLineBlock', () => {
	it('lets Enter continue lists, quotes, code and tables natively', () => {
		expect(isMultiLineBlock('list')).toBe(true)
		expect(isMultiLineBlock('blockquote')).toBe(true)
		expect(isMultiLineBlock('code')).toBe(true)
		expect(isMultiLineBlock('table')).toBe(true)
	})

	it('splits paragraphs and headings instead', () => {
		expect(isMultiLineBlock('paragraph')).toBe(false)
		expect(isMultiLineBlock('heading')).toBe(false)
	})
})
