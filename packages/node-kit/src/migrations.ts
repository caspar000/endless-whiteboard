import { createShapePropsMigrationSequence, type TLPropsMigrations } from 'tldraw'

/**
 * Every node ships a migration sequence from v1, even when empty (§7). An empty sequence is not
 * ceremony: it establishes the sequence id up front, so the *first* real props change is a
 * one-line append instead of a schema-identity change that would strand existing boards.
 *
 * When you change a node's props:
 *   1. bump the version in that node's `versions` object,
 *   2. append `{ id: versions.X, up: (props) => { ... } }` to its sequence,
 *   3. add a fixture snapshot for the previous shape to `apps/web/src/persistence/fixtures/`
 *      — `snapshot-fixtures.test.ts` loads every fixture and fails if a migration is missing.
 */
export function emptyPropsMigrations(): TLPropsMigrations {
	return createShapePropsMigrationSequence({ sequence: [] })
}

export { createShapePropsMigrationIds, createShapePropsMigrationSequence } from 'tldraw'
