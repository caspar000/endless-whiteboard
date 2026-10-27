import { useEditor, useValue } from '@lifeboard/canvas'
import { useRef } from 'react'
import { boxLinks, updateSource, type SourceProps, type SourceShape } from '../box'
import { useFitText } from './fit'
import { CardPaper } from './CardFace'
import { NoteNumber, sourceLabel } from './Foot'

/** What a source is called in lists and search: its author and year, else its title. */
export function sourceLabelOf({ author, title, year }: Pick<SourceProps, 'author' | 'title' | 'year'>): string {
	return sourceLabel(author, title, year)
}

const FIELDS: { key: keyof Omit<SourceProps, 'zid'>; label: string }[] = [
	{ key: 'author', label: 'Author' },
	{ key: 'title', label: 'Title' },
	{ key: 'year', label: 'Year' },
	{ key: 'note', label: 'Note: edition, pages, where you found it' },
]

/**
 * A source at the back of the box (Q7): who wrote it, what it is called, when, and a free note; and,
 * dimmed, the notes that cite it or link to it.
 *
 * Filled in on the card itself while `editing` (the stack, after Enter): a field per line, written as
 * typed. Enter steps to the next field and leaves the last one; Escape leaves (`onDone`).
 */
export function SourceFace({ shape, editing = false, onDone }: { shape: SourceShape; editing?: boolean; onDone?: () => void }) {
	const editor = useEditor()
	const { zid, author, title, year, note } = shape.props
	const citedBy = useValue(
		'lifeboard:zettel-cited-by',
		() => {
			const { citedBy, linkedFrom } = boxLinks(editor)
			return [...new Set([...(citedBy.get(zid) ?? []), ...(linkedFrom.get(zid) ?? [])])]
		},
		[editor, zid]
	)
	const body = useRef<HTMLDivElement>(null)
	useFitText(body, [author, title, year, note, editing])

	const empty = !author && !title && !year && !note

	return (
		<CardPaper id={zid} editing={editing} className="lb-zcard--source">
			<div className="lb-zcard__body" ref={body}>
				{editing ? (
					<form
						className="lb-zsource__form"
						onSubmit={(event) => event.preventDefault()}
						onKeyDown={(event) => {
							if (event.key === 'Escape') {
								event.preventDefault()
								event.stopPropagation()
								onDone?.()
							}
						}}
					>
						{FIELDS.map(({ key, label }, i) => {
							const props = {
								className: `lb-zsource__field lb-zsource__field--${key}`,
								'aria-label': label,
								placeholder: label,
								value: shape.props[key],
								spellCheck: key === 'note',
								onChange: (event: { currentTarget: { value: string } }) =>
									updateSource(editor, shape.id, { [key]: event.currentTarget.value }),
							}
							return key === 'note' ? (
								<textarea key={key} rows={3} {...props} />
							) : (
								<input
									key={key}
									autoFocus={i === 0}
									type="text"
									autoComplete="off"
									{...props}
									onKeyDown={(event) => {
										if (event.key !== 'Enter') return
										event.preventDefault()
										const next = event.currentTarget.form?.elements[i + 1] as HTMLElement | undefined
										next?.focus()
									}}
								/>
							)
						})}
					</form>
				) : empty ? (
					<p className="lb-zcard__empty">An empty source. Press Enter to fill it in.</p>
				) : (
					<div className="lb-zcard__text lb-zsource">
						{author && <p className="lb-zsource__author">{author}</p>}
						{(title || year) && (
							<h2 className="lb-zsource__title">
								{title}
								{year && <span className="lb-zsource__year">{title ? ` (${year})` : year}</span>}
							</h2>
						)}
						{note && <p className="lb-zsource__note">{note}</p>}
					</div>
				)}
			</div>
			{citedBy.length > 0 && (
				<div className="lb-zcard__foot">
					<div className="lb-zcard__from">
						Cited by{' '}
						{citedBy.map((from, i) => (
							<span key={from}>
								{i > 0 && ', '}
								<NoteNumber zid={from} />
							</span>
						))}
					</div>
				</div>
			)}
		</CardPaper>
	)
}
