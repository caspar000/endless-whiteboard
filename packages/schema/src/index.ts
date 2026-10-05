import { bookReaderExtension } from '@lifeboard/book-reader'
import { diceExtension } from '@lifeboard/dice'
import {
	createNodeShapeUtil,
	getNodeDefinitions,
	itemsToNotesMigrations,
	registerExtension,
	removeHealthNodesMigrations,
	rollupsToTablesMigrations,
	tablesExtension,
	type Extension,
} from '@lifeboard/node-kit'
import { markdownNoteExtension } from '@lifeboard/note-markdown'
import {
	createTLSchemaFromUtils,
	defaultBindingUtils,
	defaultShapeUtils,
	type TLAnyShapeUtilConstructor,
	type TLSchema,
} from 'tldraw'

/**
 * Every extension this build ships, in registration order (which is also toolbar order).
 *
 * The list lives here rather than in the app because the sync server has to build exactly the schema
 * the app does: a board written by a client with a node type the server doesn't know fails validation
 * on the server, and the client is disconnected.
 */
export const SHIPPED_EXTENSIONS: readonly Extension[] = [
	markdownNoteExtension,
	tablesExtension,
	bookReaderExtension,
	// No node types — only canvas chrome, commands and an operation. Listed all the same: this is the
	// list of what the build ships, not the list of what has shapes.
	diceExtension,
]

/**
 * Migrations that rewrite records across types, rather than one shape's props. Each declares its own
 * `dependsOn`, so the order here is only for reading.
 */
export const STORE_MIGRATIONS = [itemsToNotesMigrations, rollupsToTablesMigrations, removeHealthNodesMigrations]

/** Idempotent, so the app's composition root and the server can both call it. */
export function registerShippedExtensions(): void {
	for (const ext of SHIPPED_EXTENSIONS) registerExtension(ext)
}

/** One util per registered node type, deprecated ones included: they are what keeps old boards valid. */
export function nodeShapeUtils(): TLAnyShapeUtilConstructor[] {
	return getNodeDefinitions().map(createNodeShapeUtil)
}

/**
 * The schema of a board, for the server. The app builds the same thing from its own shape utils, which
 * override some defaults (frame, sticky, text, geo, arrow) for drawing only; none of them change props
 * or migrations, and `schema.test.ts` in the app holds that true.
 */
export function createBoardSchema(): TLSchema {
	registerShippedExtensions()
	return createTLSchemaFromUtils({
		shapeUtils: [...defaultShapeUtils, ...nodeShapeUtils()],
		bindingUtils: defaultBindingUtils,
		migrations: STORE_MIGRATIONS,
	})
}
