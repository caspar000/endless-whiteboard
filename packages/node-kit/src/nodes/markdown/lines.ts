/**
 * The line model for live preview.
 *
 * The editing unit is a **source line**, not an mdast block — this is what Obsidian and AFFiNE do, and
 * it's the difference between "I have to start a new block before anything renders" and "the line I'm
 * on is raw, everything else is rendered". A heading renders the moment you leave its line, even if
 * the next line belongs to the same paragraph.
 *
 * Offsets, not strings, so editing stays byte-exact: everything is a slice of one source string, and
 * nothing outside the edited line is ever rewritten.
 */
export interface Line {
	/** Index of the line's first character. */
	start: number
	/** Index one past the line's last character — i.e. at the `\n`, or at `source.length`. */
	end: number
}

export function splitLines(source: string): Line[] {
	const lines: Line[] = []
	let start = 0
	for (let i = 0; i <= source.length; i++) {
		if (i === source.length || source[i] === '\n') {
			lines.push({ start, end: i })
			start = i + 1
		}
	}
	// A trailing `\n` yields a final empty line, which is correct: pressing Enter at the end of a note
	// has to leave you somewhere to type.
	return lines
}

/** Index of the line containing an absolute offset; clamped, never -1. */
export function lineIndexAtOffset(lines: Line[], offset: number): number {
	// Clamp below explicitly: falling through the loop would otherwise land a negative offset on the
	// *last* line, which is the opposite of what clamping should mean.
	if (offset <= 0) return 0
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!
		if (offset >= line.start && offset <= line.end) return i
	}
	return Math.max(0, lines.length - 1)
}

/**
 * The markdown rendered *above* and *below* the line being edited.
 *
 * Each side is a single contiguous slice rather than a per-line render, so multi-line constructs — a
 * list, a table, a blockquote — still render as one thing instead of dissolving into fragments. The
 * slices deliberately keep the newline adjacent to the active line; markdown ignores a leading or
 * trailing blank line, and keeping them means the two sides plus the active line reassemble to exactly
 * the original source.
 */
export function surroundingMarkdown(
	source: string,
	line: Line
): { before: string; after: string } {
	return { before: source.slice(0, line.start), after: source.slice(line.end) }
}

/** Insert a line break at an absolute offset. What Enter does — always, in every kind of block. */
export function insertLineBreak(source: string, offset: number): { source: string; caret: number } {
	return {
		source: `${source.slice(0, offset)}\n${source.slice(offset)}`,
		caret: offset + 1,
	}
}

/**
 * Join a line onto its predecessor by removing the newline between them. What Backspace at offset 0
 * does. The caret lands at the join, which is where the text the user was about to delete now sits.
 */
export function joinWithPrevious(
	source: string,
	lines: Line[],
	index: number
): { source: string; caret: number } | null {
	if (index <= 0 || index >= lines.length) return null
	const previous = lines[index - 1]!
	const current = lines[index]!
	return {
		source: source.slice(0, previous.end) + source.slice(current.start),
		caret: previous.end,
	}
}

/** Join the following line onto this one. What Delete at end-of-line does. */
export function joinWithNext(
	source: string,
	lines: Line[],
	index: number
): { source: string; caret: number } | null {
	if (index < 0 || index >= lines.length - 1) return null
	const current = lines[index]!
	const next = lines[index + 1]!
	return {
		source: source.slice(0, current.end) + source.slice(next.start),
		caret: current.end,
	}
}

/**
 * Typography for the line being edited, so the raw textarea occupies the same space as the rendered
 * line it replaces. Derived from the line itself where possible — a heading is a single line by
 * definition — and from the fence count for code, which needs context.
 */
export interface LineStyle {
	kind: 'heading' | 'code' | 'body'
	depth?: 1 | 2 | 3 | 4 | 5 | 6
}

export function lineStyle(source: string, line: Line): LineStyle {
	const text = source.slice(line.start, line.end)

	if (isInsideFence(source, line.start)) return { kind: 'code' }

	const heading = /^(#{1,6})\s/.exec(text)
	if (heading) return { kind: 'heading', depth: heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6 }

	// A fence delimiter itself reads as code, so toggling one doesn't make the line jump.
	if (/^\s*(```|~~~)/.test(text)) return { kind: 'code' }

	return { kind: 'body' }
}

/** Odd number of fence delimiters before this point means we're inside a fenced code block. */
function isInsideFence(source: string, offset: number): boolean {
	let fences = 0
	for (const raw of source.slice(0, offset).split('\n')) {
		if (/^\s*(```|~~~)/.test(raw)) fences++
	}
	return fences % 2 === 1
}
