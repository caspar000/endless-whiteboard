import { useValue, type Editor } from '@lifeboard/canvas'
import {
	SourceSelect,
	boardIdOf,
	draggingItem,
	getDraggedItem,
	hasDraggedItem,
	resolveItemSource,
	setDraggedItem,
	sourceEntries,
	useItemCover,
	type NodeComponentProps,
	type SourceEntry,
} from '@lifeboard/node-kit'
import { ArrowDown, ChevronRight, Pencil, Plus, X } from 'lucide-react'
import { memo, useEffect, useRef, useState, type DragEvent, type SyntheticEvent } from 'react'
import { addCollection, addItem, collectionKey, addTyped, removeEntry, renameBacklog, type BacklogCollection, type BacklogEntry, type BacklogItem } from './model'
import type { BacklogProps } from './props'
import { BACKLOG_SOURCE_ID, watchBacklog } from './source'
import { backlogOrNew, shapeDropHint, updateBacklog } from './store'

/** Clicks on the card's controls are the card's, not the canvas's: no select, no drag. */
const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** Four rows of three, the last a "Show all" when there are more. */
const SHOWN = 12
/** How many of a collection's items its open panel shows. */
const PANEL_SHOWN = 12

/** Tells the board a field is open, so its own keys stand aside while you type. */
function useOpenMenu(editor: Editor, id: string, open: boolean) {
	useEffect(() => {
		if (!open) return
		editor.addOpenMenu(id)
		return () => {
			editor.deleteOpenMenu(id)
		}
	}, [editor, id, open])
}

const viaText = (via: string) => (via ? `from ${via}` : 'typed')

function Art({ item, className }: { item: Pick<SourceEntry, 'title' | 'creator' | 'year' | 'cover'>; className?: string }) {
	const url = useItemCover(item, 'square')
	return <img className={className ?? 'lb-backlog__art'} src={url} alt="" draggable={false} loading="lazy" />
}

/** One item: its cover, title, creator and where it came from. Dragged out, it goes on to a ranking or another backlog. */
function ItemTile({ item, onRemove }: { item: BacklogItem; onRemove: () => void }) {
	const at = item.id.indexOf('|')
	const from = at > 0 && !item.id.startsWith('typed|') ? item.id.slice(0, at) : ''
	return (
		<div
			className="lb-backlog__tile"
			role="listitem"
			draggable
			onPointerDown={swallow}
			onDragStart={(e) => {
				e.stopPropagation()
				setDraggedItem(e.dataTransfer, { entry: { ...item, id: from ? item.id.slice(at + 1) : item.id }, from, via: item.via })
				e.dataTransfer.effectAllowed = 'copy'
			}}
		>
			<div className="lb-backlog__thumb">
				<Art item={item} />
				<button type="button" className="lb-backlog__remove" aria-label={`Remove ${item.title}`} title="Remove" onPointerDown={swallow} onClick={onRemove}>
					<X size={12} aria-hidden />
				</button>
			</div>
			<span className="lb-backlog__cap">
				<span className="lb-backlog__title" title={item.title}>
					{item.title}
				</span>
				{item.creator && <span className="lb-backlog__creator">{item.creator}</span>}
				<span className="lb-backlog__via">{viaText(item.via)}</span>
			</span>
		</div>
	)
}

/**
 * A whole source, kept as one square tile the size of an album's (the acceptance's "like in 2A"): its
 * first covers fanned in a stack, its name and how many it holds. Click to open it out below.
 */
function CollectionTile({ collection, open, onToggle, onRemove }: { collection: BacklogCollection; open: boolean; onToggle: () => void; onRemove: () => void }) {
	const info = useValue(
		'lifeboard:backlog-collection',
		() => {
			const resolved = resolveItemSource(collectionKey(collection))
			const entries = sourceEntries(collectionKey(collection))
			return { name: resolved.name, kind: resolved.kind, gone: resolved.type !== 'source', count: entries.length, first: entries.slice(0, 3) }
		},
		[collection.id, collection.key]
	)
	return (
		<div className="lb-backlog__tile lb-backlog__tile--stack" role="listitem">
			<button
				type="button"
				className="lb-backlog__thumb lb-backlog__stack"
				aria-expanded={open}
				aria-label={`${info.name}, a collection of ${info.count} ${info.kind.noun}. ${open ? 'Close' : 'Open'}`}
				onPointerDown={swallow}
				onClick={onToggle}
			>
				{info.first.map((entry, i) => (
					<span key={entry.id} className={`lb-backlog__fan lb-backlog__fan--${i}`} aria-hidden="true">
						<Art item={entry} />
					</span>
				))}
				{info.first.length === 0 && <span className="lb-backlog__stack-empty">{info.gone ? 'Gone' : 'Empty'}</span>}
			</button>
			<button type="button" className="lb-backlog__remove" aria-label={`Remove ${info.name}`} title="Remove" onPointerDown={swallow} onClick={onRemove}>
				<X size={12} aria-hidden />
			</button>
			<span className="lb-backlog__cap">
				<span className="lb-backlog__title lb-backlog__title--stack" title={info.name}>
					<span>{info.name}</span>
					<ChevronRight size={14} aria-hidden className={open ? 'lb-backlog__chev lb-backlog__chev--open' : 'lb-backlog__chev'} />
				</span>
				<span className="lb-backlog__creator">
					{info.count} {info.count === 1 ? info.kind.one : info.kind.noun}
				</span>
				<span className="lb-backlog__via">{viaText(collection.via)}</span>
			</span>
		</div>
	)
}

/** A collection opened out: its first items, and how many more. */
function CollectionPanel({ collection }: { collection: BacklogCollection }) {
	const info = useValue(
		'lifeboard:backlog-panel',
		() => {
			const entries = sourceEntries(collectionKey(collection))
			return { name: resolveItemSource(collectionKey(collection)).name, count: entries.length, shown: entries.slice(0, PANEL_SHOWN) }
		},
		[collection.id, collection.key]
	)
	return (
		<div className="lb-backlog__panel" role="region" aria-label={`${info.name}: what it holds`}>
			<div className="lb-backlog__panel-head">
				<span>{info.name}</span>
				<span>{info.count}</span>
			</div>
			<div className="lb-backlog__works">
				{info.shown.map((entry) => (
					<span key={entry.id} className="lb-backlog__work" title={`${entry.title}${entry.creator ? ` — ${entry.creator}` : ''}`}>
						<Art item={entry} />
						<span className="lb-backlog__work-title">{entry.title}</span>
					</span>
				))}
			</div>
			{info.count > PANEL_SHOWN && <span className="lb-backlog__panel-foot">+{info.count - PANEL_SHOWN} more · {viaText(collection.via)}</span>}
		</div>
	)
}

function BacklogCardImpl({ shape, editor }: NodeComponentProps<BacklogProps>) {
	const { backlogId } = shape.props
	// The board this card is on (DARK-14): a backlog made here belongs to it.
	const boardId = boardIdOf(editor)
	const backlog = useValue('lifeboard:backlog', () => backlogOrNew(backlogId, boardId), [backlogId, boardId])
	const total = useValue(
		'lifeboard:backlog-total',
		() => backlog.entries.reduce((n, e) => n + (e.kind === 'item' ? 1 : sourceEntries(e.id).length), 0),
		[backlog]
	)
	const shapeHint = useValue('lifeboard:backlog-shape-hint', () => {
		const hint = shapeDropHint.get()
		return hint?.shapeId === shape.id ? hint.label : null
	}, [shape.id])

	const [renaming, setRenaming] = useState(false)
	const [adding, setAdding] = useState(false)
	const [addError, setAddError] = useState('')
	const [showAll, setShowAll] = useState(false)
	const [openId, setOpenId] = useState<string | null>(null)
	const [dropping, setDropping] = useState<{ title: string; creator: string; via: string } | null>(null)
	const [announce, setAnnounce] = useState('')
	const addRef = useRef<HTMLInputElement>(null)

	// Its collections keep themselves fresh while the card is shown, as their own cards would.
	useEffect(() => watchBacklog(backlogId), [backlogId])

	useOpenMenu(editor, `backlog-rename-${shape.id}`, renaming)
	useOpenMenu(editor, `backlog-add-${shape.id}`, adding)

	const change = (fn: Parameters<typeof updateBacklog>[1], said: string) => {
		updateBacklog(backlogId, fn, boardId)
		setAnnounce(said)
	}

	const commitAdd = () => {
		const line = addRef.current?.value ?? ''
		if (!line.trim()) {
			setAddError('Type a title first, and “— creator” if you know it.')
			addRef.current?.focus()
			return
		}
		change((b) => addTyped(b, line), `${line.split(/\s+[—–-]\s+/)[0]} added to ${backlog.name}.`)
		if (addRef.current) addRef.current.value = ''
		setAddError('')
		addRef.current?.focus()
	}

	/* ------------------------------------------------------- a cover dragged here from another card */

	const onDragOver = (e: DragEvent) => {
		if (!hasDraggedItem(e.dataTransfer)) return
		e.preventDefault()
		e.stopPropagation()
		e.dataTransfer.dropEffect = 'copy'
		if (!dropping) {
			const peek = draggingItem()
			setDropping({ title: peek?.entry.title ?? 'This item', creator: peek?.entry.creator ?? '', via: peek?.via ?? '' })
		}
	}
	const onDrop = (e: DragEvent) => {
		setDropping(null)
		const dragged = hasDraggedItem(e.dataTransfer) ? getDraggedItem(e.dataTransfer) : null
		if (!dragged) return
		e.preventDefault()
		e.stopPropagation()
		change((b) => addItem(b, dragged.entry, dragged.from, dragged.via), `${dragged.entry.title} added to ${backlog.name}.`)
	}

	/* ----------------------------------------------------------------------------- drawing */

	// Four rows of three at most, unless shown whole; the last cell then says how many more.
	const crowded = !showAll && backlog.entries.length > SHOWN
	const shown = crowded ? backlog.entries.slice(0, SHOWN - 1) : backlog.entries
	const more = backlog.entries.length - shown.length
	const open = backlog.entries.find((e): e is BacklogCollection => e.kind === 'collection' && e.id === openId) ?? null
	// The open collection's panel goes in after the row its tile is in.
	const openAt = open ? shown.indexOf(open) : -1
	const panelAfter = openAt < 0 ? -1 : Math.min(shown.length - 1, openAt - (openAt % 3) + 2)

	const tile = (entry: BacklogEntry, i: number) => {
		const remove = () =>
			change((b) => removeEntry(b, entry.id), `${entry.kind === 'item' ? entry.title : resolveItemSource(entry.id).name} removed from ${backlog.name}.`)
		const cell =
			entry.kind === 'item' ? (
				<ItemTile key={entry.id} item={entry} onRemove={remove} />
			) : (
				<CollectionTile key={entry.id} collection={entry} open={openId === entry.id} onToggle={() => setOpenId(openId === entry.id ? null : entry.id)} onRemove={remove} />
			)
		return i === panelAfter && open ? [cell, <CollectionPanel key="panel" collection={open} />] : [cell]
	}

	return (
		<div
			className={`lb-backlog${dropping || shapeHint ? ' lb-backlog--dropping' : ''}`}
			aria-label={backlog.name}
			onDragOver={onDragOver}
			onDragLeave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropping(null)
			}}
			onDrop={onDrop}
		>
			<header className="lb-backlog__head">
				{renaming ? (
					<input
						className="lb-backlog__name-input"
						defaultValue={backlog.name}
						maxLength={32}
						aria-label="Card name"
						autoFocus
						onFocus={(e) => e.currentTarget.select()}
						onPointerDown={swallow}
						onKeyDown={(e) => {
							e.stopPropagation()
							if (e.key === 'Enter') e.currentTarget.blur()
							if (e.key === 'Escape') {
								e.currentTarget.value = backlog.name
								e.currentTarget.blur()
							}
						}}
						onBlur={(e) => {
							setRenaming(false)
							const name = e.currentTarget.value.trim()
							if (name && name !== backlog.name) change((b) => renameBacklog(b, name), `Renamed to ${name}.`)
						}}
					/>
				) : (
					<button type="button" className="lb-backlog__name" title="Rename" onPointerDown={swallow} onClick={() => setRenaming(true)}>
						<span>{backlog.name}</span>
						<Pencil size={12} aria-hidden className="lb-backlog__pen" />
					</button>
				)}
				<span className="lb-backlog__grow" />
				<span className="lb-backlog__count" title={`Items in ${backlog.name}`}>
					{total}
				</span>
				<button
					type="button"
					className="lb-backlog__icon"
					aria-label="Add to the backlog"
					aria-expanded={adding}
					title="Add an item or a collection"
					onPointerDown={swallow}
					onClick={() => {
						setAdding(!adding)
						setAddError('')
					}}
				>
					<Plus size={16} aria-hidden />
				</button>
			</header>

			{adding && (
				<div className="lb-backlog__add" onPointerDown={swallow}>
					<label htmlFor={`${shape.id}-add`}>Add an item</label>
					<div className="lb-backlog__add-row">
						<input
							id={`${shape.id}-add`}
							ref={addRef}
							type="text"
							autoComplete="off"
							autoFocus
							placeholder="Title — creator"
							aria-invalid={addError ? true : undefined}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === 'Enter') {
									e.preventDefault()
									commitAdd()
								}
								if (e.key === 'Escape') setAdding(false)
							}}
						/>
						<button type="button" className="lb-backlog__btn lb-backlog__btn--primary" onClick={commitAdd}>
							Add
						</button>
						<button type="button" className="lb-backlog__btn" onClick={() => setAdding(false)}>
							Cancel
						</button>
					</div>
					{addError ? <span className="lb-backlog__err">{addError}</span> : <span className="lb-backlog__hint">A typed item gets a cover drawn from its title.</span>}
					<label htmlFor={`${shape.id}-collection`}>Or a whole collection</label>
					<SourceSelect
						id={`${shape.id}-collection`}
						value=""
						exclude={[BACKLOG_SOURCE_ID]}
						boardId={boardId}
						placeholder="A syllabus track, a feed, everything you liked…"
						onChange={(key) => {
							const resolved = resolveItemSource(key)
							change((b) => addCollection(b, key, resolved.source?.label ?? ''), `${resolved.name} added to ${backlog.name}.`)
						}}
					/>
				</div>
			)}

			{backlog.entries.length === 0 ? (
				<div className="lb-backlog__empty">
					<strong>Nothing here yet</strong>
					<span>Drag a cover here from a ranking, a randomizer’s last picks or another backlog, drop a syllabus track’s card on it, or add with +.</span>
				</div>
			) : (
				<div className="lb-backlog__grid" role="list" aria-label={`${backlog.name} items`}>
					{shown.flatMap(tile)}
					{more > 0 && (
						<button type="button" className="lb-backlog__tile lb-backlog__more" onPointerDown={swallow} onClick={() => setShowAll(true)}>
							<span className="lb-backlog__thumb lb-backlog__more-thumb">
								<b>+{more}</b>
								<small>more</small>
							</span>
							<span className="lb-backlog__cap">
								<span className="lb-backlog__title">Show all</span>
								<span className="lb-backlog__creator">{backlog.entries.length} in all</span>
							</span>
						</button>
					)}
					{showAll && backlog.entries.length > SHOWN && (
						<button type="button" className="lb-backlog__tile lb-backlog__more" onPointerDown={swallow} onClick={() => setShowAll(false)}>
							<span className="lb-backlog__thumb lb-backlog__more-thumb">
								<small>Show less</small>
							</span>
						</button>
					)}
				</div>
			)}

			{(dropping || shapeHint) && (
				<div className="lb-backlog__drop" aria-hidden="true">
					<span className="lb-backlog__drop-icon">
						<ArrowDown size={18} />
					</span>
					<span className="lb-backlog__drop-text">
						<b>Drop to add to {backlog.name}</b>
						{dropping ? (
							<>
								<span>
									{dropping.title}
									{dropping.creator ? ` · ${dropping.creator}` : ''}
								</span>
								{dropping.via && <small>from {dropping.via}</small>}
							</>
						) : (
							<span>{shapeHint}, as one collection</span>
						)}
					</span>
				</div>
			)}
			<p className="lb-backlog__sr" aria-live="polite">
				{announce}
			</p>
		</div>
	)
}

/** `h` is left out: auto-height writes it after every layout, and the card draws nothing from it. */
export const BacklogCard = memo(BacklogCardImpl, (prev, next) => prev.shape.id === next.shape.id && prev.shape.props.backlogId === next.shape.props.backlogId)
