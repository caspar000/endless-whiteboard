/**
 * Undo/redo *within* one editing session.
 *
 * This is not a nicety. A textarea's native undo stack belongs to its DOM element, and merging two
 * blocks destroys an element — so after any merge, ⌘Z would either do nothing or restore text into
 * the wrong block. Owning the stack is the price of the per-block architecture.
 *
 * Board-level undo is unaffected: the session still commits exactly one `updateShape` when editing
 * ends, so the canvas sees one entry. In-session undo is simply finer-grained than the board's, which
 * is what a text editor should feel like.
 */
export interface SessionSnapshot {
	source: string
	/** Absolute caret offset in the source, so undo restores where you were, not just what you had. */
	caret: number
}

export class SessionHistory {
	private entries: SessionSnapshot[]
	private cursor: number
	/**
	 * Whether the top entry came from a coalescing (typing) push, and may therefore be replaced by
	 * the next one. Without this flag a keystroke after a block split would overwrite the split
	 * itself, and undo would skip straight past a structural change as though it never happened.
	 */
	private topIsCoalescable = false

	constructor(initial: SessionSnapshot) {
		this.entries = [initial]
		this.cursor = 0
	}

	/**
	 * Records a state. `coalesce` is for keystroke-by-keystroke typing: consecutive coalescing pushes
	 * collapse into a single undo step, so ⌘Z undoes a burst of typing rather than one character.
	 */
	push(snapshot: SessionSnapshot, { coalesce = false } = {}): void {
		// Anything that was undone is now unreachable — standard redo-stack truncation.
		if (this.cursor < this.entries.length - 1) {
			this.entries = this.entries.slice(0, this.cursor + 1)
		}

		const top = this.entries[this.cursor]
		if (top && top.source === snapshot.source) {
			// Same text, maybe a new caret: keep the latest caret but don't add a step.
			this.entries[this.cursor] = snapshot
			return
		}

		if (coalesce && this.topIsCoalescable) {
			this.entries[this.cursor] = snapshot
			return
		}

		this.entries.push(snapshot)
		this.cursor = this.entries.length - 1
		this.topIsCoalescable = coalesce
	}

	undo(): SessionSnapshot | null {
		if (this.cursor <= 0) return null
		this.cursor--
		// Typing after an undo starts a fresh step rather than rewriting the state we landed on.
		this.topIsCoalescable = false
		return this.entries[this.cursor] ?? null
	}

	redo(): SessionSnapshot | null {
		if (this.cursor >= this.entries.length - 1) return null
		this.cursor++
		this.topIsCoalescable = false
		return this.entries[this.cursor] ?? null
	}

	get current(): SessionSnapshot {
		return this.entries[this.cursor]!
	}

	get canUndo(): boolean {
		return this.cursor > 0
	}

	get canRedo(): boolean {
		return this.cursor < this.entries.length - 1
	}
}
