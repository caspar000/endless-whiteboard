import { createMigrationIds, createMigrationSequence } from '@tldraw/store'
import type { MigrationSequence } from '@tldraw/store'

interface LooseRecord {
	id?: unknown
	typeName?: unknown
	type?: unknown
	parentId?: unknown
	fromId?: unknown
	toId?: unknown
}

/**
 * A store migration that deletes every shape whose type `retired` matches, along with anything
 * parented to one and every binding that points at one: how a node type leaves the build. An
 * unregistered shape type is a *validation* failure, so a board holding one would not open at all
 * unless this runs first (store migrations run before validation on every load path).
 *
 * Idempotent by construction: a second run finds nothing to delete and changes nothing.
 */
export function retireShapes(sequenceId: string, retired: (type: string) => boolean): { id: `${string}/${number}`; migrations: MigrationSequence } {
	const { Retire: id } = createMigrationIds(sequenceId, { Retire: 1 })
	const migrations = createMigrationSequence({
		sequenceId,
		retroactive: true,
		sequence: [
			{
				id,
				scope: 'store',
				up(store) {
					const records = store as Record<string, LooseRecord>
					const shapes = Object.values(records).filter((r) => r.typeName === 'shape')
					const removed = new Set(shapes.filter((r) => typeof r.type === 'string' && retired(r.type)).map((r) => r.id))
					if (!removed.size) return

					// Children go with their parent, however deep: a shape whose parent is gone fails validation.
					let grew = true
					while (grew) {
						grew = false
						for (const shape of shapes) {
							if (!removed.has(shape.id) && removed.has(shape.parentId)) {
								removed.add(shape.id)
								grew = true
							}
						}
					}

					for (const [key, record] of Object.entries(records)) {
						const doomed =
							removed.has(record.id) ||
							(record.typeName === 'binding' && (removed.has(record.fromId) || removed.has(record.toId)))
						if (doomed) delete records[key]
					}
				},
			},
		],
	})
	return { id, migrations }
}

/**
 * A retired shape type's own migration sequence, kept with nothing in it. Every board saved while the
 * type existed lists its sequence, and sync refuses a board that lists one the build doesn't have: it
 * reads as saved by a newer build. Kept at the version boards last saw (an empty sequence is 0), so
 * only retire a type whose sequence was still empty, or keep its migrations instead.
 */
export function retiredShapeSequence(type: string): MigrationSequence {
	return createMigrationSequence({ sequenceId: `com.tldraw.shape.${type}`, sequence: [] })
}
