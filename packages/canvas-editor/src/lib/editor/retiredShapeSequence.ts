import { createMigrationSequence, type MigrationSequence } from '@tldraw/store'

/**
 * A retired shape type's own migration sequence, kept with nothing in it. Every board saved while the
 * type existed lists its sequence, and sync refuses a board that lists one the build doesn't have: it
 * reads as saved by a newer build. Kept at the version boards last saw (an empty sequence is 0), so
 * only retire a type whose sequence was still empty, or keep its migrations instead.
 *
 * Marked as retired, because the editor takes every `com.tldraw.shape.*` sequence for a shape type it
 * needs a util for, and would refuse to start.
 */
export function retiredShapeSequence(type: string): MigrationSequence {
	return Object.assign(createMigrationSequence({ sequenceId: `com.tldraw.shape.${type}`, sequence: [] }), { retiredShape: true })
}

export function isRetiredShapeSequence(sequence: MigrationSequence): boolean {
	return (sequence as { retiredShape?: boolean }).retiredShape === true
}
