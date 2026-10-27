import type { BoardSummary } from '@lifeboard/node-kit'

/**
 * Which boards are boxes, as far as this device can tell without opening them.
 *
 * A box is marked in its own document (box.ts, `BOX_META`), so the board list, which loads no
 * content, can't say. Two hints instead: the boxes this device has opened (remembered here), and the
 * icon every box is given when it is made (extension.ts, `boardIcon`), which also covers boxes made on
 * another device. Opening one settles it either way.
 */

const KEY = 'lifeboard:zettel-boxes'
export const BOX_ICON = 'cards'

function read(): string[] {
	try {
		const value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
		return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
	} catch {
		return []
	}
}

function write(ids: readonly string[]): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(ids))
	} catch {
		// Private mode, or full: the icon is still a hint.
	}
}

export function rememberBox(boardId: string): void {
	const ids = read()
	if (!ids.includes(boardId)) write([...ids, boardId])
}

export function forgetBox(boardId: string): void {
	write(read().filter((id) => id !== boardId))
}

/** The boards that are, or look like, boxes: the most recently changed first. */
export function likelyBoxes(boards: readonly BoardSummary[]): BoardSummary[] {
	const known = new Set(read())
	return boards.filter((board) => known.has(board.id) || board.icon === BOX_ICON).sort((a, b) => b.updatedAt - a.updatedAt)
}
