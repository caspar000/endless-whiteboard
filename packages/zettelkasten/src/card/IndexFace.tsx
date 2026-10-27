import { useEditor, useValue } from '@lifeboard/canvas'
import { useRef } from 'react'
import { boxLinks } from '../box'
import { keywordKey } from '../links'
import { useFitText } from './fit'
import { CardPaper } from './CardFace'
import { NoteNumber } from './Foot'

/**
 * The front of the box (Q6): every keyword, A to Z, and the notes filed under it, as Luhmann's index
 * was a few entry points into the box rather than a catalogue of it. Worked out from the notes'
 * keywords every time (links.ts), never written down, so it can't fall out of step. `keyword` is picked
 * out: the one whose chip was pressed to get here.
 */
export function IndexFace({ keyword = null }: { keyword?: string | null }) {
	const editor = useEditor()
	const index = useValue('lifeboard:zettel-index', () => boxLinks(editor).index, [editor])
	const body = useRef<HTMLDivElement>(null)
	useFitText(body, [index])
	const picked = keyword ? keywordKey(keyword) : null
	return (
		<CardPaper id="Index" className="lb-zcard--index">
			<div className="lb-zcard__body" ref={body}>
				{index.length === 0 ? (
					<p className="lb-zcard__empty">No keywords yet. File a note under one with the + on its card.</p>
				) : (
					<div className="lb-zcard__text lb-zindex">
						{index.map((entry) => (
							<p key={entry.keyword} className="lb-zindex__row" data-picked={keywordKey(entry.keyword) === picked || undefined}>
								<span className="lb-zindex__word">{entry.keyword}</span>{' '}
								<span className="lb-zindex__notes">
									{entry.zids.map((zid) => (
										<NoteNumber key={zid} zid={zid} />
									))}
								</span>
							</p>
						))}
					</div>
				)}
			</div>
		</CardPaper>
	)
}
