import { Check, Search, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AGENT_MODELS, type AgentModel } from '../agent/models'
import { ClaudeMark, OpenAiMark } from './AgentBrandIcons'

/**
 * The model picker, in T3 Code's shape: a provider rail, a search box, and rows that say whose model
 * each one is.
 *
 * A plain list would do for four models, and that is what this replaced. The rail earns its width by
 * answering a question the list cannot: *which providers exist, and which of them can I actually use*.
 * With ChatGPT sitting there greyed out, "no OpenAI models" reads as a fact about this app rather than
 * as something the user has failed to configure — which is exactly what the panel needs to say, since
 * it drives Claude Code and nothing else.
 *
 * The search box is not there for four models; it is there because it is where the caret lands, which
 * makes the whole picker keyboard-first. Typing filters, ⌘1–⌘9 jump, Escape closes.
 */

/**
 * The rail's entries.
 *
 * `available: false` is a first-class state rather than an omission. The panel runs Claude Code, so
 * OpenAI models are not a missing integration to be added later by the user — they are out of scope
 * for this host, and saying so is more honest than a rail with one icon in it.
 */
interface Provider {
	id: string
	name: string
	Mark: typeof ClaudeMark
	available: boolean
	/** Why it cannot be picked. Shown as the button's tooltip and its accessible name. */
	unavailable?: string
}

const PROVIDERS: readonly Provider[] = [
	{ id: 'claude', name: 'Claude', Mark: ClaudeMark, available: true },
	{
		id: 'openai',
		name: 'ChatGPT',
		Mark: OpenAiMark,
		available: false,
		unavailable: 'ChatGPT — the panel runs Claude Code, so OpenAI models are not available here.',
	},
]

/** How many rows get a ⌘N shortcut. Nine, because ⌘0 is not a tenth of anything. */
const MAX_JUMPS = 9

export function AgentModelPicker({
	value,
	onPick,
	onClose,
}: {
	value: string
	onPick: (slug: string) => void
	onClose: () => void
}) {
	const [provider, setProvider] = useState('claude')
	const [query, setQuery] = useState('')
	const search = useRef<HTMLInputElement>(null)

	const models = useMemo(() => {
		// Only Claude has models to list. The other rail entry is unpickable, so this never has to ask
		// which provider a model belongs to — every model in the catalog is Anthropic's.
		if (provider !== 'claude') return []
		const needle = query.trim().toLowerCase()
		if (!needle) return AGENT_MODELS
		return AGENT_MODELS.filter((model) =>
			`${model.name} ${model.shortName} ${model.slug}`.toLowerCase().includes(needle)
		)
	}, [provider, query])

	// The caret starts in the search box, which is what makes typing the first thing that happens.
	useEffect(() => {
		search.current?.focus()
	}, [])

	/**
	 * ⌘1–⌘9 pick the Nth row.
	 *
	 * Bound on the document while the picker is open, and only then — the app has no other ⌘digit
	 * binding today, but a shortcut that stays live after the menu closes would be a landmine for
	 * whoever adds one. `preventDefault` stops the browser's own tab-switching from also firing.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!event.metaKey && !event.ctrlKey) return
			const index = Number(event.key) - 1
			if (!Number.isInteger(index) || index < 0 || index >= MAX_JUMPS) return
			const model = models[index]
			if (!model) return
			event.preventDefault()
			onPick(model.slug)
			onClose()
		}
		document.addEventListener('keydown', onKeyDown)
		return () => document.removeEventListener('keydown', onKeyDown)
	}, [models, onPick, onClose])

	/** Down from the search box walks into the list, which is the only way in without a pointer. */
	const onSearchKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			search.current
				?.closest('.lb-agent-picker')
				?.querySelector<HTMLButtonElement>('.lb-agent-picker__row')
				?.focus()
			return
		}
		// Enter with exactly one match picks it — the fast path for "cmd-k, son, enter".
		if (event.key === 'Enter' && models.length === 1 && models[0]) {
			event.preventDefault()
			onPick(models[0].slug)
			onClose()
		}
	}

	const onListKeyDown = (event: React.KeyboardEvent) => {
		if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
		event.preventDefault()
		const root = search.current?.closest('.lb-agent-picker')
		const rows = [...(root?.querySelectorAll<HTMLButtonElement>('.lb-agent-picker__row') ?? [])]
		const here = rows.indexOf(document.activeElement as HTMLButtonElement)
		// Up from the first row goes back to the search box rather than wrapping to the bottom: the box
		// is where you came from, and wrapping past it makes it unreachable without a pointer.
		if (event.key === 'ArrowUp' && here <= 0) {
			search.current?.focus()
			return
		}
		const step = event.key === 'ArrowDown' ? 1 : -1
		rows[Math.min(rows.length - 1, Math.max(0, here + step))]?.focus()
	}

	return (
		<div className="lb-agent-picker">
			<div className="lb-agent-picker__rail" role="tablist" aria-label="Providers" aria-orientation="vertical">
				{/* Present but inert, as in T3 Code's rail. There is no favourites store here yet, and a
				    rail that jumped straight to a provider icon would lose the shape being copied. */}
				<span className="lb-agent-picker__rail-item lb-agent-picker__rail-item--static" title="Favourites">
					<Star size={15} aria-hidden="true" />
				</span>
				<span className="lb-agent-picker__rail-divider" aria-hidden="true" />
				{PROVIDERS.map((entry) => (
					<button
						key={entry.id}
						type="button"
						role="tab"
						className="lb-agent-picker__rail-item"
						aria-selected={entry.available && provider === entry.id}
						data-selected={entry.available && provider === entry.id ? '' : undefined}
						disabled={!entry.available}
						title={entry.unavailable ?? entry.name}
						aria-label={entry.unavailable ?? entry.name}
						onClick={() => setProvider(entry.id)}
					>
						<entry.Mark size={17} />
					</button>
				))}
			</div>

			<div className="lb-agent-picker__body">
				<div className="lb-agent-picker__search">
					<Search size={13} aria-hidden="true" />
					<input
						ref={search}
						type="text"
						value={query}
						placeholder="Search models…"
						aria-label="Search models"
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onSearchKeyDown}
					/>
				</div>

				<div className="lb-agent-picker__list" role="listbox" aria-label="Models" onKeyDown={onListKeyDown}>
					{models.length === 0 ? (
						<p className="lb-agent-picker__empty">No models match “{query.trim()}”.</p>
					) : (
						models.map((model, index) => (
							<Row
								key={model.slug}
								model={model}
								selected={model.slug === value}
								jump={index < MAX_JUMPS ? `⌘${index + 1}` : null}
								onPick={() => {
									onPick(model.slug)
									onClose()
								}}
							/>
						))
					)}
				</div>
			</div>
		</div>
	)
}

function Row({
	model,
	selected,
	jump,
	onPick,
}: {
	model: AgentModel
	selected: boolean
	jump: string | null
	onPick: () => void
}) {
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			className="lb-agent-picker__row"
			// The selected row is focused on open, so Enter re-picks what is already set.
			autoFocus={selected}
			onClick={onPick}
		>
			<span className="lb-agent-picker__row-main">
				<span className="lb-agent-picker__row-name">{model.name}</span>
				{/* The provider line. Redundant while only Claude has models — and load-bearing the moment
				    a second provider does, which is the arrangement being copied. */}
				<span className="lb-agent-picker__row-provider">
					<ClaudeMark size={11} />
					Claude
				</span>
			</span>
			{jump && (
				<kbd className="lb-agent-picker__kbd" aria-hidden="true">
					{jump}
				</kbd>
			)}
			<span className="lb-agent-picker__row-tick">
				{selected && <Check size={13} strokeWidth={2.5} aria-hidden="true" />}
			</span>
		</button>
	)
}
