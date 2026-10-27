import { atom, stopEventPropagation, useEditor, useValue, type Editor, type TLShape } from '@lifeboard/canvas'
import { getBoardBridge, type BoardSummary } from '@lifeboard/node-kit'
import { Archive, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { findOrAddSource, isBox } from '../box'
import { sourceLabel } from '../card/Foot'
import { announce, showCard } from '../stack/state'
import { forgetBox, likelyBoxes } from './boxes'
import { workOf, type Work } from './work'

/** A book or quote someone asked to cite, on the board it was asked on. `work` is null when there is nothing to cite. */
interface CiteRequest {
	editor: Editor
	work: Work | null
}

const request = atom<CiteRequest | null>('lifeboard:zettel-cite', null)

/** "Cite in a box…" on a book or quote card: asks which box (CiteDialog). */
export function askToCite(editor: Editor, shape: TLShape | undefined): void {
	if (!shape) return
	request.set({ editor, work: workOf(editor, shape) })
}

/**
 * The dialog "Cite in a box…" opens, drawn over the board the book is on (a `CanvasOverlay`): the
 * boxes, newest first, and a click on one opens that box at the book's source, a new one at the back
 * of the box or the one it already has. Nothing else on the board changes.
 */
export function CiteOverlay() {
	const editor = useEditor()
	const asked = useValue('lifeboard:zettel-cite', () => request.get(), [])
	if (!asked || asked.editor !== editor) return null
	// Into the page itself: drawn inside the canvas's front layer, a shape's own layer could cover it.
	return createPortal(<CiteDialog work={asked.work} close={() => request.set(null)} />, document.body)
}

function CiteDialog({ work, close }: { work: Work | null; close: () => void }) {
	const [boxes, setBoxes] = useState<BoardSummary[] | null>(null)
	const [problem, setProblem] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)

	useEffect(() => {
		let cancelled = false
		void getBoardBridge()
			?.list()
			.then((boards) => !cancelled && setBoxes(likelyBoxes(boards)))
		return () => {
			cancelled = true
		}
	}, [])

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

	const cite = async (board: BoardSummary) => {
		const bridge = getBoardBridge()
		if (!bridge || !work) return
		setBusy(true)
		setProblem(null)
		const box = await bridge.open(board.id)
		if (!box) {
			setBusy(false)
			setProblem(`${board.name} couldn’t be opened.`)
			return
		}
		if (!isBox(box)) {
			// Looked like one (its icon) but isn't: drop it from the list, and say so on the board it is.
			forgetBox(board.id)
			setBusy(false)
			setProblem(`${board.name} isn’t a box.`)
			setBoxes((list) => list?.filter((other) => other.id !== board.id) ?? null)
			return
		}
		const { zid, added } = findOrAddSource(box, work)
		showCard(box, zid)
		const name = work.title || label
		announce(added ? `${name} is ${zid}, at the back of the box.` : `${name} was already in this box, as ${zid}.`)
		close()
	}

	const label = work ? sourceLabel(work.author, work.title, work.year) : ''

	return (
		<div className="lb-zcite" onPointerDown={stopEventPropagation} onWheel={stopEventPropagation}>
			<div className="lb-zcite__scrim" onClick={close} />
			<div className="lb-zcite__panel" role="dialog" aria-modal="true" aria-labelledby="lb-zcite-title">
				<div className="lb-zcite__head">
					<h2 id="lb-zcite-title">Cite in a box</h2>
					<button type="button" className="lb-zcite__close" aria-label="Close" onClick={close}>
						<X aria-hidden="true" />
					</button>
				</div>
				{!work ? (
					<p className="lb-zcite__text">This quote’s book isn’t on this board, so there is nothing to cite it from.</p>
				) : (
					<>
						<p className="lb-zcite__text">
							<strong>{work.title || 'Untitled'}</strong>
							{work.author && <> by {work.author}</>}
							{work.year && <>, {work.year}</>}. It becomes a source at the back of the box you pick, or the one
							already there.
						</p>
						{problem && (
							<p className="lb-zcite__problem" role="alert">
								{problem}
							</p>
						)}
						{boxes === null ? (
							<p className="lb-zcite__text">Finding your boxes…</p>
						) : boxes.length === 0 ? (
							<p className="lb-zcite__text">There are no boxes yet. Make one with New box on the home screen.</p>
						) : (
							<ul className="lb-zcite__boxes">
								{boxes.map((board) => (
									<li key={board.id}>
										<button type="button" className="lb-zcite__box" disabled={busy} onClick={() => void cite(board)}>
											<Archive aria-hidden="true" />
											<span>{board.name}</span>
										</button>
									</li>
								))}
							</ul>
						)}
					</>
				)}
			</div>
		</div>
	)
}
