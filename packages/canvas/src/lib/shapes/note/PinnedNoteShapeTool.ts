import { NoteShapeTool } from './NoteShapeTool'

/** Places a pinned note, the way the sticky note tool places a sticky. */
export class PinnedNoteShapeTool extends NoteShapeTool {
	static override id = 'pinned-note'
	override shapeType = 'pinned-note'
}
