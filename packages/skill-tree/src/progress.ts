import { atom, type Editor } from '@lifeboard/canvas'

/**
 * Work the board is busy with, for the note over it (tree/Working.tsx): an import, the whole-life
 * test board, a re-calculate. Each of those runs in a few steps, each step on the main thread, so the
 * note shows which step it is on, and its spinner turns on the compositor while a step blocks.
 */
export interface Work {
	/** The board it is on: only that one shows the note. */
	editor: Editor
	title: string
	step: string
	/** Steps finished before this one. */
	done: number
	total: number
}

const current = atom<Work | null>('lifeboard:skill-tree-work', null)

/** What `editor`'s board is busy with, if anything. */
export const getWork = (editor: Editor): Work | null => {
	const work = current.get()
	return work?.editor === editor ? work : null
}

/**
 * Lets the browser paint the note before a step blocks it: a frame, then a task. A tab with no frames
 * (a background tab, the preview browser) goes on after a short wait instead.
 */
const paint = () =>
	new Promise<void>((resolve) => {
		const fallback = setTimeout(resolve, 80)
		requestAnimationFrame(() =>
			setTimeout(() => {
				clearTimeout(fallback)
				resolve()
			}, 0)
		)
	})

/** Runs `fn`, which calls `step` before each of its `total` steps, with the note showing. */
export async function working<T>(editor: Editor, title: string, total: number, fn: (step: (label: string) => Promise<void>) => Promise<T>): Promise<T> {
	let done = -1
	let mine: Work | null = null
	const step = async (label: string) => {
		done = Math.min(done + 1, total - 1)
		mine = { editor, title, step: label, done, total }
		current.set(mine)
		await paint()
	}
	try {
		return await fn(step)
	} finally {
		// Another job may have put up its own note since: that one stays.
		if (current.get() === mine) current.set(null)
	}
}
