import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A syllabus of thousands of items is sent to the server as its changes: a tick is one entry, not
 * megabytes. What goes whole, what goes as a change, and what a failed send leaves to the next.
 */

const sent: { how: 'whole' | 'change'; key: string; body: unknown }[] = []
let serverTakes = true
vi.mock('../server/serverVault', () => ({
	pushVaultSetting: (key: string, value: unknown) => {
		sent.push({ how: 'whole', key, body: value })
		return Promise.resolve(serverTakes)
	},
	patchVaultSetting: (key: string, change: unknown) => {
		sent.push({ how: 'change', key, body: change })
		return Promise.resolve(serverTakes)
	},
}))

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('sendChanges', () => {
	beforeEach(() => {
		sent.length = 0
		serverTakes = true
		vi.resetModules()
	})

	it('sends a store whole until the server has it, then only what changed', async () => {
		const { sendChanges } = await import('./skillIndex')
		const a = { itemId: 'a', done: false }
		const b = { itemId: 'b', done: false }
		sendChanges('syllabusItems', { a, b })
		await settle()
		expect(sent).toEqual([{ how: 'whole', key: 'syllabusItems', body: { a, b } }])

		const ticked = { ...a, done: true }
		sendChanges('syllabusItems', { a: ticked, b })
		await settle()
		expect(sent[1]).toEqual({ how: 'change', key: 'syllabusItems', body: { set: { a: ticked }, delete: [] } })

		sendChanges('syllabusItems', { a: ticked })
		await settle()
		expect(sent[2]).toEqual({ how: 'change', key: 'syllabusItems', body: { set: {}, delete: ['b'] } })

		// Nothing changed: nothing sent.
		sendChanges('syllabusItems', { a: ticked })
		await settle()
		expect(sent).toHaveLength(3)
	})

	it('sends again what the server did not take, with the next change', async () => {
		const { sendChanges } = await import('./skillIndex')
		const a = { itemId: 'a' }
		const b = { itemId: 'b' }
		sendChanges('syllabusTracks', { a })
		await settle()
		serverTakes = false
		sendChanges('syllabusTracks', { a, b })
		await settle()
		serverTakes = true
		const c = { itemId: 'c' }
		sendChanges('syllabusTracks', { a, b, c })
		await settle()
		expect(sent.map((s) => s.body)).toEqual([{ a }, { set: { b }, delete: [] }, { set: { b, c }, delete: [] }])
	})
})
