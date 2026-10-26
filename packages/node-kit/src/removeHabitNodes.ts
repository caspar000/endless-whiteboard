import { retiredShapeSequence } from '@lifeboard/canvas'
import { retireShapes } from './retireShapes'

/**
 * The skill tree's habit cards (`node.habit`), removed until habits come back as an extension of their
 * own, with a format of their own.
 */
const habits = retireShapes('com.lifeboard.removeHabitNodes', (type) => type === 'node.habit')

export const REMOVE_HABIT_NODES_MIGRATION_ID = habits.id
export const removeHabitNodesMigrations = habits.migrations
export const habitShapeSequence = retiredShapeSequence('node.habit')
