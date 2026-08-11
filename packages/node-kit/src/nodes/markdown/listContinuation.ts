/**
 * Auto-continuing list markers on Enter — what Notion, Obsidian and Craft all do.
 *
 * Without it, "Enter always inserts a newline" produces a subtly wrong document: a plain line typed
 * straight after a list item becomes a *lazy continuation* of that item in markdown, so it renders
 * indented under the bullet instead of standing on its own. Prefilling the marker means the common
 * case (another item) is right, and pressing Enter on an empty marker is how you leave the list.
 */
export interface Continuation {
	/** The whole prefix present on the current line — e.g. `"  - [x] "`. */
	prefix: string
	/** What the *next* line should start with — e.g. `"  - [ ] "`. Ordered lists increment. */
	next: string
}

const TASK = /^(\s*)([-*+])(\s+)\[[ xX]\](\s+)/
const ORDERED = /^(\s*)(\d+)([.)])(\s+)/
const BULLET = /^(\s*)([-*+])(\s+)/
const QUOTE = /^(\s*>\s?)/

/** The list/quote prefix of a line, and what should carry over to the next one. */
export function parseContinuation(text: string): Continuation | null {
	// Task before bullet: a task item starts with a bullet, so the bullet pattern would match first
	// and drop the checkbox.
	const task = TASK.exec(text)
	if (task) {
		const [prefix, indent, bullet, space, gap] = task
		// A new task always starts unchecked, even when continuing a completed one.
		return { prefix: prefix!, next: `${indent}${bullet}${space}[ ]${gap}` }
	}

	const ordered = ORDERED.exec(text)
	if (ordered) {
		const [prefix, indent, digits, delim, space] = ordered
		const nextNumber = Number.parseInt(digits!, 10) + 1
		return { prefix: prefix!, next: `${indent}${nextNumber}${delim}${space}` }
	}

	const bullet = BULLET.exec(text)
	if (bullet) return { prefix: bullet[0]!, next: bullet[0]! }

	const quote = QUOTE.exec(text)
	if (quote) return { prefix: quote[0]!, next: quote[0]! }

	return null
}

export type EnterOutcome =
	/** Insert a newline followed by `prefix` (possibly empty). */
	| { kind: 'insert'; text: string }
	/**
	 * Leave the list: replace the empty marker with a blank line.
	 *
	 * The blank line is the point. Merely stripping the marker leaves the following text separated
	 * from the list by a single newline, which markdown reads as a *lazy continuation* of the last
	 * item — so the text renders indented under the bullet, which is the exact bug auto-continuation
	 * was added to fix.
	 */
	| { kind: 'exitList'; prefixLength: number; insert: string }

/**
 * What Enter should do, given the line it is pressed on and where the caret sits within it.
 *
 * @param lineText the full text of the current line
 * @param caretInLine caret offset within that line
 */
export function decideEnter(lineText: string, caretInLine: number): EnterOutcome {
	const continuation = parseContinuation(lineText)
	if (!continuation) return { kind: 'insert', text: '\n' }

	const markerEnd = continuation.prefix.length

	// Caret inside or before the marker: the user is editing the marker itself, so treat Enter as a
	// plain break. Prefilling here would produce "- - item".
	if (caretInLine < markerEnd) return { kind: 'insert', text: '\n' }

	// An empty item — the marker with nothing after it — means "I'm done with this list".
	if (lineText.slice(markerEnd).trim() === '') {
		return { kind: 'exitList', prefixLength: markerEnd, insert: '\n' }
	}

	return { kind: 'insert', text: `\n${continuation.next}` }
}
