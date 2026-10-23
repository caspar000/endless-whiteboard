import { Computed, computed, isUninitialized, RESET_VALUE } from '@tldraw/state'
import type { RecordsDiff } from '@tldraw/store'
import { isBinding, TLArrowBinding, TLRecord, TLShapeId, TLStore, TLUnknownBinding } from '@tldraw/tlschema'
import { Editor } from '../Editor'

const SHARDS = 256

function shardOf(key: string): number {
	let hash = 0
	for (let i = key.length - 1, end = Math.max(0, key.length - 8); i >= end; i--) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0
	}
	return hash & (SHARDS - 1)
}

/**
 * A lookup that copies a 256th of itself when it changes, where a `Map` copies all of it. Ids are
 * spread over 256 smaller maps by a hash; a change copies the list of them and the ones it touches.
 * Immutable, like a `Map` that is only ever copied: a previous value stays someone's answer.
 */
export class ShardedMap<K extends string, V> {
	private constructor(private readonly shards: readonly (ReadonlyMap<K, V> | undefined)[]) {}

	static empty<K extends string, V>(): ShardedMap<K, V> {
		return new ShardedMap<K, V>(new Array(SHARDS).fill(undefined))
	}

	get(key: K): V | undefined {
		return this.shards[shardOf(key)]?.get(key)
	}

	/** Applies `change` to a copy, copying only the shards it writes to. */
	with(change: (draft: { get(key: K): V | undefined; set(key: K, value: V): void; delete(key: K): void }) => void) {
		const shards = [...this.shards]
		const copied = new Set<number>()
		const writable = (key: K) => {
			const at = shardOf(key)
			if (!copied.has(at)) {
				copied.add(at)
				shards[at] = new Map(shards[at])
			}
			return shards[at] as Map<K, V>
		}
		change({
			get: (key) => shards[shardOf(key)]?.get(key),
			set: (key, value) => void writable(key).set(key, value),
			delete: (key) => void writable(key).delete(key),
		})
		// Unchanged stays the same value, so nothing that reads it is woken.
		return copied.size ? new ShardedMap<K, V>(shards) : this
	}
}

/**
 * A map derived from the board's binding records, kept up to date from the store's history rather
 * than rebuilt.
 *
 * Rebuilding walked every binding whenever one changed, which is fine for one edit and quadratic for
 * a batch that reads in between its writes. Deleting 2,000 bound shapes unbinds 4,000 arrow ends one
 * at a time, and each unbind reads where the arrow is attached: that took 12.7 seconds. Here only the
 * keys a changed binding touches are updated, in a {@link ShardedMap} that copies a 256th of itself.
 *
 * `add` and `remove` must return new values rather than change the ones they are given: the previous
 * map is still someone's answer. `remove` returns `undefined` to drop the key.
 */
export function bindingMap<K extends string, V>(
	store: TLStore,
	name: string,
	{
		include,
		keys,
		add,
		remove,
	}: {
		include: (binding: TLUnknownBinding) => boolean
		keys: (binding: TLUnknownBinding) => readonly K[]
		add: (entry: V | undefined, binding: TLUnknownBinding) => V
		remove: (entry: V, binding: TLUnknownBinding) => V | undefined
	}
): Computed<ShardedMap<K, V>> {
	const bindings = store.query.records('binding')

	type Draft = Parameters<Parameters<ShardedMap<K, V>['with']>[0]>[0]
	const added = (map: Draft, binding: TLUnknownBinding) => {
		if (!include(binding)) return
		for (const key of keys(binding)) map.set(key, add(map.get(key), binding))
	}
	const removed = (map: Draft, binding: TLUnknownBinding) => {
		if (!include(binding)) return
		for (const key of keys(binding)) {
			const entry = map.get(key)
			if (entry === undefined) continue
			const rest = remove(entry, binding)
			if (rest === undefined) map.delete(key)
			else map.set(key, rest)
		}
	}

	const fromScratch = () =>
		ShardedMap.empty<K, V>().with((map) => {
			for (const binding of bindings.get() as TLUnknownBinding[]) added(map, binding)
		})

	return computed<ShardedMap<K, V>>(name, (previous, lastComputedEpoch) => {
		if (isUninitialized(previous)) return fromScratch()
		const diff = store.history.getDiffSince(lastComputedEpoch)
		if (diff === RESET_VALUE) return fromScratch()
		if (!diff.some((changes) => touchesBindings(changes))) return previous

		return previous.with((map) => {
			for (const changes of diff) {
				for (const record of Object.values(changes.added)) {
					if (isBinding(record)) added(map, record as TLUnknownBinding)
				}
				for (const [from, to] of Object.values(changes.updated)) {
					if (!isBinding(to)) continue
					removed(map, from as TLUnknownBinding)
					added(map, to as TLUnknownBinding)
				}
				for (const record of Object.values(changes.removed)) {
					if (isBinding(record)) removed(map, record as TLUnknownBinding)
				}
			}
		})
	})
}

/** Whether a diff adds, changes or removes any binding. */
function touchesBindings(changes: RecordsDiff<TLRecord>): boolean {
	for (const record of Object.values(changes.added)) if (isBinding(record)) return true
	for (const [, to] of Object.values(changes.updated)) if (isBinding(to)) return true
	for (const record of Object.values(changes.removed)) if (isBinding(record)) return true
	return false
}

export type TLArrowBindingsIndex = ShardedMap<
	TLShapeId,
	{ arrowId: TLShapeId; handleId: 'start' | 'end' }[]
>

const isArrowBinding = (binding: TLUnknownBinding): binding is TLArrowBinding => binding.type === 'arrow'

/**
 * Which arrows are attached to each shape.
 *
 * In 2023 an arrow kept its connection in its own `start`/`end` props, and this walked every arrow.
 * Boards now store connections as `binding` records of type `arrow` (`fromId` the arrow, `toId` the
 * shape, `props.terminal` the end), so the index is built from those (docs/fork-parity.md D2).
 */
export const arrowBindingsIndex = (editor: Editor): Computed<TLArrowBindingsIndex> =>
	bindingMap(editor.store, 'arrowBindingsIndex', {
		include: isArrowBinding,
		keys: (binding) => [binding.toId],
		add: (entry, binding) => [
			...(entry ?? []),
			{ arrowId: binding.fromId, handleId: (binding as TLArrowBinding).props.terminal },
		],
		remove: (entry, binding) => {
			const { terminal } = (binding as TLArrowBinding).props
			const rest = entry.filter((e) => !(e.arrowId === binding.fromId && e.handleId === terminal))
			return rest.length ? rest : undefined
		},
	})

/** The bindings at an arrow's two ends. */
export interface TLArrowEnds {
	start?: TLArrowBinding
	end?: TLArrowBinding
}

export type TLArrowBindingsByArrow = ShardedMap<TLShapeId, TLArrowEnds>

/** The binding at each end of each arrow: the other direction of {@link arrowBindingsIndex}. */
export const arrowBindingsByArrow = (editor: Editor): Computed<TLArrowBindingsByArrow> =>
	bindingMap(editor.store, 'arrowBindingsByArrow', {
		include: isArrowBinding,
		keys: (binding) => [binding.fromId],
		add: (entry, binding) => ({ ...entry, [(binding as TLArrowBinding).props.terminal]: binding }),
		remove: (entry, binding) => {
			const { terminal } = (binding as TLArrowBinding).props
			if (entry[terminal]?.id !== binding.id) return entry
			const rest = { ...entry }
			delete rest[terminal]
			return rest.start || rest.end ? rest : undefined
		},
	})
