import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'

/**
 * Splits markdown into top-level blocks, for the live-preview editor: the block holding the caret is
 * shown as raw source, every other block is rendered.
 *
 * Boundaries come from **mdast node positions**, produced by the same parser (micromark + GFM) that
 * `react-markdown` renders with. That equivalence is the point: a hand-rolled line scanner would
 * eventually disagree with the renderer about where a fenced code block containing blank lines, or a
 * loose list, or a setext heading, begins and ends — and the caret would land in the wrong place.
 *
 * The other consequence is that editing is **byte-exact**. Whitespace *between* nodes belongs to no
 * block, so replacing a block is `source.slice(0, start) + next + source.slice(end)`: separators,
 * trailing spaces and line endings elsewhere in the document are never touched. `blocks.test.ts`
 * pins this as a property over a corpus of awkward documents.
 */
export interface Block {
	/** Byte offset of the block's first character in the source. */
	start: number
	/** Byte offset one past the block's last character. */
	end: number
	/** mdast node type — `paragraph`, `heading`, `list`, `code`, `blockquote`, `table`, … */
	type: string
	/** Heading depth (1–6) when `type === 'heading'`, else undefined. Drives editor typography. */
	depth?: number
}

/** A document with no blocks still needs one editable slot, or there is nowhere to type. */
const EMPTY_BLOCK: Block = { start: 0, end: 0, type: 'paragraph' }

export function splitBlocks(source: string): Block[] {
	if (source.length === 0) return [EMPTY_BLOCK]

	const tree = fromMarkdown(source, {
		extensions: [gfm()],
		mdastExtensions: [gfmFromMarkdown()],
	})

	const blocks: Block[] = []
	for (const node of tree.children) {
		const start = node.position?.start.offset
		const end = node.position?.end.offset
		if (start === undefined || end === undefined) continue
		blocks.push({
			start,
			end,
			type: node.type,
			...(node.type === 'heading' ? { depth: (node as { depth: number }).depth } : {}),
		})
	}

	// A source consisting only of whitespace parses to zero children.
	if (blocks.length === 0) return [{ start: 0, end: source.length, type: 'paragraph' }]

	/*
	 * Synthesise a trailing empty block when the source ends in a blank line.
	 *
	 * mdast only reports *content*, so an empty block at the end simply is not a node — which meant
	 * that pressing Enter at the end of a note produced a separator with nowhere to type: the caret
	 * fell back into the block it had just left. A blank line at the end is precisely the user saying
	 * "a new block goes here", so it gets one.
	 *
	 * Requiring two newlines matters: a file ending with a single `\n` is conventional and must not
	 * sprout a phantom block.
	 */
	const lastEnd = blocks[blocks.length - 1]!.end
	const tail = source.slice(lastEnd)
	if (countNewlines(tail) >= 2) {
		blocks.push({ start: source.length, end: source.length, type: 'paragraph' })
	}

	return blocks
}

function countNewlines(text: string): number {
	let count = 0
	for (const ch of text) if (ch === '\n') count++
	return count
}

/** The raw markdown of one block. */
export function blockText(source: string, block: Block): string {
	return source.slice(block.start, block.end)
}

/**
 * Replaces one block's text. Returns the new source and the offset delta, so a caret elsewhere in the
 * document can be adjusted without re-parsing.
 */
export function spliceBlock(
	source: string,
	block: Block,
	next: string
): { source: string; delta: number } {
	return {
		source: source.slice(0, block.start) + next + source.slice(block.end),
		delta: next.length - (block.end - block.start),
	}
}

/**
 * Splits a block at a caret offset *within that block*, producing two blocks separated by a blank
 * line. Used by Enter.
 */
export function splitBlockAt(
	source: string,
	block: Block,
	offsetInBlock: number
): { source: string; caret: number } {
	const absolute = block.start + offsetInBlock
	const before = source.slice(0, absolute)
	const after = source.slice(absolute)
	// The separator is what makes them two blocks rather than one with a line break in it.
	return { source: `${before}\n\n${after}`, caret: absolute + 2 }
}

/**
 * Merges a block into its predecessor, dropping the whitespace between them. Used by Backspace at
 * offset 0. Returns the caret position at the join, which is where the user expects to be left.
 */
export function mergeWithPrevious(
	source: string,
	blocks: Block[],
	index: number
): { source: string; caret: number } | null {
	if (index <= 0 || index >= blocks.length) return null
	const previous = blocks[index - 1]!
	const current = blocks[index]!
	return {
		source: source.slice(0, previous.end) + source.slice(current.start),
		caret: previous.end,
	}
}

/** Index of the block containing an absolute offset; clamped, never -1. */
export function blockIndexAtOffset(blocks: Block[], offset: number): number {
	for (let i = 0; i < blocks.length; i++) {
		const block = blocks[i]!
		// `<= end` so a caret resting at a block's end belongs to that block, not the next one.
		if (offset >= block.start && offset <= block.end) return i
		// The offset fell in the whitespace *between* blocks — attribute it to the preceding one.
		if (offset < block.start) return Math.max(0, i - 1)
	}
	return Math.max(0, blocks.length - 1)
}

/**
 * True when Enter should be handled natively rather than splitting the block — inside a list, a
 * blockquote or a fenced code block, a newline continues the construct instead of ending it.
 */
export function isMultiLineBlock(type: string): boolean {
	return type === 'list' || type === 'blockquote' || type === 'code' || type === 'table'
}
