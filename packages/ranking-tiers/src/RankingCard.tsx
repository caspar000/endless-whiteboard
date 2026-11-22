import { stopEventPropagation, useValue, type Editor } from '@lifeboard/canvas'
import {
	COVER_ASPECTS,
	NodeEditorPopover,
	SourceSelect,
	aspectRatio,
	boardIdOf,
	getItemStamps,
	itemRanked,
	matchesSearch,
	resolveItemSource,
	setDraggedItem,
	sourceEntries,
	useCardPopup,
	useItemCover,
	type ItemStamp,
	type NodeComponentProps,
	type NodeShape,
	type SourceEntry,
	type SourceKind,
} from '@lifeboard/node-kit'
import {
	ArrowDown,
	ArrowUp,
	ChevronDown,
	CircleHelp,
	Heart,
	Inbox,
	ListPlus,
	MoreHorizontal,
	PanelLeftClose,
	PanelLeftOpen,
	Pencil,
	Plus,
	Search,
	Settings2,
	Trash2,
	Undo2,
	X,
	type LucideIcon,
} from 'lucide-react'
import { Fragment, memo, useEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import {
	DISPLAYS,
	MAX_TIERS,
	MAX_WEIGHT,
	UNRANKED,
	addTier,
	emptyTier,
	formatOdds,
	moveItem,
	moveTier,
	nextWeight,
	rankingView,
	removeTier,
	renameTier,
	setTierLook,
	setTierWeight,
	showsStamp,
	splitUnranked,
	tierShares,
	type Band,
	type Display,
	type Ranking,
} from './model'
import { getPrefs, setPrefs } from './prefs'
import type { RankingProps } from './props'
import { QUEUE, ShelfView, type DropAt } from './ShelfView'
import { RANKING_SOURCE_ID, rankedEntries } from './source'
import { rankingOrNew, updateRanking } from './store'
import { IconGrid, Swatches, TierIcon, tierStyle } from './tierLook'

/** Clicks on the card's controls are the card's, not the canvas's: no select, no drag. */
const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** How many unranked covers the open rail, or the queue, shows before "Show more": a syllabus can hold a thousand. */
const RAIL_PAGE = 24

/** Where a cover dropped on a zone goes: the queue and the rail are both "not in a tier". */
const placeOf = (zone: string) => (zone === QUEUE ? UNRANKED : zone)

/** The pips of a die, for a weight of 1 to 5, on a 20-unit face. */
const PIPS: Record<number, Array<[number, number]>> = {
	1: [[10, 10]],
	2: [
		[6, 6],
		[14, 14],
	],
	3: [
		[6, 6],
		[10, 10],
		[14, 14],
	],
	4: [
		[6, 6],
		[14, 6],
		[6, 14],
		[14, 14],
	],
	5: [
		[6, 6],
		[14, 6],
		[10, 10],
		[6, 14],
		[14, 14],
	],
}

function Die({ weight }: { weight: number }) {
	return (
		<svg viewBox="0 0 20 20" width={18} height={18} aria-hidden="true">
			<rect x={1.5} y={1.5} width={17} height={17} rx={4} fill="none" stroke="currentColor" strokeWidth={1.5} />
			{(PIPS[weight] ?? PIPS[1]!).map(([x, y], i) => (
				<circle key={i} cx={x} cy={y} r={1.6} fill="currentColor" />
			))}
		</svg>
	)
}

/** The marks the stamps the randomizer gives wear on a badge; any other kind wears its first letter. */
const BADGE_MARKS: Record<string, LucideIcon> = { liked: Heart, disliked: X, unsure: CircleHelp }

/** A cover's latest stamp, as a small round badge in its ink (DARK-13). */
function Badge({ stamp }: { stamp: { kind: string; label: string; ink: string } }) {
	const Mark = BADGE_MARKS[stamp.kind]
	return (
		<span className="lb-rank__badge" style={{ '--lb-rank-ink': stamp.ink } as CSSProperties} title={stamp.label} aria-hidden="true">
			{Mark ? <Mark size={10} strokeWidth={2.6} /> : stamp.label.charAt(0)}
		</span>
	)
}

/** One cover: its picture, title and creator. Dragged anywhere: between tiers, onto a shelf, or onto a backlog. */
function Cover({
	entry,
	shape,
	small = false,
	bare = false,
	tier,
	badge,
	settling = false,
	z,
	onSettled,
	onDragStart,
	onKey,
}: {
	entry: SourceEntry
	shape: SourceKind['shape']
	small?: boolean
	/** The picture alone, as on a shelf: its title goes in a tooltip. */
	bare?: boolean
	tier: string
	/** Its latest stamp, when the ranking shows badges. */
	badge?: { kind: string; label: string; ink: string } | null
	/** Just dropped: it settles into place with a small wobble. */
	settling?: boolean
	/** Its place in a pile (the crate), front highest. */
	z?: number
	onSettled: () => void
	onDragStart: (e: DragEvent, entry: SourceEntry) => void
	onKey: (e: KeyboardEvent, entry: SourceEntry, tier: string) => void
}) {
	const url = useItemCover(entry, shape)
	const label = `${entry.title}${entry.creator ? `, ${entry.creator}` : ''}${badge ? `. Stamped ${badge.label}` : ''}`
	const className = ['lb-rank__cover', small && 'lb-rank__cover--small', bare && 'lb-rank__cover--bare', settling && 'lb-rank__cover--settle'].filter(Boolean).join(' ')
	return (
		<div
			className={className}
			data-item-id={entry.id}
			draggable
			tabIndex={0}
			role="listitem"
			aria-roledescription="draggable cover"
			aria-label={`${label}. Drag, or press up and down to change tier, left and right to reorder.`}
			title={small || bare ? label : undefined}
			style={z === undefined ? undefined : { zIndex: z }}
			onPointerDown={swallow}
			onDragStart={(e) => onDragStart(e, entry)}
			onKeyDown={(e) => onKey(e, entry, tier)}
			onAnimationEnd={settling ? onSettled : undefined}
		>
			<span className="lb-rank__frame">
				<img className="lb-rank__art" src={url} alt="" draggable={false} loading="lazy" />
				{badge && <Badge stamp={badge} />}
			</span>
			{!small && !bare && (
				<span className="lb-rank__cap">
					<span className="lb-rank__title">{entry.title}</span>
					{entry.creator && <span className="lb-rank__creator">{entry.creator}</span>}
				</span>
			)}
		</div>
	)
}

/** Tells the board a menu or a field is open, so its own keys stand aside while you type. */
function useOpenMenu(editor: Editor, id: string, open: boolean) {
	useEffect(() => {
		if (!open) return
		editor.addOpenMenu(id)
		return () => {
			editor.deleteOpenMenu(id)
		}
	}, [editor, id, open])
}

function RankingCardImpl({ shape, isEditing, editor }: NodeComponentProps<RankingProps>) {
	const { rankingId } = shape.props
	// The board this card is on (DARK-14): a ranking made here belongs to it, and reads its stamps.
	const boardId = boardIdOf(editor)
	const ranking = useValue('lifeboard:ranking', () => rankingOrNew(rankingId, boardId), [rankingId, boardId])
	const percent = useValue('lifeboard:ranking-percent', () => getPrefs().percent, [])
	const source = useValue(
		'lifeboard:ranking-source',
		() => {
			const resolved = resolveItemSource(ranking.source)
			const ranked = resolved.type === 'source' ? rankedEntries(ranking) : { entries: [], stamps: new Map<string, ItemStamp>() }
			return { ...resolved, ...ranked, stampKinds: getItemStamps() }
		},
		[ranking]
	)
	const view = rankingView(ranking, source.entries)
	const shares = tierShares(view.bands)
	const kind = source.kind
	const stampSource = source.stampKinds?.sourceId ?? null
	// What isn't in a tier: stamped and shown waits in the queue, never stamped in the rail (DARK-14).
	const { queue, rail } = splitUnranked(view.unranked, (entry) => source.stamps.get(entry.id), (k) => showsStamp(ranking, k, stampSource))
	const display: Display = ranking.display === 'shelf' ? 'shelf' : 'tiers'

	const [railOpen, setRailOpen] = useState(false)
	const [railShown, setRailShown] = useState(RAIL_PAGE)
	const [queueShown, setQueueShown] = useState(RAIL_PAGE)
	const [query, setQuery] = useState('')
	const [searching, setSearching] = useState(false)
	const [renaming, setRenaming] = useState<string | null>(null)
	const [menu, setMenu] = useState<'settings' | { tier: string } | null>(null)
	const [dropAt, setDropAt] = useState<DropAt | null>(null)
	const [settling, setSettling] = useState<string | null>(null)
	const [announce, setAnnounce] = useState('')
	const dragging = useRef<string | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const focusNext = useRef<string | null>(null)

	// A menu draws past the card's edge while it is open, rather than being cut off by it.
	useCardPopup(editor, shape.id, menu !== null)
	useOpenMenu(editor, `ranking-rename-${shape.id}`, renaming !== null)
	useOpenMenu(editor, `ranking-search-${shape.id}`, searching)

	// A source that keeps itself fresh (a feed reading its channels) does so while a card shows it.
	const { source: watched, choiceId } = source
	useEffect(() => (watched ? watched.watch?.(choiceId) : undefined), [watched, choiceId])

	// A cover moved by the keyboard keeps the focus, wherever it went.
	useEffect(() => {
		const id = focusNext.current
		if (!id) return
		focusNext.current = null
		Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])
			.find((el) => el.dataset.itemId === id)
			?.focus()
	})

	// Menus close on a click anywhere else, and on Escape.
	useEffect(() => {
		if (!menu) return
		const close = (e: PointerEvent) => {
			if (!(e.target as Element).closest?.('.lb-rank__pop, .lb-rank__menu-btn')) setMenu(null)
		}
		const escape = (e: globalThis.KeyboardEvent) => {
			if (e.key === 'Escape') setMenu(null)
		}
		document.addEventListener('pointerdown', close, true)
		document.addEventListener('keydown', escape, true)
		return () => {
			document.removeEventListener('pointerdown', close, true)
			document.removeEventListener('keydown', escape, true)
		}
	}, [menu])

	const change = (fn: (r: Ranking) => Ranking | null, said?: string) => {
		updateRanking(rankingId, fn, boardId)
		if (said) setAnnounce(said)
	}
	/**
	 * A move, said aloud. An item that goes from Unranked (the queue or the rail) into a tier is ranked:
	 * the other extensions hear of it (DARK-13), so it is ticked in its syllabus, and stamped Liked only
	 * if nothing has stamped it yet (DARK-14). Between tiers, nothing is said to anyone.
	 */
	const move = (entry: SourceEntry, from: string, to: string, beforeId: string | null, said?: string) => {
		change((r) => moveItem(r, entry.id, to, beforeId), said)
		if (from === UNRANKED && to !== UNRANKED) itemRanked({ entry, from: ranking.source, rankingId, boardId: ranking.boardId || boardId, editor, shapeId: shape.id })
	}
	const tierName = (id: string) => (id === UNRANKED ? 'Unranked' : id === QUEUE ? 'the rank queue' : (ranking.tiers.find((t) => t.id === id)?.name ?? ''))

	const chooseSource = () => {
		setMenu(null)
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
	}

	/* ------------------------------------------------------------------- moving covers about */

	const onDragStart = (e: DragEvent, entry: SourceEntry) => {
		e.stopPropagation()
		dragging.current = entry.id
		setDraggedItem(e.dataTransfer, { entry, from: ranking.source, via: source.source?.label ?? '' })
		e.dataTransfer.effectAllowed = 'copyMove'
	}

	useEffect(() => {
		const end = () => {
			dragging.current = null
			setDropAt(null)
		}
		document.addEventListener('dragend', end)
		return () => document.removeEventListener('dragend', end)
	}, [])

	/** Where over this zone's covers the pointer is: before the first cover it is above or left of. */
	const dropTarget = (e: DragEvent, tier: string): DropAt => {
		const zone = e.currentTarget as HTMLElement
		const covers = Array.from(zone.querySelectorAll<HTMLElement>('.lb-rank__cover')).filter((c) => c.dataset.itemId !== dragging.current)
		const before = covers.find((c) => {
			const r = c.getBoundingClientRect()
			return e.clientY < r.top || (e.clientY <= r.bottom && e.clientX < r.left + r.width / 2)
		})
		return { tier, beforeId: placeOf(tier) === UNRANKED ? null : (before?.dataset.itemId ?? null) }
	}

	const zoneProps = (tier: string) => ({
		onDragOver: (e: DragEvent) => {
			if (!dragging.current) return
			e.preventDefault()
			e.stopPropagation()
			e.dataTransfer.dropEffect = 'move'
			const at = dropTarget(e, tier)
			if (at.tier !== dropAt?.tier || at.beforeId !== dropAt?.beforeId) setDropAt(at)
		},
		onDragLeave: (e: DragEvent) => {
			if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) setDropAt((at) => (at?.tier === tier ? null : at))
		},
		onDrop: (e: DragEvent) => {
			const id = dragging.current
			if (!id) return
			e.preventDefault()
			e.stopPropagation()
			const at = dropTarget(e, tier)
			dragging.current = null
			setDropAt(null)
			const entry = source.entries.find((en) => en.id === id)
			if (!entry) return
			const from = view.unranked.some((en) => en.id === id) ? UNRANKED : 'tier'
			move(entry, from, placeOf(at.tier), at.beforeId, `${entry.title} moved to ${tierName(at.tier)}.`)
			setSettling(entry.id)
		},
	})

	/** Up and down change tier (the queue is above the first, the rail below the last), left and right reorder within one. */
	const onKey = (e: KeyboardEvent, entry: SourceEntry, tier: string) => {
		if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
		e.preventDefault()
		e.stopPropagation()
		const zones = [QUEUE, ...ranking.tiers.map((t) => t.id), UNRANKED]
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			if (placeOf(tier) === UNRANKED) return
			const items = view.bands.find((b) => b.tier.id === tier)?.items ?? []
			const at = items.findIndex((i) => i.id === entry.id)
			const before = e.key === 'ArrowLeft' ? items[at - 1] : items[at + 2]
			if (e.key === 'ArrowLeft' && at <= 0) return
			if (e.key === 'ArrowRight' && at >= items.length - 1) return
			focusNext.current = entry.id
			change((r) => moveItem(r, entry.id, tier, before?.id ?? null))
			return
		}
		const to = zones[zones.indexOf(tier) + (e.key === 'ArrowDown' ? 1 : -1)]
		if (!to || placeOf(to) === placeOf(tier)) return
		if (to === UNRANKED && !source.stamps.has(entry.id)) setRailOpen(true)
		focusNext.current = entry.id
		move(entry, placeOf(tier), placeOf(to), null, `${entry.title} moved to ${tierName(to)}.`)
	}

	/* ----------------------------------------------------------------------------- drawing */

	const kinds = source.stampKinds?.kinds ?? []
	const badgeOf = (entry: SourceEntry) => {
		if (!ranking.badges) return null
		const stamp = source.stamps.get(entry.id)
		const info = stamp && kinds.find((k) => k.id === stamp.kind)
		return info ? { kind: info.id, label: info.label, ink: info.ink } : null
	}
	const cover = (entry: SourceEntry, tier: string, extra: { small?: boolean; bare?: boolean; z?: number } = {}) => (
		<Cover
			key={entry.id}
			entry={entry}
			tier={tier}
			shape={kind.shape}
			badge={badgeOf(entry)}
			settling={settling === entry.id}
			onSettled={() => setSettling(null)}
			onDragStart={onDragStart}
			onKey={onKey}
			{...extra}
		/>
	)
	const caret = <span className="lb-rank__caret" aria-hidden="true" />

	/** A tier's ⋯ and its menu: rename, its look, move it, empty it, remove it. */
	const tierMenu = ({ tier, items }: Band, i: number) => {
		const open = typeof menu === 'object' && menu?.tier === tier.id
		return (
			<>
				<button
					type="button"
					className="lb-rank__icon lb-rank__menu-btn"
					aria-label={`${tier.name} options`}
					aria-haspopup="menu"
					aria-expanded={open}
					onPointerDown={swallow}
					onClick={() => setMenu(open ? null : { tier: tier.id })}
				>
					<MoreHorizontal size={16} aria-hidden />
				</button>
				{open && (
					<div className="lb-rank__pop lb-rank__tier-menu" role="menu" data-card-popup onPointerDown={swallow}>
						<button type="button" role="menuitem" onClick={() => (setMenu(null), setRenaming(tier.id))}>
							<Pencil size={14} aria-hidden /> Rename
						</button>
						<div className="lb-rank__look">
							<span className="lb-rank__look-label">Background</span>
							<Swatches label={`${tier.name} background`} value={tier.color} onPick={(color) => change((r) => setTierLook(r, tier.id, { color }))} />
							<span className="lb-rank__look-label">Border</span>
							<Swatches label={`${tier.name} border`} value={tier.border} onPick={(border) => change((r) => setTierLook(r, tier.id, { border }))} />
							<span className="lb-rank__look-label">Icon</span>
							<IconGrid value={tier.icon} onPick={(icon) => change((r) => setTierLook(r, tier.id, { icon }))} />
						</div>
						<button type="button" role="menuitem" disabled={i === 0} onClick={() => (setMenu(null), change((r) => moveTier(r, tier.id, -1), `${tier.name} moved up.`))}>
							<ArrowUp size={14} aria-hidden /> Move up
						</button>
						<button
							type="button"
							role="menuitem"
							disabled={i === ranking.tiers.length - 1}
							onClick={() => (setMenu(null), change((r) => moveTier(r, tier.id, 1), `${tier.name} moved down.`))}
						>
							<ArrowDown size={14} aria-hidden /> Move down
						</button>
						<button
							type="button"
							role="menuitem"
							disabled={items.length === 0}
							onClick={() => (setMenu(null), change((r) => emptyTier(r, tier.id), `${tier.name} emptied. Its ${kind.noun} are unranked again.`))}
						>
							<Undo2 size={14} aria-hidden /> Take all off this tier
						</button>
						<button
							type="button"
							role="menuitem"
							className="lb-rank__danger"
							disabled={ranking.tiers.length <= 1}
							title={ranking.tiers.length <= 1 ? 'A ranking keeps one tier at least' : undefined}
							onClick={() => (setMenu(null), change((r) => removeTier(r, tier.id), `${tier.name} removed. Its ${kind.noun} are unranked.`))}
						>
							<Trash2 size={14} aria-hidden /> Remove tier
						</button>
					</div>
				)}
			</>
		)
	}

	const band = (b: Band, i: number) => {
		const { tier, items } = b
		const target = dropAt?.tier === tier.id
		return (
			<section
				key={tier.id}
				className={`lb-rank__band${target ? ' lb-rank__band--target' : ''}${tier.color ? ' lb-rank__band--colored' : ''}${tier.border ? ' lb-rank__band--bordered' : ''}`}
				style={tierStyle(tier, i)}
				aria-label={`${tier.name} tier`}
				{...zoneProps(tier.id)}
			>
				<div className="lb-rank__band-head">
					<TierIcon id={tier.icon} />
					{renaming === tier.id ? (
						<input
							className="lb-rank__name-input"
							defaultValue={tier.name}
							maxLength={32}
							aria-label="Tier name"
							autoFocus
							onFocus={(e) => e.currentTarget.select()}
							onPointerDown={swallow}
							onKeyDown={(e) => {
								e.stopPropagation()
								if (e.key === 'Enter') e.currentTarget.blur()
								if (e.key === 'Escape') {
									e.currentTarget.value = tier.name
									e.currentTarget.blur()
								}
							}}
							onBlur={(e) => {
								setRenaming(null)
								const name = e.currentTarget.value.trim()
								if (name && name !== tier.name) change((r) => renameTier(r, tier.id, name), `Tier renamed to ${name}.`)
							}}
						/>
					) : (
						<button type="button" className="lb-rank__name" title="Rename" onPointerDown={swallow} onClick={() => setRenaming(tier.id)}>
							<span>{tier.name}</span>
							<Pencil size={12} aria-hidden className="lb-rank__pen" />
						</button>
					)}
					{ranking.weighted && (
						<button
							type="button"
							className="lb-rank__die"
							aria-label={`${tier.name} weight ${tier.weight} of ${MAX_WEIGHT}. Change weight`}
							title={`Weight ×${tier.weight}: click to change`}
							onPointerDown={swallow}
							onClick={() => {
								const next = nextWeight(tier.weight)
								change((r) => setTierWeight(r, tier.id, next), `${tier.name} weight set to ${next}.`)
							}}
						>
							<Die weight={tier.weight} />
						</button>
					)}
					<span className="lb-rank__n">{items.length}</span>
					<span className="lb-rank__grow" />
					{ranking.weighted && (
						<span className="lb-rank__odds" title="The chance this tier wins a draw">
							{formatOdds(shares[i] ?? 0, percent)}
						</span>
					)}
					{tierMenu(b, i)}
				</div>
				{ranking.weighted && (
					<div className="lb-rank__share" aria-hidden="true">
						<i style={{ width: `${((shares[i] ?? 0) * 100).toFixed(1)}%` }} />
					</div>
				)}
				<div className="lb-rank__covers" role="list" aria-label={tier.name}>
					{items.map((entry) => (
						<Fragment key={entry.id}>
							{target && dropAt?.beforeId === entry.id && caret}
							{cover(entry, tier.id)}
						</Fragment>
					))}
					{target && dropAt?.beforeId === null && items.length > 0 && caret}
					{items.length === 0 && <span className="lb-rank__empty-band">Drop covers here</span>}
				</div>
			</section>
		)
	}

	/** The queue as a strip above the tiers: what you stamped, waiting to be put in one. */
	const queueStrip = (
		<section className={dropAt?.tier === QUEUE ? 'lb-rank__queue lb-rank__queue--target' : 'lb-rank__queue'} aria-label={`Rank queue, ${queue.length} waiting`} {...zoneProps(QUEUE)}>
			<div className="lb-rank__queue-head">
				<Inbox size={14} aria-hidden />
				<span className="lb-rank__queue-name">Rank queue</span>
				<span className="lb-rank__n">{queue.length}</span>
				<span className="lb-rank__queue-hint">{queue.length ? 'Drag into a tier' : `What you stamp lands here`}</span>
			</div>
			{queue.length > 0 && (
				<div className="lb-rank__covers lb-rank__queue-list" role="list" aria-label="Rank queue">
					{queue.slice(0, queueShown).map((entry) => cover(entry, QUEUE))}
					{queue.length > queueShown && (
						<button type="button" className="lb-rank__rail-more" onPointerDown={swallow} onClick={() => setQueueShown(queueShown + RAIL_PAGE)}>
							+{queue.length - queueShown}
						</button>
					)}
				</div>
			)}
		</section>
	)

	const settingsOpen = menu === 'settings'
	const canAdd = ranking.tiers.length < MAX_TIERS
	// What the card shows: in tiers, waiting in the queue, or in the rail. Covers of a stamp switched off are not counted.
	const total = view.bands.reduce((n, b) => n + b.items.length, 0) + queue.length + rail.length
	const railShownList = query ? rail.filter((entry) => matchesSearch(entry, query)) : rail
	// A cover of another shape keeps about the area of a square one: wider and shorter, or narrower and taller.
	const ratio = aspectRatio(ranking.aspect)
	const coverPx = ratio ? Math.round(80 * Math.sqrt(ratio)) : 80
	const shapeStyle = ratio
		? ({
				'--lb-rank-aspect': ratio,
				'--lb-col-cover': `${coverPx}px`,
				'--lb-rank-small': `${Math.round(40 * Math.sqrt(ratio))}px`,
			} as CSSProperties)
		: undefined
	const setDisplay = (next: Display) => next !== display && change((r) => ({ ...r, display: next }), `Shown as ${next === 'shelf' ? 'a shelf' : 'tiers'}.`)

	return (
		<div className={`lb-rank lb-rank--${display}${ratio ? ' lb-rank--shaped' : ''}`} style={shapeStyle} ref={rootRef} aria-label="Ranking tiers">
			<header className="lb-rank__head">
				<button
					type="button"
					className={source.type === 'none' ? 'lb-rank__source lb-rank__source--empty' : 'lb-rank__source'}
					aria-haspopup="dialog"
					aria-label={source.type === 'none' ? 'Choose what to rank' : `Ranking ${source.name}. Change the source`}
					title="Choose what this card ranks"
					onPointerDown={swallow}
					onClick={chooseSource}
				>
					{source.type === 'none' ? <ListPlus size={14} aria-hidden /> : source.source?.icon ? <source.source.icon size={14} aria-hidden /> : null}
					<span className="lb-rank__source-name">{source.type === 'none' ? 'Choose what to rank' : source.name}</span>
					<ChevronDown size={14} aria-hidden />
				</button>
				{source.type === 'source' && (
					<span className="lb-rank__count">
						{total} {total === 1 ? kind.one : kind.noun}
					</span>
				)}
				<span className="lb-rank__grow" />
				<div className="lb-rank__seg" role="group" aria-label="Display">
					{DISPLAYS.map((d) => (
						<button key={d.id} type="button" aria-pressed={display === d.id} onPointerDown={swallow} onClick={() => setDisplay(d.id)}>
							{d.label}
						</button>
					))}
				</div>
				<button
					type="button"
					className="lb-rank__icon"
					aria-label="Add a tier"
					title={canAdd ? 'Add a tier' : `${MAX_TIERS} tiers is the most a ranking has`}
					aria-disabled={!canAdd}
					onPointerDown={swallow}
					onClick={() => {
						if (!canAdd) return
						change((r) => addTier(r, 'New tier'), 'Added a tier, “New tier”, at the bottom.')
						setRenaming(null)
					}}
				>
					<Plus size={16} aria-hidden />
				</button>
				<button
					type="button"
					className="lb-rank__icon lb-rank__menu-btn"
					aria-label="Ranking settings"
					aria-haspopup="dialog"
					aria-expanded={settingsOpen}
					onPointerDown={swallow}
					onClick={() => setMenu(settingsOpen ? null : 'settings')}
				>
					<Settings2 size={16} aria-hidden />
				</button>
				{settingsOpen && (
					<div className="lb-rank__pop lb-rank__settings" role="dialog" data-card-popup aria-label="Ranking settings" onPointerDown={swallow} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
						<label className="lb-rank__field">
							<span>Name</span>
							<input
								defaultValue={ranking.name}
								placeholder={source.type === 'source' ? `${source.name}, ranked` : 'A ranking'}
								maxLength={48}
								onBlur={(e) => {
									const name = e.currentTarget.value.trim()
									if (name !== ranking.name) change((r) => ({ ...r, name }))
								}}
								onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
							/>
						</label>
						<label className="lb-rank__field">
							<span>Display</span>
							<select value={display} onChange={(e) => setDisplay(e.target.value as Display)}>
								{DISPLAYS.map((d) => (
									<option key={d.id} value={d.id}>
										{d.id === 'shelf' ? 'Shelf: a bookcase, one shelf a tier' : 'Tiers: banded rows'}
									</option>
								))}
							</select>
						</label>
						{kinds.length > 0 && (
							<fieldset className="lb-rank__stamps">
								<legend>Rank queue shows</legend>
								<small className="lb-rank__stamps-hint">What you stamp on a randomizer waits in the queue until you drag it into a tier. Covers already in a tier always stay.</small>
								{kinds.map((k) => (
									<label key={k.id} className="lb-rank__switch" style={{ '--lb-rank-ink': k.ink } as CSSProperties}>
										<span className="lb-rank__switch-dot" aria-hidden="true" />
										<span className="lb-rank__switch-name">{k.label}</span>
										<input
											type="checkbox"
											role="switch"
											checked={showsStamp(ranking, k.id, stampSource)}
											onChange={(e) => change((r) => ({ ...r, stampFilter: { ...r.stampFilter, [k.id]: e.target.checked } }))}
										/>
									</label>
								))}
							</fieldset>
						)}
						<label className="lb-rank__check">
							<input type="checkbox" checked={ranking.weighted} onChange={(e) => change((r) => ({ ...r, weighted: e.target.checked }))} />
							<span>
								<b>Weighted shuffle</b>
								<small>Each tier gets a weight, and a randomizer can draw from this ranking by it: heavier tiers come up more often.</small>
							</span>
						</label>
						{ranking.weighted && (
							<label className="lb-rank__check">
								<input type="checkbox" checked={percent} onChange={(e) => setPrefs({ percent: e.target.checked })} />
								<span>
									<b>Odds as percentages</b>
									<small>“20%” rather than “1 in 5”, on every ranking.</small>
								</span>
							</label>
						)}
						<label className="lb-rank__field">
							<span>Cover shape</span>
							<select value={ranking.aspect} onChange={(e) => change((r) => ({ ...r, aspect: e.target.value }))}>
								{COVER_ASPECTS.map((a) => (
									<option key={a.id} value={a.id}>
										{a.id ? a.label : 'Square (auto)'}
									</option>
								))}
							</select>
						</label>
						{kinds.length > 0 && (
							<label className="lb-rank__check">
								<input type="checkbox" checked={ranking.badges} onChange={(e) => change((r) => ({ ...r, badges: e.target.checked }))} />
								<span>
									<b>Stamp badges</b>
									<small>Each stamped cover wears its latest stamp.</small>
								</span>
							</label>
						)}
					</div>
				)}
			</header>

			{source.type !== 'source' ? (
				<div className="lb-rank__empty">
					<strong>{source.type === 'missing' ? 'What this ranked is gone' : 'Nothing to rank yet'}</strong>
					<span>
						{source.type === 'missing'
							? 'Choose another source from the menu above.'
							: 'Choose a source above: an album list, a backlog, a feed, a syllabus. What you stamp from it on a randomizer waits in the queue, to drag into tiers.'}
					</span>
				</div>
			) : (
				<div className="lb-rank__body">
					<aside
						className={`lb-rank__rail${railOpen ? ' lb-rank__rail--open' : ''}${dropAt?.tier === UNRANKED ? ' lb-rank__rail--target' : ''}`}
						aria-label="Unranked"
						{...zoneProps(UNRANKED)}
					>
						<button
							type="button"
							className="lb-rank__rail-toggle"
							aria-expanded={railOpen}
							aria-label={`Unranked, ${rail.length}. ${railOpen ? 'Collapse' : 'Expand'}`}
							onPointerDown={swallow}
							onClick={() => setRailOpen(!railOpen)}
						>
							{railOpen ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
							<span className="lb-rank__rail-n">{rail.length}</span>
							<span className="lb-rank__rail-label">Unranked</span>
						</button>
						{railOpen && rail.length > 0 && (
							<label className="lb-rank__search">
								<Search size={12} aria-hidden />
								<input
									type="search"
									value={query}
									placeholder="Search"
									aria-label="Search unranked"
									onPointerDown={swallow}
									onFocus={() => setSearching(true)}
									onBlur={() => setSearching(false)}
									onChange={(e) => {
										setQuery(e.target.value)
										setRailShown(RAIL_PAGE)
									}}
									onKeyDown={(e) => {
										e.stopPropagation()
										if (e.key === 'Escape') {
											if (query) setQuery('')
											else e.currentTarget.blur()
										}
									}}
								/>
							</label>
						)}
						{railOpen && (
							<div className="lb-rank__rail-list" role="list" aria-label="Unranked">
								{railShownList.slice(0, railShown).map((entry) => cover(entry, UNRANKED, { small: true }))}
								{railShownList.length > railShown && (
									<button type="button" className="lb-rank__rail-more" onPointerDown={swallow} onClick={() => setRailShown(railShown + RAIL_PAGE)}>
										+{railShownList.length - railShown}
									</button>
								)}
								{rail.length === 0 && <span className="lb-rank__rail-empty">{queue.length ? 'The rest wait in the queue' : 'All sorted'}</span>}
								{rail.length > 0 && railShownList.length === 0 && <span className="lb-rank__rail-empty">Nothing matches</span>}
							</div>
						)}
					</aside>
					{display === 'shelf' ? (
						<ShelfView
							bands={view.bands}
							queue={queue}
							kind={kind}
							coverPx={coverPx}
							dropAt={dropAt}
							zoneProps={zoneProps}
							renderCover={(entry, zone, z) => cover(entry, zone, { bare: true, z })}
							tierMenu={tierMenu}
							hasStamps={kinds.length > 0}
						/>
					) : (
						<div className="lb-rank__bands">
							{kinds.length > 0 && queueStrip}
							{view.bands.map(band)}
						</div>
					)}
				</div>
			)}
			<p className="lb-rank__sr" aria-live="polite">
				{announce}
			</p>

			{isEditing && (
				<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation}>
					<SourcePicker shape={shape} editor={editor} ranking={ranking} boardId={boardId} />
				</div>
			)}
		</div>
	)
}

/** The card's editor (a double-click, or the source button): what it ranks. */
function SourcePicker({ shape, editor, ranking, boardId }: { shape: NodeShape<RankingProps>; editor: Editor; ranking: Ranking; boardId: string }) {
	const count = useValue('lifeboard:ranking-picker', () => sourceEntries(ranking.source).length, [ranking.source])
	const kind = resolveItemSource(ranking.source).kind
	return (
		<NodeEditorPopover shape={shape} editor={editor} width={360} side="right">
			<div className="lb-rank-editor">
				<label className="lb-rank-editor__label" htmlFor={`${shape.id}-source`}>
					Rank from
				</label>
				<SourceSelect
					id={`${shape.id}-source`}
					value={ranking.source}
					exclude={[RANKING_SOURCE_ID]}
					boardId={boardId}
					autoFocus
					onChange={(key) => updateRanking(ranking.rankingId, (r) => ({ ...r, source: key }), boardId)}
				/>
				<p className="lb-rank-editor__hint">
					{ranking.source
						? `${count} ${count === 1 ? kind.one : kind.noun}. Each source keeps its own tiers: switch back, and they are as you left them.`
						: 'Anything the other extensions offer on this board: an album list, a backlog, a feed, a syllabus, or what you stamped on a randomizer.'}
				</p>
				<div className="lb-rank-editor__foot">
					<button type="button" className="lb-rank-editor__done" onClick={() => editor.setEditingShape(null)}>
						Done
					</button>
				</div>
			</div>
		</NodeEditorPopover>
	)
}

/** `h` is left out: auto-height writes it after every layout, and the card draws nothing from it. */
export const RankingCard = memo(
	RankingCardImpl,
	(prev, next) => prev.isEditing === next.isEditing && prev.shape.id === next.shape.id && prev.shape.props.rankingId === next.shape.props.rankingId
)
