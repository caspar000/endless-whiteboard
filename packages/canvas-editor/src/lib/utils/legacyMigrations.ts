/**
 * Version-numbered migrations for the small local records the editor keeps outside the store (user
 * preferences, session state). From tldraw 2.0.0-alpha.19's `@tldraw/store` (Apache-2.0, see
 * NOTICE), which today's store no longer ships: its migrations are id-based sequences now.
 *
 * Modified: the version-range typing is simplified to a plain record of migrators.
 */
import { MigrationFailureReason } from '@tldraw/store'

/** One step, forwards and back. */
export interface LegacyMigration<Before = any, After = any> {
	up: (oldState: Before) => After
	down: (newState: After) => Before
}

export interface LegacyMigrations {
	firstVersion: number
	currentVersion: number
	migrators: { [version: number]: LegacyMigration }
}

export type LegacyMigrationResult<T> =
	| { type: 'success'; value: T }
	| { type: 'error'; reason: MigrationFailureReason }

export function defineMigrations(opts: {
	firstVersion?: number
	currentVersion?: number
	migrators?: { [version: number]: LegacyMigration }
}): LegacyMigrations {
	const { currentVersion = 0, firstVersion = 0, migrators = {} } = opts
	if (opts.currentVersion !== undefined && opts.firstVersion !== undefined) {
		if (currentVersion === firstVersion) throw Error(`Current version is equal to initial version.`)
		if (currentVersion < firstVersion) throw Error(`Current version is lower than initial version.`)
	}
	return { firstVersion, currentVersion, migrators }
}

export function migrate<T>({
	value,
	migrations,
	fromVersion,
	toVersion,
}: {
	value: unknown
	migrations: LegacyMigrations
	fromVersion: number
	toVersion: number
}): LegacyMigrationResult<T> {
	let currentVersion = fromVersion
	while (currentVersion < toVersion) {
		const nextVersion = currentVersion + 1
		const migrator = migrations.migrators[nextVersion]
		if (!migrator) return { type: 'error', reason: MigrationFailureReason.TargetVersionTooNew }
		value = migrator.up(value)
		currentVersion = nextVersion
	}
	while (currentVersion > toVersion) {
		const migrator = migrations.migrators[currentVersion]
		if (!migrator) return { type: 'error', reason: MigrationFailureReason.TargetVersionTooOld }
		value = migrator.down(value)
		currentVersion = currentVersion - 1
	}
	return { type: 'success', value: value as T }
}
