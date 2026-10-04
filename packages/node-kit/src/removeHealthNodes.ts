import { createMigrationIds, createMigrationSequence } from '@tldraw/store'
import type { MigrationSequence } from '@tldraw/store'

/**
 * The Apple Health extension's removal: every `node.health.*` shape is deleted, along with anything
 * parented to it and every binding that points at one.
 *
 * Deletion rather than conversion, because nothing on main can show what a health card showed. Same
 * mechanism as `properties/itemsToNotes.ts`, for the same reason: an unregistered shape type is a
 * *validation* failure, so the board would not open at all unless this runs first. The extension lives
 * on in the `experiment/health` branch; if it comes back, it comes back with new boards.
 *
 * Idempotent by construction: a second run finds no health shapes and changes nothing.
 */
const versions = createMigrationIds('com.lifeboard.removeHealthNodes', {
	RemoveHealthNodes: 1,
})

export const REMOVE_HEALTH_NODES_MIGRATION_ID = versions.RemoveHealthNodes

const HEALTH_TYPE_PREFIX = 'node.health'

interface LooseRecord {
	id?: unknown
	typeName?: unknown
	type?: unknown
	parentId?: unknown
	fromId?: unknown
	toId?: unknown
}

export const removeHealthNodesMigrations: MigrationSequence = createMigrationSequence({
	sequenceId: 'com.lifeboard.removeHealthNodes',
	retroactive: true,
	sequence: [
		{
			id: versions.RemoveHealthNodes,
			scope: 'store',
			up(store) {
				const records = store as Record<string, LooseRecord>
				const shapes = Object.values(records).filter((r) => r.typeName === 'shape')
				const removed = new Set(
					shapes
						.filter((r) => typeof r.type === 'string' && r.type.startsWith(HEALTH_TYPE_PREFIX))
						.map((r) => r.id)
				)
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

				for (const [id, record] of Object.entries(records)) {
					const doomed =
						removed.has(record.id) ||
						(record.typeName === 'binding' && (removed.has(record.fromId) || removed.has(record.toId)))
					if (doomed) delete records[id]
				}
			},
		},
	],
})
