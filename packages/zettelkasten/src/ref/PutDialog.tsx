import { atom, createShapeId, stopEventPropagation, useEditor, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { getBoardBridge, type BoardSummary } from '@lifeboard/node-kit'
import { LayoutDashboard, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { boxOrder, cardByZid, isCard, type CardShape } from '../box'
import { likelyBoxes } from '../cite/boxes'
import { CARD_H, CARD_W } from '../layout'
import { frontIndex, getStack } from '../stack/state'
import { REF_TYPE } from './definition'
import { boardIdOf } from './live'

/** A note someone asked to put on another board, from the box it is in. */
const request = atom<{ box: Editor; card: TLShapeId } | null>('lifeboard:zettel-put', null)

/** The note "Put on a board…" means: the card in front of the stack, or the card picked out on the table. */
function noteHere(editor: Editor): CardShape | null {
	if (getStack(editor).open) {
		const order = boxOrder(editor)
		const front = order[frontIndex(editor, order)]
		return front?.kind === 'note' ? (cardByZid(editor, front.zid) ?? null) : null
	}
	const selected = editor.getOnlySelectedShape()
	return isCard(selected) ? selected : null
}

/** "Put on a board…": asks which board (PutDialog). Does nothing when no note is in front. */
export function askToPut(editor: Editor): boolean {
	const card = noteHere(editor)
	if (!card) return false
	editor.complete()
	request.set({ box: editor, card: card.id })
	return true
}

/** Puts a reference to a box's card on a board, in the middle of its view, picked out. One undo step there. */
export function putRef(target: Editor, boxId: string, card: CardShape): TLShapeId {
	const id = createShapeId()
	const center = target.getViewportPageBounds().center
	target.markHistoryStoppingPoint('put a note from a box')
	target.createShape({
		id,
		type: REF_TYPE,
		x: center.x - CARD_W / 2,
		y: center.y - CARD_H / 2,
		props: { boxId, cardId: card.id, zid: card.props.zid, richText: card.props.richText, pending: false },
	} as never)
	target.select(id)
	return id
}

/** The dialog, drawn by the box's bar (BoxDock): every board that isn't a box, newest first. */
export function PutOverlay() {
	const editor = useEditor()
	const asked = useValue('lifeboard:zettel-put', () => request.get(), [])
	if (!asked || asked.box !== editor) return null
	return createPortal(<PutDialog box={editor} cardId={asked.card} close={() => request.set(null)} />, document.body)
}

function PutDialog({ box, cardId, close }: { box: Editor; cardId: TLShapeId; close: () => void }) {
	const [boards, setBoards] = useState<BoardSummary[] | null>(null)
	const [busy, setBusy] = useState(false)
	const boxId = boardIdOf(box)
	const card = box.getShape(cardId)

	useEffect(() => {
		let cancelled = false
		void getBoardBridge()
			?.list()
			.then((all) => {
				if (cancelled) return
				const boxes = new Set(likelyBoxes(all).map((board) => board.id))
				setBoards(all.filter((board) => !boxes.has(board.id) && board.id !== boxId).sort((a, b) => b.updatedAt - a.updatedAt))
			})
		return () => {
			cancelled = true
		}
	}, [boxId])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return
			event.preventDefault()
			event.stopPropagation()
			close()
		}
		window.addEventListener('keydown', onKeyDown, { capture: true })
		return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
	}, [close])

	const put = async (board: BoardSummary) => {
		const bridge = getBoardBridge()
		if (!bridge || !boxId || !isCard(card)) return
		setBusy(true)
		const target = await bridge.open(board.id)
		if (target) putRef(target, boxId, card)
		close()
	}

	return (
		<div className="lb-zcite" onPointerDown={stopEventPropagation} onWheel={stopEventPropagation}>
			<div className="lb-zcite__scrim" onClick={close} />
			<div className="lb-zcite__panel" role="dialog" aria-modal="true" aria-labelledby="lb-zput-title">
				<div className="lb-zcite__head">
					<h2 id="lb-zput-title">Put on a board</h2>
					<button type="button" className="lb-zcite__close" aria-label="Close" onClick={close}>
						<X aria-hidden="true" />
					</button>
				</div>
				<p className="lb-zcite__text">
					Note <strong>{isCard(card) ? card.props.zid : ''}</strong> stays in this box. The board shows it, follows it
					when it changes, and writes on it here when you write on it there.
				</p>
				{boards === null ? (
					<p className="lb-zcite__text">Finding your boards…</p>
				) : boards.length === 0 ? (
					<p className="lb-zcite__text">There are no other boards yet.</p>
				) : (
					<ul className="lb-zcite__boxes">
						{boards.map((board) => (
							<li key={board.id}>
								<button type="button" className="lb-zcite__box" disabled={busy} onClick={() => void put(board)}>
									<LayoutDashboard aria-hidden="true" />
									<span>{board.name}</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	)
}
