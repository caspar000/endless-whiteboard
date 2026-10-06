import { StateNode, TLDefaultColorStyle, TLNoteShapeProps, atom } from '@lifeboard/canvas-editor'
import { Idle } from './toolStates/Idle'
import { Pointing } from './toolStates/Pointing'

/** @public */
export class NoteShapeTool extends StateNode {
	static override id = 'note'
	static override initial = 'idle'
	static override children = () => [Idle, Pointing]
	override shapeType = 'note'

	/** The colour a new note of this kind starts in: a sticky in `yellow` (filled #fdd399). */
	static defaultColor: TLDefaultColorStyle = 'yellow'

	/**
	 * The colour the next note is made in. Each kind of note keeps its own, rather than the shared
	 * colour every other tool draws with, so a sticky stays yellow however the pen was last set.
	 */
	readonly color = atom<TLDefaultColorStyle>(
		'next note colour',
		(this.constructor as typeof NoteShapeTool).defaultColor
	)

	/** The props a new note starts with, over the editor's shared styles. */
	getInitialProps(): Partial<TLNoteShapeProps> {
		return { color: this.color.get() }
	}
}
