import { NodeEditorPopover, type NodeComponentProps } from '@lifeboard/node-kit'
import { stopEventPropagation, useValue, type Editor, type TLShapeId } from '@lifeboard/canvas'
import { CircleCheck, Ellipsis, Eye, EyeOff, FolderPlus, Inbox, ListChecks, Pencil, Play, Plus, RefreshCw, Rss, Settings2, X } from 'lucide-react'
import { memo, useEffect, useState, type SyntheticEvent } from 'react'
import { FEED_TYPE, type FeedProps } from '../board'
import { feedItems, orderedCategories, sourcesIn, timeAgo, unwatchedCount, type FeedItem, type Show } from '../model'
import { getFeedProvider } from '../providers/registry'
import { reading, refreshSources, watchFeeds } from '../refresh'
import { getCategories, getSourceItems, getSources, getWatched, setWatched } from '../store'
import { categoryStyle, SourcesPanel, type PanelFocus } from '../SourcesPanel'

/** Clicks on the card's controls are the control's, not the start of a drag or a selection. */
const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** The card's view settings are how you look at it, not an edit of the board: no undo entry. */
function setView(editor: Editor, id: TLShapeId, props: Partial<FeedProps>): void {
	editor.run(() => editor.updateShape({ id, type: FEED_TYPE, props } as never), { history: 'ignore' })
}

/** Re-renders once a minute, so "3m ago" does not stand still. */
function useMinute(): number {
	const [now, setNow] = useState(() => Date.now())
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), 60_000)
		return () => clearInterval(timer)
	}, [])
	return now
}

/**
 * The feed card (design 1A on DARK-4): category chips across the top, the newest posts of the sources
 * under the chip that is on, and the panel for sources and categories beside it while it is edited.
 * A post opens on its own site in a new tab, the main way to watch; one with a player can also play
 * in the card. Either marks it watched, and its dot marks it by hand.
 */
function FeedCardImpl({ shape, isEditing, editor }: NodeComponentProps<FeedProps>) {
	const { categoryId, name } = shape.props
	const show: Show = shape.props.show === 'all' ? 'all' : 'unwatched'
	const now = useMinute()
	const [menu, setMenu] = useState(false)
	const [panelFocus, setPanelFocus] = useState<PanelFocus>(null)
	const [playing, setPlaying] = useState<FeedItem | null>(null)
	const [renaming, setRenaming] = useState(false)
	// Posts watched from this card while it shows only unwatched ones: they stay until the view changes,
	// so a row doesn't vanish under the pointer that just opened it.
	const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set())

	useEffect(() => watchFeeds(), [])
	useEffect(() => setKept(new Set()), [categoryId, show])
	useEffect(() => {
		if (isEditing) return
		setRenaming(false)
		setPanelFocus(null)
	}, [isEditing])

	const data = useValue(
		'lifeboard:feed-card',
		() => {
			const sources = getSources()
			const categories = getCategories()
			// A category deleted elsewhere: the card falls back to All rather than to an empty list.
			const active = categories[categoryId] ? categoryId : ''
			const items = getSourceItems()
			const watched = getWatched()
			return {
				sources,
				active,
				categories: orderedCategories(categories),
				items,
				watched,
				reading: reading.get(),
				counts: Object.fromEntries(['', ...Object.keys(categories)].map((id) => [id, unwatchedCount(sources, items, watched, id)])),
			}
		},
		[categoryId]
	)
	const posts = feedItems(data.sources, data.items, data.watched, { categoryId: data.active, show, keep: kept })
	const inView = sourcesIn(data.sources, data.active)
	const lastRead = inView.map((s) => data.items[s.sourceId]?.fetchedAt ?? '').sort().pop() ?? ''
	const busy = inView.some((s) => data.reading.sourceIds.has(s.sourceId))
	const failed = inView.filter((s) => data.items[s.sourceId]?.error)

	const openPanel = (focus: PanelFocus) => {
		setMenu(false)
		setPanelFocus(focus)
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
	}
	const markWatched = (item: FeedItem, on: boolean) => {
		if (show === 'unwatched') setKept((k) => new Set(k).add(item.itemId))
		setWatched([item.itemId], on)
	}
	const markAllWatched = () => {
		setMenu(false)
		setWatched(
			posts.filter((p) => !data.watched[p.itemId]).map((p) => p.itemId),
			true
		)
	}

	const chips = (
		<div className="lb-feed__chips" role="toolbar" aria-label="Categories">
			<button type="button" className="lb-feed__chip" aria-pressed={data.active === ''} onPointerDown={swallow} onClick={() => setView(editor, shape.id, { categoryId: '' })}>
				All<span className="lb-feed__count">{data.counts[''] || ''}</span>
			</button>
			{data.categories.map((c) => (
				<button
					key={c.categoryId}
					type="button"
					className="lb-feed__chip lb-feed__chip--cat"
					style={categoryStyle(c)}
					aria-pressed={data.active === c.categoryId}
					onPointerDown={swallow}
					onClick={() => setView(editor, shape.id, { categoryId: c.categoryId })}
				>
					{c.name}
					<span className="lb-feed__count">{data.counts[c.categoryId] || ''}</span>
				</button>
			))}
			<button type="button" className="lb-feed__chip lb-feed__chip--add" aria-label="New category" title="New category" onPointerDown={swallow} onClick={() => openPanel('category')}>
				<Plus size={13} aria-hidden />
			</button>
		</div>
	)

	const empty =
		Object.keys(data.sources).length === 0 ? (
			<div className="lb-feed__empty">
				<Inbox size={26} aria-hidden />
				<strong>No sources yet</strong>
				<span>Add a YouTube channel or an RSS feed, and its newest posts show here.</span>
				<button type="button" className="lb-btn lb-btn--tiny lb-btn--icon" onPointerDown={swallow} onClick={() => openPanel('add')}>
					<Plus size={13} aria-hidden /> Add a source
				</button>
			</div>
		) : inView.length === 0 ? (
			<div className="lb-feed__empty">
				<FolderPlus size={26} aria-hidden />
				<strong>Nothing filed under {data.categories.find((c) => c.categoryId === data.active)?.name}</strong>
				<span>File a source here, or add a new one.</span>
				<button type="button" className="lb-btn lb-btn--tiny lb-btn--icon" onPointerDown={swallow} onClick={() => openPanel(null)}>
					<Settings2 size={13} aria-hidden /> Manage sources
				</button>
			</div>
		) : show === 'unwatched' && inView.some((s) => data.items[s.sourceId]?.items.length) ? (
			<div className="lb-feed__empty">
				<CircleCheck size={26} aria-hidden />
				<strong>All caught up</strong>
				<span>Every post here is watched.</span>
				<button type="button" className="lb-btn lb-btn--tiny" onPointerDown={swallow} onClick={() => setView(editor, shape.id, { show: 'all' })}>
					Show watched too
				</button>
			</div>
		) : (
			<div className="lb-feed__empty">
				<Rss size={26} aria-hidden />
				<strong>{busy ? 'Reading your sources…' : 'Nothing to show yet'}</strong>
				{data.reading.unavailable && <span>{data.reading.unavailable}</span>}
			</div>
		)

	const body = (
		<div className={`lb-feed${isEditing ? ' lb-feed--editing' : ''}`}>
			<header className="lb-feed__head">
				<span className="lb-feed__badge" aria-hidden>
					<Rss size={15} />
				</span>
				{renaming ? (
					<input
						className="lb-feed__name lb-feed__name--input"
						defaultValue={name}
						autoFocus
						aria-label="Feed name"
						onFocus={(e) => e.target.select()}
						onBlur={(e) => {
							const next = e.target.value.trim()
							if (next && next !== name) editor.updateShape({ id: shape.id, type: FEED_TYPE, props: { name: next } } as never)
							setRenaming(false)
						}}
						onKeyDown={(e) => {
							if (e.key === 'Enter') e.currentTarget.blur()
							if (e.key === 'Escape') {
								e.stopPropagation()
								e.currentTarget.value = name
								e.currentTarget.blur()
							}
						}}
					/>
				) : (
					<span className="lb-feed__name">{name}</span>
				)}
				<button
					type="button"
					className="lb-feed__refresh"
					aria-busy={busy}
					title="Refresh now"
					onPointerDown={swallow}
					onClick={() => void refreshSources({ force: true, only: inView.map((s) => s.sourceId) })}
				>
					<RefreshCw size={13} aria-hidden className={busy ? 'lb-feed__spin' : undefined} />
					{busy ? 'updating…' : lastRead ? `updated ${timeAgo(lastRead, now)}` : 'refresh'}
				</button>
				<button type="button" className="lb-feed__more" aria-label="Feed menu" aria-expanded={menu} onPointerDown={swallow} onClick={() => setMenu((m) => !m)}>
					<Ellipsis size={16} aria-hidden />
				</button>
				{menu && (
					<div className="lb-feed__menu" role="menu" onPointerDown={swallow}>
						<button type="button" role="menuitem" onClick={() => openPanel(null)}>
							<Settings2 size={14} aria-hidden /> Manage sources
						</button>
						<button type="button" role="menuitem" onClick={() => openPanel('add')}>
							<Plus size={14} aria-hidden /> Add source
						</button>
						<button type="button" role="menuitem" onClick={() => openPanel('category')}>
							<FolderPlus size={14} aria-hidden /> New category
						</button>
						<hr />
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setMenu(false)
								void refreshSources({ force: true, only: inView.map((s) => s.sourceId) })
							}}
						>
							<RefreshCw size={14} aria-hidden /> Refresh now
						</button>
						<button type="button" role="menuitem" onClick={markAllWatched}>
							<ListChecks size={14} aria-hidden /> Mark all as watched
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setMenu(false)
								setView(editor, shape.id, { show: show === 'all' ? 'unwatched' : 'all' })
							}}
						>
							{show === 'all' ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
							{show === 'all' ? 'Show unwatched only' : 'Show watched too'}
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								setMenu(false)
								setRenaming(true)
								editor.select(shape.id)
								editor.setEditingShape(shape.id)
							}}
						>
							<Pencil size={14} aria-hidden /> Rename
						</button>
					</div>
				)}
			</header>
			{chips}
			{failed.length > 0 && (
				<p className="lb-feed__notice" title={failed.map((s) => `${s.title}: ${data.items[s.sourceId]?.error}`).join('\n')}>
					{failed.length === 1 ? `${failed[0]!.title} couldn't be read.` : `${failed.length} sources couldn't be read.`}
				</p>
			)}
			{playing && (
				<div className="lb-feed__player" onPointerDown={swallow}>
					<iframe
						src={getFeedProvider(data.sources[playing.sourceId]?.provider ?? '')?.embedUrl?.(playing) ?? ''}
						title={playing.title}
						allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
						allowFullScreen
						referrerPolicy="strict-origin-when-cross-origin"
					/>
					<button type="button" className="lb-feed__player-close" aria-label="Close the player" onClick={() => setPlaying(null)}>
						<X size={14} aria-hidden />
					</button>
				</div>
			)}
			{posts.length === 0 ? (
				empty
			) : (
				<ul className="lb-feed__list">
					{posts.map((item) => {
						const source = data.sources[item.sourceId]
						const provider = getFeedProvider(source?.provider ?? '')
						const Icon = provider?.icon
						const watched = !!data.watched[item.itemId]
						const canPlay = !!provider?.embedUrl?.(item)
						const open = () => markWatched(item, true)
						return (
							<li key={item.itemId} className={`lb-feed__row${watched ? '' : ' lb-feed__row--unwatched'}`}>
								<a className="lb-feed__thumb" href={item.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} onPointerDown={swallow} onClick={open}>
									{item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : Icon && <Icon size={22} aria-hidden />}
								</a>
								<a className="lb-feed__body" href={item.url} target="_blank" rel="noopener noreferrer" onPointerDown={swallow} onClick={open}>
									<span className="lb-feed__title">{item.title}</span>
									<span className="lb-feed__meta">
										{Icon && (
											<span className={`lb-feed__kind lb-feed__kind--${source?.provider}`}>
												<Icon size={13} aria-hidden />
											</span>
										)}
										<span className="lb-feed__source">{source?.title}</span>
										{item.published && (
											<>
												<span aria-hidden>·</span>
												<span className="lb-feed__ago">{timeAgo(item.published, now)}</span>
											</>
										)}
									</span>
								</a>
								<span className="lb-feed__actions">
									<button
										type="button"
										className="lb-feed__dot"
										aria-pressed={watched}
										aria-label={watched ? `Mark "${item.title}" unwatched` : `Mark "${item.title}" watched`}
										title={watched ? 'Watched. Click to mark unwatched' : 'Unwatched. Click to mark watched'}
										onPointerDown={swallow}
										onClick={() => markWatched(item, !watched)}
									/>
									{canPlay && (
										<button
											type="button"
											className="lb-feed__play"
											aria-label={`Play "${item.title}" here`}
											title="Play here"
											onPointerDown={swallow}
											onClick={() => {
												setPlaying(item)
												markWatched(item, true)
											}}
										>
											<Play size={12} aria-hidden />
										</button>
									)}
								</span>
							</li>
						)
					})}
				</ul>
			)}
			<footer className="lb-feed__foot">
				<span>
					{data.counts[data.active] ?? 0} unwatched · {inView.length} {inView.length === 1 ? 'source' : 'sources'}
				</span>
				<button type="button" className="lb-feed__show" onPointerDown={swallow} onClick={() => setView(editor, shape.id, { show: show === 'all' ? 'unwatched' : 'all' })}>
					{show === 'all' ? 'All, newest first' : 'Unwatched, newest first'}
				</button>
			</footer>
		</div>
	)

	if (!isEditing) return body
	return (
		<div className="lb-feed__editing" onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation} style={{ pointerEvents: 'all' }}>
			{body}
			{!renaming && (
				<NodeEditorPopover shape={shape} editor={editor} width={340} side="right">
					<SourcesPanel focus={panelFocus} fileInto={data.active} onClose={() => editor.setEditingShape(null)} />
				</NodeEditorPopover>
			)}
		</div>
	)
}

export const FeedCard = memo(FeedCardImpl, (prev, next) => prev.shape === next.shape && prev.isEditing === next.isEditing)
