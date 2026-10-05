import { createShapeId, type TLShape } from '@tldraw/tlschema'
import { expect, it } from 'vitest'
import { connect, documentOf, frame, newRoom, settle } from './test/harness.ts'

/** A small seeded generator, so a failing run can be replayed. */
function random(seed: number) {
	return () => {
		seed = (seed * 1664525 + 1013904223) % 4294967296
		return seed / 4294967296
	}
}

const NAMES = ['a', 'b', 'c', 'd', 'e']

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
	it(`three clients editing, with deliveries in any order and dropped connections, end up with the server's board (seed ${seed})`, async () => {
		const next = random(seed)
		const pick = <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)]!
		const room = newRoom()
		const peers = [connect(room), connect(room), connect(room)]
		await settle(...peers)

		for (let step = 0; step < 300; step++) {
			const peer = pick(peers)
			const name = pick(NAMES)
			const id = createShapeId(name)
			const existing = peer.store.get(id) as TLShape | undefined
			const roll = next()
			if (roll < 0.35) {
				if (existing) {
					const field = pick(['x', 'y', 'w', 'name'] as const)
					const value = Math.round(next() * 100) + 1
					peer.store.update(id, (shape) => {
						const props = (shape as TLShape & { props: Record<string, unknown> }).props
						if (field === 'x' || field === 'y') return { ...shape, [field]: value }
						return { ...shape, props: { ...props, [field]: field === 'name' ? `n${value}` : value } } as TLShape
					})
				} else {
					peer.store.put([frame(name)])
				}
			} else if (roll < 0.42 && existing) {
				peer.store.remove([id])
			} else if (roll < 0.6) {
				peer.store._flushHistory()
				await new Promise((resolve) => setTimeout(resolve, 0))
			} else if (roll < 0.75) {
				peer.socket.deliverToServer()
			} else if (roll < 0.93) {
				peer.socket.deliverToClient()
			} else if (roll < 0.97) {
				peer.socket.drop()
			} else {
				peer.socket.open()
			}
		}

		for (const peer of peers) peer.socket.open()
		await settle(...peers)
		await settle(...peers)
		const server = room.getSnapshot().store
		for (const peer of peers) {
			expect(peer.client.getStatus()).toEqual({ status: 'synced', online: true })
			expect(documentOf(peer)).toEqual(server)
		}
	})
}
