import { useValue } from '@lifeboard/canvas'
import { ArrowDown, ArrowUp, Check, LoaderCircle, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { orderedCategories, unwatchedCount, type FeedCategory } from './model'
import { getFeedProvider, getFeedProviders, type FeedProvider } from './providers/registry'
import { readText, reading, refreshSources } from './refresh'
import {
	addCategory,
	addSource,
	getCategories,
	getSourceItems,
	getSources,
	getWatched,
	moveCategory,
	removeCategory,
	removeSource,
	renameCategory,
	setSourceInCategory,
} from './store'

/** A category's hue, for `--lb-opt-h`: the chip system every option chip uses. */
const HUES: Record<string, number> = { blue: 220, amber: 35, pink: 330, green: 145, violet: 270, teal: 180 }
export const categoryStyle = (category: FeedCategory) => ({ '--lb-opt-h': HUES[category.color] ?? 220 }) as CSSProperties

export type PanelFocus = 'add' | 'category' | null

/**
 * Where sources and categories are kept: beside a feed card while it is edited, and on the extension's
 * page in Settings. Both show the same vault data, so a change in one is a change in every card.
 */
export function SourcesPanel({ focus = null, fileInto = '', onClose }: { focus?: PanelFocus; fileInto?: string; onClose?: () => void }) {
	const data = useValue(
		'lifeboard:feed-panel',
		() => ({
			sources: Object.values(getSources()).sort((a, b) => a.title.localeCompare(b.title)),
			categories: orderedCategories(getCategories()),
			items: getSourceItems(),
			watched: getWatched(),
			reading: reading.get(),
		}),
		[]
	)
	const counts = (categoryId: string) => data.sources.filter((s) => s.categories.includes(categoryId)).length

	return (
		<div className="lb-feeds-panel">
			<header className="lb-feeds-panel__head">
				<div>
					{/* On the Settings page the section's own title says it already. */}
					{onClose && <h2>Sources</h2>}
					<span className="lb-feeds-panel__sub">
						{data.sources.length} {data.sources.length === 1 ? 'source' : 'sources'} · {data.categories.length} {data.categories.length === 1 ? 'category' : 'categories'}
					</span>
				</div>
				{onClose && (
					<button type="button" className="lb-feeds-panel__icon" aria-label="Close sources" onClick={onClose}>
						<X size={15} aria-hidden />
					</button>
				)}
			</header>

			<section className="lb-feeds-panel__section" aria-label="Categories">
				<h3>Categories</h3>
				{data.categories.length === 0 && <p className="lb-feeds-panel__hint">Make a category to file channels under, like "Electrical Engineering".</p>}
				<ul className="lb-feeds-panel__cats">
					{data.categories.map((category, i) => (
						<CategoryRow key={category.categoryId} category={category} count={counts(category.categoryId)} first={i === 0} last={i === data.categories.length - 1} />
					))}
				</ul>
				<NewCategory autoFocus={focus === 'category'} />
			</section>

			<section className="lb-feeds-panel__section" aria-label="Your sources">
				<h3>Your sources</h3>
				{data.sources.length === 0 && <p className="lb-feeds-panel__hint">Nothing yet. Add a YouTube channel below.</p>}
				<ul className="lb-feeds-panel__sources">
					{data.sources.map((source) => {
						const provider = getFeedProvider(source.provider)
						const Icon = provider?.icon
						const kept = data.items[source.sourceId]
						const unwatched = unwatchedCount({ [source.sourceId]: source }, data.items, data.watched, '')
						const status = data.reading.sourceIds.has(source.sourceId) ? (
							<span className="lb-feeds-panel__status">
								<LoaderCircle size={12} className="lb-feed__spin" aria-hidden /> reading…
							</span>
						) : kept?.error ? (
							<span className="lb-feeds-panel__status lb-feeds-panel__status--error" title={kept.error}>
								couldn't read
							</span>
						) : !kept?.fetchedAt ? (
							<span className="lb-feeds-panel__status">not read yet</span>
						) : unwatched ? (
							<span className="lb-feeds-panel__status lb-feeds-panel__status--new">{unwatched} new</span>
						) : (
							<span className="lb-feeds-panel__status">up to date</span>
						)
						return (
							<li key={source.sourceId} className="lb-feeds-panel__source">
								<div className="lb-feeds-panel__source-head">
									<span className={`lb-feed__kind lb-feed__kind--${source.provider}`}>{Icon && <Icon size={15} aria-hidden />}</span>
									<a className="lb-feeds-panel__source-name" href={source.link || source.feedUrl} target="_blank" rel="noopener noreferrer">
										{source.title}
									</a>
									{status}
									<button
										type="button"
										className="lb-feeds-panel__icon"
										aria-label={`Remove ${source.title}`}
										title="Remove this source"
										onClick={() => removeSource(source.sourceId)}
									>
										<Trash2 size={13} aria-hidden />
									</button>
								</div>
								{data.categories.length > 0 && (
									<div className="lb-feeds-panel__filing" role="group" aria-label={`Categories of ${source.title}`}>
										{data.categories.map((category) => {
											const filed = source.categories.includes(category.categoryId)
											return (
												<button
													key={category.categoryId}
													type="button"
													className="lb-feed__chip lb-feed__chip--sm lb-feed__chip--cat"
													style={categoryStyle(category)}
													aria-pressed={filed}
													title={filed ? `Take out of ${category.name}` : `File under ${category.name}`}
													onClick={() => setSourceInCategory(source.sourceId, category.categoryId, !filed)}
												>
													{filed && <Check size={11} aria-hidden />}
													{category.name}
												</button>
											)
										})}
									</div>
								)}
							</li>
						)
					})}
				</ul>
			</section>

			<AddSource autoFocus={focus === 'add'} categories={data.categories} fileInto={fileInto} unavailable={data.reading.unavailable} />
		</div>
	)
}

function CategoryRow({ category, count, first, last }: { category: FeedCategory; count: number; first: boolean; last: boolean }) {
	const [name, setName] = useState<string | null>(null)
	const [error, setError] = useState('')
	const [confirming, setConfirming] = useState(false)
	const save = () => {
		if (name === null) return
		const failed = renameCategory(category.categoryId, name)
		if (failed) return setError(failed.error)
		setName(null)
		setError('')
	}
	return (
		<li className="lb-feeds-panel__cat">
			<div className="lb-feeds-panel__cat-row">
				{name === null ? (
					<button type="button" className="lb-feed__chip lb-feed__chip--sm lb-feed__chip--cat" style={categoryStyle(category)} title="Rename" onClick={() => setName(category.name)}>
						{category.name}
					</button>
				) : (
					<input
						className="lb-feeds-panel__field"
						value={name}
						autoFocus
						aria-label="Category name"
						aria-invalid={!!error}
						onChange={(e) => {
							setName(e.target.value)
							setError('')
						}}
						onBlur={save}
						onKeyDown={(e) => {
							if (e.key === 'Enter') save()
							if (e.key === 'Escape') {
								e.stopPropagation()
								setName(null)
								setError('')
							}
						}}
					/>
				)}
				<span className="lb-feeds-panel__count">{count}</span>
				{confirming ? (
					<span className="lb-feeds-panel__confirm">
						Delete?
						<button type="button" className="lb-btn lb-btn--danger lb-btn--tiny" onClick={() => removeCategory(category.categoryId)}>
							Delete
						</button>
						<button type="button" className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => setConfirming(false)}>
							Keep
						</button>
					</span>
				) : (
					<span className="lb-feeds-panel__cat-actions">
						<button type="button" className="lb-feeds-panel__icon" aria-label={`Move ${category.name} up`} disabled={first} onClick={() => moveCategory(category.categoryId, -1)}>
							<ArrowUp size={13} aria-hidden />
						</button>
						<button type="button" className="lb-feeds-panel__icon" aria-label={`Move ${category.name} down`} disabled={last} onClick={() => moveCategory(category.categoryId, 1)}>
							<ArrowDown size={13} aria-hidden />
						</button>
						<button type="button" className="lb-feeds-panel__icon" aria-label={`Delete ${category.name}`} title="Delete the category; its sources stay" onClick={() => setConfirming(true)}>
							<Trash2 size={13} aria-hidden />
						</button>
					</span>
				)}
			</div>
			{error && <span className="lb-feeds-panel__error">{error}</span>}
		</li>
	)
}

function NewCategory({ autoFocus }: { autoFocus: boolean }) {
	const [open, setOpen] = useState(autoFocus)
	const [name, setName] = useState('')
	const [error, setError] = useState('')
	useEffect(() => {
		if (autoFocus) setOpen(true)
	}, [autoFocus])
	const create = () => {
		const made = addCategory(name)
		if ('error' in made) return setError(made.error)
		setName('')
		setError('')
	}
	if (!open)
		return (
			<button type="button" className="lb-feeds-panel__new" onClick={() => setOpen(true)}>
				<Plus size={14} aria-hidden /> New category
			</button>
		)
	return (
		<div className="lb-feeds-panel__form">
			<div className="lb-feeds-panel__inline">
				<input
					className="lb-feeds-panel__field"
					value={name}
					placeholder="e.g. Electrical Engineering"
					aria-label="New category name"
					aria-invalid={!!error}
					autoFocus
					onChange={(e) => {
						setName(e.target.value)
						setError('')
					}}
					onKeyDown={(e: KeyboardEvent) => {
						if (e.key === 'Enter') create()
						if (e.key === 'Escape') {
							e.stopPropagation()
							setOpen(false)
						}
					}}
				/>
				<button type="button" className="lb-btn lb-btn--primary lb-btn--tiny" onClick={create}>
					Create
				</button>
				<button type="button" className="lb-btn lb-btn--ghost lb-btn--tiny" onClick={() => setOpen(false)}>
					Cancel
				</button>
			</div>
			{error && <span className="lb-feeds-panel__error">{error}</span>}
		</div>
	)
}

function AddSource({ autoFocus, categories, fileInto, unavailable }: { autoFocus: boolean; categories: FeedCategory[]; fileInto: string; unavailable: string }) {
	const providers = getFeedProviders()
	const [kind, setKind] = useState(() => providers.find((p) => p.available)?.id ?? '')
	const [input, setInput] = useState('')
	const [category, setCategory] = useState(fileInto)
	const [busy, setBusy] = useState(false)
	const [error, setError] = useState('')
	const [added, setAdded] = useState('')
	const field = useRef<HTMLInputElement>(null)
	const provider = providers.find((p) => p.id === kind)

	useEffect(() => setCategory(fileInto), [fileInto])
	useEffect(() => {
		if (autoFocus) field.current?.focus()
	}, [autoFocus])
	// A category deleted while it was picked here: file into none rather than into nothing.
	const into = categories.some((c) => c.categoryId === category) ? category : ''

	const choose = (p: FeedProvider) => {
		if (!p.available) return
		setKind(p.id)
		setError('')
		setAdded('')
		field.current?.focus()
	}

	const add = async () => {
		if (!provider || busy) return
		setBusy(true)
		setError('')
		setAdded('')
		const found = await provider.resolve(input, readText)
		setBusy(false)
		if ('error' in found) return setError(found.error)
		const source = addSource({ ...found, provider: provider.id, categories: into ? [into] : [] })
		setInput('')
		const where = categories.find((c) => c.categoryId === into)
		setAdded(where ? `${source.title} added to ${where.name}.` : `${source.title} added.`)
		void refreshSources({ force: true, only: [source.sourceId] })
	}

	return (
		<section className="lb-feeds-panel__add" aria-label="Add a source">
			<h3>Add source</h3>
			<div className="lb-feeds-panel__kinds" role="tablist" aria-label="Kind of source">
				{providers.map((p) => {
					const Icon = p.icon
					return (
						<button
							key={p.id}
							type="button"
							role="tab"
							className="lb-feeds-panel__kind"
							aria-selected={p.id === kind}
							aria-disabled={!p.available}
							title={p.available ? undefined : `${p.name} is coming soon`}
							onClick={() => choose(p)}
						>
							<Icon size={14} aria-hidden />
							{p.name}
							{!p.available && <span className="lb-feeds-panel__soon">soon</span>}
						</button>
					)
				})}
			</div>
			{provider && (
				<label className="lb-feeds-panel__label">
					<span>{provider.inputLabel}</span>
					<input
						ref={field}
						className="lb-feeds-panel__field"
						value={input}
						placeholder={provider.placeholder}
						aria-invalid={!!error}
						disabled={busy}
						onChange={(e) => {
							setInput(e.target.value)
							setError('')
							setAdded('')
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter') void add()
						}}
					/>
				</label>
			)}
			{error && <span className="lb-feeds-panel__error">{error}</span>}
			<label className="lb-feeds-panel__label">
				<span>File into</span>
				<div className="lb-feeds-panel__inline">
					<select className="lb-feeds-panel__field" value={into} onChange={(e) => setCategory(e.target.value)}>
						<option value="">No category</option>
						{categories.map((c) => (
							<option key={c.categoryId} value={c.categoryId}>
								{c.name}
							</option>
						))}
					</select>
					<button type="button" className="lb-btn lb-btn--primary lb-btn--tiny" disabled={busy || !input.trim()} onClick={() => void add()}>
						{busy ? 'Adding…' : 'Add'}
					</button>
				</div>
			</label>
			{added && (
				<span className="lb-feeds-panel__ok" role="status">
					<Check size={13} aria-hidden /> {added}
				</span>
			)}
			{unavailable && !error && <span className="lb-feeds-panel__hint">{unavailable}</span>}
		</section>
	)
}
