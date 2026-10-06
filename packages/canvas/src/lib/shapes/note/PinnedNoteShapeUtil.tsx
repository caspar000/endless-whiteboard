import {
	createShapePropsMigrationSequence,
	noteShapeProps,
	TLBaseShape,
	TLNoteShapeProps,
} from '@lifeboard/canvas-editor'
import { BaseNoteShapeUtil } from './NoteShapeUtil'
import { PINNED_PAPER } from './paper'

/**
 * A pinned note: a larger note held to the board by a push pin, with no crease (./paper.ts). Its own
 * shape type, so a board can hold both and each keeps its look; its props are a sticky note's.
 */
export type TLPinnedNoteShape = TLBaseShape<'pinned-note', TLNoteShapeProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'pinned-note': TLNoteShapeProps
	}
}

/** @public */
export class PinnedNoteShapeUtil extends BaseNoteShapeUtil<TLPinnedNoteShape> {
	static override type = 'pinned-note' as const
	static override props = noteShapeProps
	static override migrations = createShapePropsMigrationSequence({ sequence: [] })

	readonly paper = PINNED_PAPER
}
