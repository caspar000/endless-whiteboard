/**
 * `@lifeboard/note-markdown` — the markdown note, as a default extension.
 *
 * Everything here reaches the host through `@lifeboard/node-kit`'s public barrel only. That
 * constraint is the point of the package boundary: it proves the SDK surface is sufficient for an
 * extension to be written outside the host, which is what a future third-party plugin is.
 */

// Registers `node.markdown` with tldraw's type system. Side-effect import, kept above the exports.
import './shape-types'

export { markdownNoteExtension } from './extension'
export {
	NOTE_MIN_HEIGHT,
	NOTE_NODE_TYPE,
	noteNodeDefinition,
	noteTitle,
	type NoteNodeProps,
} from './definition'
