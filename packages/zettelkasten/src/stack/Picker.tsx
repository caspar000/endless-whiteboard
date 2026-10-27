import { stopEventPropagation, type Editor } from '@lifeboard/canvas'
import { Hash, Link2, Plus, Quote } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addChip, boxLinks, boxOrder, isCard, isSource, placeSource, type CardShape, type ChipKind } from '../box'
import { sourceLabel } from '../card/Foot'
import { nameOf } from '../card/text'
import { inlineLinks, keywordKey, tidyKeyword } from '../links'

const MAX_ROWS = 7
const ICON = { link: Link2, keyword: Hash, cite: Quote } as const

interface Row {
	kind: ChipKind
	/** What is added: a note's or source's id, or a keyword. `null` for a new source, made on picking. */
	value: string | null
	label: string
	detail: string
}

/** What the picker offers for `query`, for the note `card`: notes, keywords, sources, and the new ones. */
export function pickerRows(editor: Editor, card: CardShape, query: string): Row[] {
	const q = query.trim().toLowerCase()
	const { keywords = [], cites = [] } = card.props
	// Already linked, in the text or with an earlier +, isn't offered again.
	const links = [...(card.props.links ?? []), ...inlineLinks(card.props.richText)]
	const notes: Row[] = []
	const sources: Row[] = []
	for (const entry of boxOrder(editor)) {
		if (!entry.id || entry.id === card.id) continue
		const shape = editor.getShape(entry.id)
		if (isCard(shape) && !links.includes(entry.zid)) {
			const name = nameOf(shape.props.richText)
			if (!q || entry.zid.startsWith(q) || name.toLowerCase().includes(q)) {
				notes.push({ kind: 'link', value: entry.zid, label: entry.zid, detail: name })
			}
		} else if (isSource(shape) && !cites.includes(entry.zid)) {
			const label = sourceLabel(shape.props.author, shape.props.title, shape.props.year)
			const words = `${shape.props.author} ${shape.props.title} ${shape.props.year}`.toLowerCase()
			if (!q || entry.zid.startsWith(q) || words.includes(q)) {
				sources.push({ kind: 'cite', value: entry.zid, label: `${entry.zid} ${label}`, detail: 'source' })
			}
		}
	}
	const filed = new Set(keywords.map(keywordKey))
	const known = boxLinks(editor).index.filter((entry) => !filed.has(keywordKey(entry.keyword)))
	const words: Row[] = known
		.filter((entry) => !q || keywordKey(entry.keyword).includes(q))
		.map((entry) => ({ kind: 'keyword', value: entry.keyword, label: entry.keyword, detail: `${entry.zids.length} filed` }))
	const typed = tidyKeyword(query)
	const fresh =
		typed && !filed.has(keywordKey(typed)) && !known.some((entry) => keywordKey(entry.keyword) === keywordKey(typed))
			? [{ kind: 'keyword', value: typed, label: typed, detail: 'new keyword' } satisfies Row]
			: []
	const newSource: Row = { kind: 'cite', value: null, label: typed ? `New source: ${typed}` : 'New source', detail: 'cite it' }
	// A number is looking for a note or a source; a word is more likely a keyword, so keywords come first.
	const rows = /^c?\d/.test(q)
		? [...notes.slice(0, 4), ...sources.slice(0, 3), ...words.slice(0, 3), ...fresh]
		: [...words.slice(0, 3), ...fresh, ...notes.slice(0, 4), ...sources.slice(0, 3)]
	return [...rows.slice(0, MAX_ROWS), newSource]
}

/**
 * The **+** on the front card's footer: one field for linking the note to another, filing it under a
 * keyword, or citing a source, the three chips a note carries (Q5). Typing narrows all three at once:
 * a number or words find notes and sources, anything finds keywords, and what is typed can be a new
 * keyword or the title of a new source.
 */
export function ChipPicker({ editor, card }: { editor: Editor; card: CardShape }) {
	const [open, setOpen] = useState(false)
	const [query, setQuery] = useState('')
	const [selected, setSelected] = useState(0)
	const input = useRef<HTMLInputElement>(null)
	const rows = useMemo(() => (open ? pickerRows(editor, card, query) : []), [open, editor, card, query])

	// The list hangs above the field in the page's own layer: the card clips what it holds.
	const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
	useLayoutEffect(() => {
		if (!open || !input.current) return setAt(null)
		const rect = input.current.getBoundingClientRect()
		setAt({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
	}, [open, rows.length])

	useEffect(() => setSelected(0), [query])

	const close = () => {
		setOpen(false)
		setQuery('')
	}
	const pick = (row: Row | undefined) => {
		if (!row) return
		if (row.kind === 'cite' && row.value === null) {
			const typed = query.trim()
			const { zid } = placeSource(editor, typed ? { title: typed } : {})
			addChip(editor, card.id, 'cite', zid)
		} else if (row.value) {
			addChip(editor, card.id, row.kind, row.value)
		}
		close()
	}

	if (!open) {
		return (
			<button
				type="button"
				className="lb-zchip lb-zchip--add"
				aria-label="Link, file under a keyword, or cite"
				title="Link, file under a keyword, or cite"
				onPointerDown={stopEventPropagation}
				onClick={(event) => {
					event.stopPropagation()
					setOpen(true)
				}}
			>
				<Plus aria-hidden="true" />
			</button>
		)
	}

	return (
		<div className="lb-zpick" onPointerDown={stopEventPropagation} onClick={(event) => event.stopPropagation()}>
			<input
				ref={input}
				// Focused as it mounts, not after the next paint: a key typed straight after the click is the
				// field's, and would otherwise reach the stack (where `i` goes to the index).
				autoFocus
				className="lb-zpick__input"
				type="text"
				autoComplete="off"
				spellCheck={false}
				placeholder="A note, a keyword, a source…"
				aria-label="Link to a note, file under a keyword, or cite a source"
				value={query}
				onChange={(event) => setQuery(event.currentTarget.value)}
				onBlur={close}
				onKeyDown={(event) => {
					if (event.key === 'Escape') {
						event.preventDefault()
						close()
					} else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
						event.preventDefault()
						const by = event.key === 'ArrowDown' ? 1 : -1
						setSelected((i) => (i + by + rows.length) % rows.length)
					} else if (event.key === 'Enter') {
						event.preventDefault()
						pick(rows[selected])
					}
				}}
			/>
			{at &&
				createPortal(
					<div className="lb-zpick__rows" role="listbox" style={at}>
						{rows.map((row, i) => {
							const Icon = ICON[row.kind]
							return (
								<div
									key={`${row.kind}:${row.value ?? 'new'}:${row.label}`}
									role="option"
									aria-selected={i === selected}
									className={i === selected ? 'lb-zpick__row lb-zpick__row--on' : 'lb-zpick__row'}
									// Before the field's blur closes the picker.
									onPointerDown={(event) => {
										event.preventDefault()
										stopEventPropagation(event)
										pick(row)
									}}
									onPointerEnter={() => setSelected(i)}
								>
									<Icon aria-hidden="true" />
									<span className="lb-zpick__label">{row.label}</span>
									<span className="lb-zpick__detail">{row.detail}</span>
								</div>
							)
						})}
					</div>,
					document.body
				)}
		</div>
	)
}
