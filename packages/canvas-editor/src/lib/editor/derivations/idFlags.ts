import { atom, react, transact, type Atom } from '@tldraw/state'

/**
 * A yes/no answer per id, derived from one source, where a change wakes only the ids it flips.
 *
 * A signal reaches every reactor below it when it changes, whatever the computeds in between
 * return. So a per-shape reactor that asks `getEditingShapeId() === id` is visited on every write to
 * the page state, and through it on every write to the instance record (the brush, the cursor): one
 * visit per shape, thousands per pointer move on a big board.
 *
 * Here one reactor reads the source and each id has its own atom, set only when its answer changes.
 * A shape's reactor depends on its atom alone, so a brush move reaches the one reactor and stops.
 *
 * The atoms are updated when the transaction that changed the source settles, so read them for
 * rendering, not in the middle of a change that has to see its own effect.
 */
export class IdFlags<Id extends string> {
	private readonly atoms = new Map<Id, Atom<boolean>>()
	private current: ReadonlySet<Id> = new Set()
	readonly dispose: () => void

	constructor(
		private readonly name: string,
		source: () => Iterable<Id>
	) {
		this.dispose = react(name, () => {
			const next = new Set(source())
			const prev = this.current
			this.current = next
			transact(() => {
				for (const id of prev) if (!next.has(id)) this.atoms.get(id)?.set(false)
				for (const id of next) if (!prev.has(id)) this.atoms.get(id)?.set(true)
			})
		})
	}

	get(id: Id): boolean {
		let flag = this.atoms.get(id)
		if (!flag) {
			flag = atom(`${this.name}:${id}`, this.current.has(id))
			this.atoms.set(id, flag)
		}
		return flag.get()
	}
}

/**
 * A value per id, derived from one record of them, where a change wakes only the ids whose value
 * changed. The same idea as {@link IdFlags}, for values rather than yes/no.
 *
 * `syncedSource` is the source object the atoms were last brought in line with. A reader that needs
 * the answer mid-transaction, before the reactor has run, compares it with the source's current
 * value and reads the source directly when they differ.
 */
export class IdValues<Id extends string, V> {
	private readonly atoms = new Map<Id, Atom<V | undefined>>()
	private current: { get(id: Id): V | undefined } = new Map<Id, V>()
	syncedSource: unknown = undefined
	readonly dispose: () => void

	constructor(
		private readonly name: string,
		source: () => { get(id: Id): V | undefined },
		isEqual: (a: V | undefined, b: V | undefined) => boolean
	) {
		this.dispose = react(name, () => {
			const next = source()
			const prev = this.current
			this.current = next
			this.syncedSource = next
			transact(() => {
				for (const [id, value] of this.atoms) {
					if (!isEqual(prev.get(id), next.get(id))) value.set(next.get(id))
				}
			})
		})
	}

	get(id: Id): V | undefined {
		let value = this.atoms.get(id)
		if (!value) {
			value = atom(`${this.name}:${id}`, this.current.get(id))
			this.atoms.set(id, value)
		}
		return value.get()
	}
}
