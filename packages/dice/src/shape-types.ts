import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { RollNodeProps } from './card/definition'

/**
 * Registers `node.roll` with tldraw's closed `TLShape` union — the same pattern
 * `@lifeboard/note-markdown` and `@lifeboard/book-reader` use: each compile-time package augments the
 * map for the types it owns.
 *
 * Imported for side effect by `src/index.ts`. Without it tldraw's schema never learns the type, and the
 * board throws "No shape util found" the first time one is created.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.roll': RollNodeProps & NodeBaseProps
	}
}
