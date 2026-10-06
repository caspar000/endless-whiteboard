import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	noteShapeProps,
	RecordProps,
	TLBaseShape,
	TLNoteShapeProps,
} from '@lifeboard/canvas-editor'
import { BaseNoteShapeUtil } from './NoteShapeUtil'
import { PINNED_PAPER } from './paper'
import { PinColorStyle, type PinColor } from './pin'

/**
 * A pinned note: a larger note held to the board by a push pin, with no crease (./paper.ts). Its own
 * shape type, so a board can hold both and each keeps its look; its props are a sticky note's.
 */
export type TLPinnedNoteShapeProps = TLNoteShapeProps & { pinColor: PinColor }
export type TLPinnedNoteShape = TLBaseShape<'pinned-note', TLPinnedNoteShapeProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'pinned-note': TLPinnedNoteShapeProps
	}
}

const versions = createShapePropsMigrationIds('pinned-note', { AddPinColor: 1 })

/** @public */
export class PinnedNoteShapeUtil extends BaseNoteShapeUtil<TLPinnedNoteShape> {
	static override type = 'pinned-note' as const
	static override props: RecordProps<TLPinnedNoteShape> = { ...noteShapeProps, pinColor: PinColorStyle }
	static override migrations = createShapePropsMigrationSequence({
		sequence: [
			{
				id: versions.AddPinColor,
				// Pinned notes from before pins had a colour keep the design's crimson.
				up: (props) => {
					props.pinColor = 'crimson'
				},
				down: (props) => {
					delete props.pinColor
				},
			},
		],
	})

	readonly paper = PINNED_PAPER

	/** White, written from the top left. The tool sets the same (PinnedNoteShapeTool). */
	override getDefaultProps(): TLPinnedNoteShape['props'] {
		return { ...super.getDefaultProps(), color: 'white', align: 'start', verticalAlign: 'start', pinColor: 'crimson' }
	}
}
