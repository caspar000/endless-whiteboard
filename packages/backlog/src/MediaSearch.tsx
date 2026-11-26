import { useEffect, useRef, useState } from 'react'
import { Art } from './Art'
import { searchMedia, type Found } from './lookup'
import type { BacklogMedia } from './model'

/** How long typing has to pause before the services are asked. */
const PAUSE_MS = 450

const WORDS: Record<BacklogMedia, { label: string; placeholder: string; none: string }> = {
	music: {
		label: 'Search albums',
		placeholder: 'Artist and album',
		none: 'No album found',
	},
	film: {
		label: 'Search films',
		placeholder: 'Its title, in any language',
		none: 'No film found',
	},
}

/**
 * The add field of a backlog of one media type: what is typed is searched for online, and a result
 * clicked (or Enter on the one lit) goes in with its title, cover and year. What it can't find can
 * still go in as typed.
 */
export function MediaSearch({ id, media, onFound, onTyped, onClose }: { id: string; media: BacklogMedia; onFound: (found: Found) => void; onTyped: (line: string) => void; onClose: () => void }) {
	const [query, setQuery] = useState('')
	/** `done` once every service has answered: until then more may come. */
	const [results, setResults] = useState<{ query: string; found: Found[]; done: boolean } | null>(null)
	const [lit, setLit] = useState(0)
	const field = useRef<HTMLInputElement>(null)
	// Only the answer to the latest query is shown: an earlier one may come back after it.
	const asked = useRef('')

	const run = (text: string) => {
		asked.current = text
		if (!text.trim()) return setResults(null)
		const show = (found: Found[], done: boolean) => {
			if (asked.current !== text) return
			setResults((had) => {
				if (had?.query !== text) setLit(0)
				return { query: text, found, done }
			})
		}
		void searchMedia(media, text, (some) => show(some, false)).then((found) => show(found, true))
	}

	useEffect(() => {
		const text = query
		const timer = setTimeout(() => run(text), PAUSE_MS)
		return () => clearTimeout(timer)
		// `run` reads only refs and setters; `media` changing starts a new search.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [query, media])

	const reset = () => {
		setQuery('')
		setResults(null)
		asked.current = ''
		field.current?.focus()
	}
	const choose = (found: Found) => {
		onFound(found)
		reset()
	}
	const typed = () => {
		if (!query.trim()) return
		onTyped(query)
		reset()
	}

	const words = WORDS[media]
	const searching = !!query.trim() && !(results?.query === query && results.done)
	const found = results?.query === query ? results.found : []

	return (
		<>
			<label htmlFor={id}>{words.label}</label>
			<div className="lb-backlog__add-row">
				<input
					id={id}
					ref={field}
					type="search"
					autoComplete="off"
					autoFocus
					placeholder={words.placeholder}
					value={query}
					role="combobox"
					aria-expanded={found.length > 0}
					aria-controls={`${id}-results`}
					aria-activedescendant={found[lit] ? `${id}-r${lit}` : undefined}
					onChange={(e) => setQuery(e.currentTarget.value)}
					onKeyDown={(e) => {
						e.stopPropagation()
						if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
							e.preventDefault()
							if (found.length) setLit((lit + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length)
						}
						if (e.key === 'Enter') {
							e.preventDefault()
							if (found[lit]) choose(found[lit])
							else if (!searching) typed()
							else run(query)
						}
						if (e.key === 'Escape') onClose()
					}}
				/>
				<button type="button" className="lb-backlog__btn" disabled={!query.trim()} onClick={typed} title="Add it as typed, with a cover drawn from its title">
					Add as typed
				</button>
				<button type="button" className="lb-backlog__btn" onClick={onClose}>
					Cancel
				</button>
			</div>
			{found.length > 0 && (
				<ul className={`lb-backlog__results lb-backlog__results--${media}`} id={`${id}-results`} role="listbox" aria-label={`${words.label}: results`}>
					{found.map((f, i) => (
						<li key={f.id} id={`${id}-r${i}`} role="option" aria-selected={i === lit} className="lb-backlog__result" onPointerEnter={() => setLit(i)} onClick={() => choose(f)}>
							<Art item={f} shape={media === 'film' ? 'poster' : 'square'} className="lb-backlog__result-art" />
							<span className="lb-backlog__result-text">
								<strong>{f.title}</strong>
								<span>{[f.creator, f.year].filter(Boolean).join(' · ')}</span>
								{(f.detail || f.via) && <small>{[f.detail, f.via].filter(Boolean).join(' · ')}</small>}
							</span>
						</li>
					))}
				</ul>
			)}
			<span className="lb-backlog__hint" aria-live="polite">
				{searching
					? found.length
						? 'Searching for more…'
						: 'Searching…'
					: results && !found.length
						? `${words.none} for “${query.trim()}”. Enter adds it as typed.`
						: found.length
							? 'Click one to add it, or ↑ ↓ and Enter.'
							: media === 'music'
								? 'Looks in iTunes, MusicBrainz and Deezer.'
								: 'Looks in Wikidata, with posters from Wikipedia.'}
			</span>
		</>
	)
}
