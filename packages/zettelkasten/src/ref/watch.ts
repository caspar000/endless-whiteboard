import type { Editor, TLShapeId } from '@lifeboard/canvas'
import { isCard } from '../box'
import { isRef, REF_TYPE } from './definition'
import { liveBox } from './live'

const watched = new WeakSet<Editor>()
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** How long a run of typing on a reference counts as one undo step in its box. */
const STEP_MS = 4000

/**
 * Takes what is written on a box's note shown on this board (ref/definition.tsx) to the card in its
 * box, as it is typed. Only writing done here: the copy catching up with the box changes the text too,
 * and is never sent back. If the box went out of reach mid-sentence, the card remembers it has
 * something to deliver (`pending`) and delivers it when the box is next in reach.
 */
export function watchRefs(editor: Editor): void {
	if (watched.has(editor)) return
	watched.add(editor)
	let lastStep = 0
	editor.sideEffects.registerAfterChangeHandler('shape', (prev, next, source) => {
		if (source !== 'user' || !isRef(next) || !isRef(prev)) return
		if (same(prev.props.richText, next.props.richText) || editor.getEditingShapeId() !== next.id) return
		const box = liveBox(next.props.boxId)
		const card = box?.getShape(next.props.cardId as TLShapeId)
		if (!box || !isCard(card)) {
			if (!next.props.pending) {
				editor.run(() => editor.updateShape({ id: next.id, type: REF_TYPE, props: { pending: true } } as never), { history: 'ignore' })
			}
			return
		}
		if (same(card.props.richText, next.props.richText)) return
		if (Date.now() - lastStep > STEP_MS) box.markHistoryStoppingPoint('edit from another board')
		lastStep = Date.now()
		box.updateShape({ id: card.id, type: card.type, props: { richText: next.props.richText } } as never)
	})
}
