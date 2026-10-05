import '../extensions'
import { createBoardSchema, STORE_MIGRATIONS } from '@lifeboard/schema'
import { createTLSchemaFromUtils, defaultBindingUtils } from '@lifeboard/canvas'
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
