/**
 * Finding and toggling markdown task items in the source text.
 *
 * A checkbox in the rendered preview has to map back to a `[ ]` in the markdown, because the markdown is
 * the source of truth — there is no separate model to update. The mapping is **by position in document
 * order**: the Nth checkbox on screen is the Nth task item in the source.
 *
 * That correspondence is only safe if this scanner agrees with the parser about what a task item *is*,
 * which is why fenced code blocks are tracked here. A `- [ ] example` inside a fence renders as code with
 * no checkbox at all, so counting it would shift every checkbox after it onto the wrong line — clicking
 * one task would silently tick another.
 */

/** `- [ ] `, `* [x] `, `+ [X] ` with any indentation. The capture is the box's single character. */
const TASK = /^(\s*[-*+]\s+\[)([ xX])(\]\s)/

/** Only ``` and ~~~ fences; an indented code block cannot contain a list item at the top level. */
const FENCE = /^\s*(`{3,}|~{3,})/

export interface TaskItem {
	/** 0-based index of the source line the task sits on. */
	line: number
	checked: boolean
}

/**
 * Every task item in the source, in document order — which is the order the checkboxes render in.
 *
 * Deliberately returns *lines* rather than character offsets: a toggle rewrites one line, and a line
 * index survives edits elsewhere in the document in a way a byte offset does not.
 */
export function findTasks(md: string): TaskItem[] {
	const tasks: TaskItem[] = []
	let inFence = false
	let fence = ''

	md.split('\n').forEach((text, line) => {
		const fenceMatch = FENCE.exec(text)
		if (fenceMatch) {
			const marker = fenceMatch[1]!
			if (!inFence) {
				inFence = true
				fence = marker[0]!
			} else if (marker[0] === fence) {
				// A closing fence must use the same character as the opening one, so ``` doesn't close ~~~.
				inFence = false
			}
			return
		}
		if (inFence) return

		const task = TASK.exec(text)
		if (task) tasks.push({ line, checked: task[2] !== ' ' })
	})

	return tasks
}

/**
 * Flips the task at `index` (in document order) and returns the new source.
 *
 * Returns `null` when there is no such task, rather than the input unchanged: the caller is about to
 * write to a shape, and "nothing to do" should not cost an undo entry.
 */
export function toggleTaskAt(md: string, index: number): string | null {
	const task = findTasks(md)[index]
	if (!task) return null
	return setTaskOnLine(md, task.line, !task.checked)
}

/**
 * Toggles the task on a given source line, if there is one there.
 *
 * The editor's keyboard shortcut uses this: it knows which line the caret is on, so it needs no index.
 */
export function toggleTaskOnLine(md: string, line: number): string | null {
	const lines = md.split('\n')
	const text = lines[line]
	if (text === undefined) return null
	const task = TASK.exec(text)
	if (!task) return null
	return setTaskOnLine(md, line, task[2] === ' ')
}

function setTaskOnLine(md: string, line: number, checked: boolean): string | null {
	const lines = md.split('\n')
	const text = lines[line]
	if (text === undefined) return null
	const task = TASK.exec(text)
	if (!task) return null
	// Rebuilt from the captured parts so the item's indentation, bullet character and trailing spacing
	// all survive untouched — the box is the only thing that changes.
	lines[line] = task[1]! + (checked ? 'x' : ' ') + task[3]! + text.slice(task[0]!.length)
	return lines.join('\n')
}

/** Whether the line the caret sits on is a task item — drives the shortcut's availability. */
export function lineIsTask(lineText: string): boolean {
	return TASK.test(lineText)
}
