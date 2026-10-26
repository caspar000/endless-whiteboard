import type { BoardMeta } from './boardIndex'

/** Lower case, accents dropped: "Café" and "cafe" are the same word to someone searching. */
function fold(text: string): string {
	return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The boards whose names hold every word of the query, anywhere and in any order, so "plan trip"
 * finds "Trip planning". An empty query matches every board. The order of `boards` is kept.
 */
export function searchBoards<T extends Pick<BoardMeta, 'name'>>(boards: readonly T[], query: string): T[] {
	const words = fold(query).split(/\s+/).filter(Boolean)
	if (words.length === 0) return [...boards]
	return boards.filter((board) => {
		const name = fold(board.name)
		return words.every((word) => name.includes(word))
	})
}
