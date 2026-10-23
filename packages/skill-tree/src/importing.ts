import type { Editor } from '@lifeboard/canvas'

/**
 * A bulk change in progress: an import or a confirm, thousands of shapes in one `editor.run`.
 *
 * While it runs, the item index and the tree sync (skillIndex.ts, treeSync.ts) hold off: reacting
 * to every one of a thousand creates made an import quadratic, and worse, saw an import's shapes
 * before the import had marked them as drafts, so a draft's nodes reached the vault at once. When
 * it ends, each catches up once with what the board now holds.
 */
let depth = 0
const listeners: ((editor: Editor) => void)[] = []

export const isImporting = (): boolean => depth > 0

/** Called once per finished bulk change, with the board it changed. */
export function onImportEnd(listener: (editor: Editor) => void): void {
	listeners.push(listener)
}

export function whileImporting<T>(editor: Editor, fn: () => T): T {
	const release = holdImport(editor)
	try {
		return fn()
	} finally {
		release()
	}
}

/**
 * The same across awaits, for a bulk change done in steps with a progress note between them
 * (progress.ts): nothing catches up until the returned release, so the board is laid out once, at
 * the end, rather than after every step.
 */
export function holdImport(editor: Editor): () => void {
	depth++
	let released = false
	return () => {
		if (released) return
		released = true
		depth--
		if (depth === 0) for (const listener of listeners) listener(editor)
	}
}
