import '../extensions'
import { createBoardSchema, STORE_MIGRATIONS } from '@lifeboard/schema'
import { createTLSchemaFromUtils, defaultBindingUtils } from '@lifeboard/canvas'
import { compareSchemas } from '@lifeboard/canvas-sync'
import { expect, it } from 'vitest'
import { buildBoardShapeUtils, buildStoreShapeUtils } from './boardShapeUtils'

/**
 * The sync server validates and migrates every record against its own schema, so a difference here is
 * a board that loads locally and is rejected by the server. The app's overrides of default shapes are
 * for drawing only; this is what proves they stay that way.
 */
it('the server builds exactly the schema a synced board does', () => {
	const app = createTLSchemaFromUtils({
		shapeUtils: buildStoreShapeUtils(buildBoardShapeUtils()),
		bindingUtils: defaultBindingUtils,
		migrations: STORE_MIGRATIONS,
	})
	expect(createBoardSchema().serialize()).toEqual(app.serialize())
})

/**
 * The schemas released builds saved boards under (`releasedSchemas/`, one per release that added or
 * removed a type). Sync refuses a board that lists a migration sequence this build doesn't have, as
 * saved by a newer build, so a type removed without `retiredShapeSequence` locks out every board saved
 * while it existed. That happened when the habit card went (2026-10-25).
 */
const released = import.meta.glob<Parameters<typeof compareSchemas>[1]>('./releasedSchemas/*.json', { eager: true, import: 'default' })

it.each(Object.entries(released))('opens boards saved under %s', (_, schema) => {
	expect(compareSchemas(createBoardSchema().serialize(), schema)).not.toBe('ahead')
})
