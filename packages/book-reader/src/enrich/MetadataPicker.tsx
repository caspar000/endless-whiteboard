import { NodeEditorPopover, type NodeShape } from '@lifeboard/node-kit'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Editor } from 'tldraw'
import type { BookNodeProps } from '../definition'
import { applyMatch } from './applyMatch'
import { closeEnrich } from './enrichTarget'
import { searchOpenLibrary, type BookMatch } from './openLibrary'

type State =
	| { status: 'idle' }
	| { status: 'searching' }
	| { status: 'done'; matches: BookMatch[] }
	| { status: 'applying' }

/**
 * Look this book up in Open Library, and choose which record it is.
 *
 * A picker rather than "fetch and apply the top hit", because catalogue search is noisy — a title
 * from a filename matches a dozen editions, translations and study guides, and silently adopting the
 * first would overwrite a book's details with a stranger's. Showing the covers makes the right one
 * obvious at a glance, which is the whole reason to fetch them.
 */
export function MetadataPicker({
	shape,
	editor,
}: {
	shape: NodeShape<BookNodeProps>
	editor: Editor
}) {
	const { title, author, fileName } = shape.props
	const [query, setQuery] = useState(() => [title || fileName, author].filter(Boolean).join(' '))
	const [state, setState] = useState<State>({ status: 'idle' })

	// The first search runs on open: the user asked for details, not for a search box.
	useEffect(() => {
		void run(query)
		// Once, for the query the panel opened with.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	async function run(text: string) {
		setState({ status: 'searching' })
		const matches = await searchOpenLibrary(text)
		setState({ status: 'done', matches })
	}

	async function choose(match: BookMatch) {
		setState({ status: 'applying' })
		await applyMatch(editor, shape.id, match)
		closeEnrich()
	}

	return (
		<NodeEditorPopover shape={shape} editor={editor} width={320}>
			<div className="lb-lookup">
				<form
					className="lb-lookup__search"
					onSubmit={(event) => {
						event.preventDefault()
						void run(query)
					}}
				>
					<input
						className="lb-lookup__input"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Title, author or ISBN"
						aria-label="Search Open Library"
						autoFocus
					/>
					<button type="submit" className="lb-lookup__go" aria-label="Search">
						<Search size={14} aria-hidden />
					</button>
				</form>

				{state.status === 'searching' && <p className="lb-lookup__note">Searching Open Library…</p>}
				{state.status === 'applying' && <p className="lb-lookup__note">Applying…</p>}
				{state.status === 'done' && state.matches.length === 0 && (
					<p className="lb-lookup__note">
						No matches — try the title alone, or an ISBN. (If you are offline, this needs the
						network.)
					</p>
				)}
				{state.status === 'done' && state.matches.length > 0 && (
					<ul className="lb-lookup__results">
						{state.matches.map((match) => (
							<li key={match.key}>
								<button type="button" className="lb-lookup__match" onClick={() => void choose(match)}>
									{match.thumbnailUrl ? (
										<img className="lb-lookup__cover" src={match.thumbnailUrl} alt="" />
									) : (
										<span className="lb-lookup__cover lb-lookup__cover--none" aria-hidden />
									)}
									<span className="lb-lookup__meta">
										<span className="lb-lookup__title">{match.title}</span>
										<span className="lb-lookup__sub">
											{[match.author, match.year ? String(match.year) : ''].filter(Boolean).join(' · ')}
										</span>
									</span>
								</button>
							</li>
						))}
					</ul>
				)}

				<p className="lb-lookup__credit">Data from Open Library</p>
			</div>
		</NodeEditorPopover>
	)
}
