import { describe, expect, it } from 'vitest'
import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	PageRecordType,
	type IndexKey,
	type TLPage,
	type TLStore,
} from '@lifeboard/canvas'
import { forgetUntouched, isUntouched, markUntouched, watchUntouchedBoard } from './untouchedBoards'

/** A record of the board's content, as a shape is: what it is doesn't matter to the watcher, only its scope. */
let pages = 0
const record = (): TLPage =>
	PageRecordType.create({ id: PageRecordType.createId(`p${++pages}`), name: 'Page', index: 'a1' as IndexKey })

/**
 * A board as it is once open: it has its page and document records, and they are behind it, as the
 * editor's are by the time the watcher starts.
 */
function store(): TLStore {
	const board = createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })
	board.put([record()])
	// Merging, even nothing, makes the store complete itself with the records every board has.
	board.mergeRemoteChanges(() => {})
	board._flushHistory()
	return board
}

/** Changes from elsewhere (another device, the server) reach the store as remote ones. */
const fromElsewhere = (store: TLStore, change: () => void) => store.mergeRemoteChanges(change)

/** Store listeners are called on the next flush, not inside the change. */
const settle = (store: TLStore) => store._flushHistory()

describe('untouched boards', () => {
	it('are only the boards marked so, until forgotten', () => {
		expect(isUntouched('a')).toBe(false)
		markUntouched('a')
		expect(isUntouched('a')).toBe(true)
		forgetUntouched('a')
		expect(isUntouched('a')).toBe(false)
	})

	it('stop being untouched at the first change to the content', () => {
		const board = store()
		markUntouched('b')
		const stop = watchUntouchedBoard({ store: board }, 'b')
		board.put([record()])
		settle(board)
		expect(isUntouched('b')).toBe(false)
		stop()
	})

	it('stay edited when the edit is taken back', () => {
		const board = store()
		markUntouched('c')
		const stop = watchUntouchedBoard({ store: board }, 'c')
		const page = record()
		board.put([page])
		board.remove([page.id])
		settle(board)
		expect(board.get(page.id)).toBeUndefined()
		expect(isUntouched('c')).toBe(false)
		stop()
	})

	it('are not edited by changes from elsewhere', () => {
		const board = store()
		markUntouched('d')
		const stop = watchUntouchedBoard({ store: board }, 'd')
		fromElsewhere(board, () => board.put([record()]))
		settle(board)
		expect(isUntouched('d')).toBe(true)
		stop()
		forgetUntouched('d')
	})

	it('leave a board never marked alone', () => {
		const board = store()
		const stop = watchUntouchedBoard({ store: board }, 'e')
		board.put([record()])
		settle(board)
		expect(isUntouched('e')).toBe(false)
		stop()
	})
})
