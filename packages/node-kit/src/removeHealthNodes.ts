import { retireShapes } from './retireShapes'

/**
 * The Apple Health extension's removal: every `node.health.*` shape is deleted, along with anything
 * parented to it and every binding that points at one.
 *
 * Deletion rather than conversion, because nothing on main can show what a health card showed. Same
 * mechanism as `properties/itemsToNotes.ts`, for the same reason: an unregistered shape type is a
 * *validation* failure, so the board would not open at all unless this runs first. The extension lives
 * on in the `experiment/health` branch; if it comes back, it comes back with new boards.
 */
const health = retireShapes('com.lifeboard.removeHealthNodes', (type) => type.startsWith('node.health'))

export const REMOVE_HEALTH_NODES_MIGRATION_ID = health.id
export const removeHealthNodesMigrations = health.migrations
