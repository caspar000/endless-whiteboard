import { atom } from '@lifeboard/canvas'

/**
 * Records an extension keeps outside any board, keyed by id, that the app saves to the vault: a
 * ranking, a backlog, the list of what was stamped (DARK-11). Every card on every board and device
 * reads the same ones. The same shape as Feeds' stores (`@lifeboard/feeds`' `store.ts`), which came
 * first.
 *
 * Writes are not on any board's undo stack: they are not a board's data.
 */
export interface KeyedStore<T> {
	get(): Readonly<Record<string, T>>
	/** One record, or `undefined`. Read through the atom, so a `useValue` follows it. */
	one(id: string): T | undefined
	/** Replaces everything, and saves it when anything changed. */
	set(next: Readonly<Record<string, T>>): void
	/** Writes one record (`null` deletes it), and saves. */
	put(id: string, value: T | null): void
	/** Loads a stored copy without saving it back, keeping only the records `read` accepts. */
	replace(raw: unknown): void
	/** Where a change is saved: the app's, set once at startup. */
	setPersistence(listener: ((value: Readonly<Record<string, T>>) => void) | null): void
}

/**
 * A store of records. `read` checks one stored record and returns it whole, or `null` to drop it:
 * these arrive from storage and from other devices, and what can't be read isn't trusted.
 */
export function keyedStore<T>(name: string, read: (raw: Record<string, unknown>) => T | null, idOf: (value: T) => string): KeyedStore<T> {
	const value = atom<Readonly<Record<string, T>>>(name, {})
	let persist: ((v: Readonly<Record<string, T>>) => void) | null = null
	const set = (next: Readonly<Record<string, T>>) => {
		if (JSON.stringify(next) === JSON.stringify(value.get())) return
		value.set(next)
		persist?.(next)
	}
	return {
		get: () => value.get(),
		one: (id) => value.get()[id],
		set,
		put(id, record) {
			const next = { ...value.get() }
			if (record === null) delete next[id]
			else next[id] = record
			set(next)
		},
		replace(raw) {
			const out: Record<string, T> = {}
			if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
				for (const entry of Object.values(raw as Record<string, unknown>)) {
					if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
					const record = read(entry as Record<string, unknown>)
					if (record) out[idOf(record)] = record
				}
			}
			value.set(out)
		},
		setPersistence(listener) {
			persist = listener
		},
	}
}
