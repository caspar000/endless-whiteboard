import { createTLStore, defaultBindingUtils, type TLAnyShapeUtilConstructor } from '@lifeboard/canvas'
import { STORE_MIGRATIONS } from '@lifeboard/schema'

/**
 * Whether this version of the app can read a board's records: a board written by a newer version
 * can't be migrated back, and loading it anyway throws inside the editor. It happens after an update,
 * to a tab still running the version before it (pwa/registerServiceWorker.ts).
 */
export function canReadSnapshot(snapshot: { schema?: unknown }, storeShapeUtils: TLAnyShapeUtilConstructor[]): boolean {
	if (!snapshot.schema) return true
	const { schema } = createTLStore({ shapeUtils: storeShapeUtils, bindingUtils: defaultBindingUtils, migrations: STORE_MIGRATIONS })
	return schema.getMigrationsSince(snapshot.schema as never).ok
}
