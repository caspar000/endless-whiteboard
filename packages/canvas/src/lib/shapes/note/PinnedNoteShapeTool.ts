import { TLDefaultColorStyle, TLNoteShapeProps } from '@lifeboard/canvas-editor'
import { NoteShapeTool } from './NoteShapeTool'

/** Places a pinned note, the way the sticky note tool places a sticky. */
export class PinnedNoteShapeTool extends NoteShapeTool {
	static override id = 'pinned-note'
	override shapeType = 'pinned-note'

	/** A white card, where a sticky is orange. */
	static override defaultColor: TLDefaultColorStyle = 'white'

	/** Written from the top left, under the pin, like a note on a board. */
	override getInitialProps(): Partial<TLNoteShapeProps> {
		return { ...super.getInitialProps(), align: 'start', verticalAlign: 'start' }
	}
}
