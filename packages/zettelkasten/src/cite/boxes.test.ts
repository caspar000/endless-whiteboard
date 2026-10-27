import { beforeEach, describe, expect, it } from 'vitest'
import { forgetBox, likelyBoxes, rememberBox } from './boxes'

const store = new Map<string, string>()
beforeEach(() => {
	store.clear()
	;(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem'> }).localStorage = {
		getItem: (key) => store.get(key) ?? null,
		setItem: (key, value) => void store.set(key, value),
	}
})

const board = (id: string, updatedAt: number, icon?: string) => ({ id, name: id, createdAt: 0, updatedAt, ...(icon ? { icon } : {}) })

describe('finding the boxes', () => {
	it('lists the boxes opened here and the boards with a box’s icon, newest first', () => {
		rememberBox('a')
		const boards = [board('a', 1), board('b', 3, 'cards'), board('c', 2), board('d', 4, 'star')]
		expect(likelyBoxes(boards).map((b) => b.id)).toEqual(['b', 'a'])
		forgetBox('a')
		expect(likelyBoxes(boards).map((b) => b.id)).toEqual(['b'])
	})
})
