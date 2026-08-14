import type { NodeBaseProps } from '@lifeboard/node-kit'
import type { BookNodeProps } from './definition'
import type { QuoteNodeProps } from './quote/definition'

/**
 * Registers `node.book` with tldraw's closed `TLShape` union — same pattern as
 * `@lifeboard/note-markdown`: each compile-time package augments the map for the types it owns.
 *
 * Imported for side effect by `src/index.ts`.
 */
declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'node.book': BookNodeProps & NodeBaseProps
		'node.quote': QuoteNodeProps & NodeBaseProps
	}
}
