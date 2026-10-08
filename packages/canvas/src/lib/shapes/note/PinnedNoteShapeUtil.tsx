import {
	createShapePropsMigrationIds,
	createShapePropsMigrationSequence,
	noteShapeProps,
	RecordProps,
	TLBaseShape,
	TLNoteShapeProps,
	TLOnResizeHandler,
	T,
	Vec2d,
} from '@lifeboard/canvas-editor'
import { BaseNoteShapeUtil } from './NoteShapeUtil'
import { PINNED_PAPER } from './paper'
import { PinColorStyle, type PinColor } from './pin'

/**
 * A pinned note: a larger note held to the board by a push pin, with no crease (./paper.ts). Its own
 * shape type, so a board can hold both and each keeps its look; its props are a sticky note's, a pin
 * colour, and a paper height.
 *
 * Unlike a sticky it takes any proportion: `paperHeight` is the paper's height before its text grows
 * it, so a pinned note can be wider than it is tall (a wide Freeform sticky comes over as one).
 * Resizing sets the width through `scale`, text and all, and the height through `paperHeight`.
 */
export type TLPinnedNoteShapeProps = TLNoteShapeProps & { pinColor: PinColor; paperHeight: number }
export type TLPinnedNoteShape = TLBaseShape<'pinned-note', TLPinnedNoteShapeProps>

declare module '@tldraw/tlschema' {
	interface TLGlobalShapePropsMap {
		'pinned-note': TLPinnedNoteShapeProps
	}
}

const versions = createShapePropsMigrationIds('pinned-note', { AddPinColor: 1, AddPaperHeight: 2 })

/** As short as a pinned note resizes: room for the pin and a line under it. */
const MIN_PAPER_HEIGHT = 80
const MIN_SCALE = 0.2

/** @public */
export class PinnedNoteShapeUtil extends BaseNoteShapeUtil<TLPinnedNoteShape> {
	static override type = 'pinned-note' as const
	static override props: RecordProps<TLPinnedNoteShape> = { ...noteShapeProps, pinColor: PinColorStyle, paperHeight: T.positiveNumber }

	override isAspectRatioLocked = () => false

	override getPaperHeight(shape: TLPinnedNoteShape) {
		return shape.props.paperHeight
	}

	/** The width scales it, text and all; the height is the paper's, which its text grows again if it must. */
	override onResize: TLOnResizeHandler<TLPinnedNoteShape> = (shape, { initialBounds, scaleX, scaleY, newPoint }) => {
		const width = initialBounds.width * Math.abs(scaleX)
		const height = initialBounds.height * Math.abs(scaleY)
		const scale = Math.max(MIN_SCALE, width / PINNED_PAPER.width)
		const offset = new Vec2d(scaleX < 0 ? -width : 0, scaleY < 0 ? -height : 0)
		const { x, y } = Vec2d.Add(newPoint, offset.rot(shape.rotation))
		return { x, y, props: { scale, paperHeight: Math.max(MIN_PAPER_HEIGHT, height / scale), growY: 0 } }
	}
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
			{
				id: versions.AddPaperHeight,
				// Pinned notes from before were square before their text grew them.
				up: (props) => {
					props.paperHeight = PINNED_PAPER.width
				},
				down: (props) => {
					delete props.paperHeight
				},
			},
		],
	})

	readonly paper = PINNED_PAPER

	/** White, written from the top left. The tool sets the same (PinnedNoteShapeTool). */
	override getDefaultProps(): TLPinnedNoteShape['props'] {
		return {
			...super.getDefaultProps(),
			color: 'white',
			align: 'start',
			verticalAlign: 'start',
			pinColor: 'crimson',
			paperHeight: PINNED_PAPER.width,
		}
	}
}
