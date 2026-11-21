import { stopEventPropagation, useValue, type Editor } from '@lifeboard/canvas'
import {
	NodeEditorPopover,
	SourceSelect,
	resolveItemSource,
	setDraggedItem,
	sourceEntries,
	useItemCover,
	type NodeComponentProps,
	type NodeShape,
	type SourceEntry,
	type SourceKind,
} from '@lifeboard/node-kit'
import { ArrowDown, ArrowUp, ChevronDown, ListPlus, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Settings2, Trash2 } from 'lucide-react'
import { Fragment, memo, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type SyntheticEvent } from 'react'
import {
	MAX_TIERS,
	MAX_WEIGHT,
	UNRANKED,
	addTier,
	formatOdds,
	moveItem,
	moveTier,
	nextWeight,
	rankingView,
	removeTier,
	renameTier,
	setTierWeight,
	tierShares,
	type Band,
	type Ranking,
} from './model'
import { getPrefs, setPrefs } from './prefs'
import type { RankingProps } from './props'
import { RANKING_SOURCE_ID } from './source'
import { rankingOrNew, updateRanking } from './store'

/** Clicks on the card's controls are the card's, not the canvas's: no select, no drag. */
const swallow = (e: SyntheticEvent) => e.stopPropagation()

/** How many unranked covers the open rail shows before "Show more": a syllabus can hold a thousand. */
const RAIL_PAGE = 24

/** Where a drag over the card would put the item: a tier (or the rail), before an item or at the end. */
interface DropAt {
	tier: string
	beforeId: string | null
}

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

/** One cover: its picture, title and creator. Dragged anywhere: between tiers, or onto a backlog. */
function Cover({
	entry,
	shape,
	small = false,
	tier,
	onDragStart,
	onKey,
}: {
	entry: SourceEntry
	shape: SourceKind['shape']
	small?: boolean
	tier: string
	onDragStart: (e: DragEvent, entry: SourceEntry) => void
	onKey: (e: KeyboardEvent, entry: SourceEntry, tier: string) => void
}) {
	const url = useItemCover(entry, shape)
	const label = `${entry.title}${entry.creator ? `, ${entry.creator}` : ''}`
	return (
		<div
			className={small ? 'lb-rank__cover lb-rank__cover--small' : 'lb-rank__cover'}
			data-item-id={entry.id}
			draggable
			tabIndex={0}
			role="listitem"
			aria-roledescription="draggable cover"
			aria-label={`${label}. Drag, or press up and down to change tier, left and right to reorder.`}
			title={small ? label : undefined}
			onPointerDown={swallow}
			onDragStart={(e) => onDragStart(e, entry)}
			onKeyDown={(e) => onKey(e, entry, tier)}
		>
			<img className="lb-rank__art" src={url} alt="" draggable={false} loading="lazy" />
			{!small && (
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
	const ranking = useValue('lifeboard:ranking', () => rankingOrNew(rankingId), [rankingId])
	const percent = useValue('lifeboard:ranking-percent', () => getPrefs().percent, [])
	const source = useValue(
		'lifeboard:ranking-source',
		() => {
			const resolved = resolveItemSource(ranking.source)
			return { ...resolved, entries: resolved.type === 'source' ? sourceEntries(ranking.source) : [] }
		},
		[ranking.source]
	)
	const view = rankingView(ranking, source.entries)
	const shares = tierShares(view.bands)
	const kind = source.kind

	const [railOpen, setRailOpen] = useState(false)
	const [railShown, setRailShown] = useState(RAIL_PAGE)
	const [renaming, setRenaming] = useState<string | null>(null)
	const [menu, setMenu] = useState<'settings' | { tier: string } | null>(null)
	const [dropAt, setDropAt] = useState<DropAt | null>(null)
	const [announce, setAnnounce] = useState('')
	const dragging = useRef<string | null>(null)
	const rootRef = useRef<HTMLDivElement>(null)
	const focusNext = useRef<string | null>(null)

	useOpenMenu(editor, `ranking-menu-${shape.id}`, menu !== null)
	useOpenMenu(editor, `ranking-rename-${shape.id}`, renaming !== null)

	// A source that keeps itself fresh (a feed reading its channels) does so while a card shows it.
	const { source: watched, choiceId } = source
	useEffect(() => (watched ? watched.watch?.(choiceId) : undefined), [watched, choiceId])

	// A cover moved by the keyboard keeps the focus, wherever it went.
	useEffect(() => {
		const id = focusNext.current
		if (!id) return
		focusNext.current = null
		rootRef.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`)?.focus()
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
		updateRanking(rankingId, fn)
		if (said) setAnnounce(said)
	}
	const tierName = (id: string) => (id === UNRANKED ? 'Unranked' : (ranking.tiers.find((t) => t.id === id)?.name ?? ''))

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
		return { tier, beforeId: tier === UNRANKED ? null : (before?.dataset.itemId ?? null) }
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
			const title = source.entries.find((entry) => entry.id === id)?.title ?? 'It'
			change((r) => moveItem(r, id, at.tier, at.beforeId), `${title} moved to ${tierName(at.tier)}.`)
		},
	})

	/** Up and down change tier (the rail is below the last), left and right reorder within one. */
	const onKey = (e: KeyboardEvent, entry: SourceEntry, tier: string) => {
		if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return
		e.preventDefault()
		e.stopPropagation()
		const zones = [...ranking.tiers.map((t) => t.id), UNRANKED]
		if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			if (tier === UNRANKED) return
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
		if (!to) return
		if (to === UNRANKED) setRailOpen(true)
		focusNext.current = entry.id
		change((r) => moveItem(r, entry.id, to), `${entry.title} moved to ${tierName(to)}.`)
	}

	/* ----------------------------------------------------------------------------- drawing */

	const coverProps = { shape: kind.shape, onDragStart, onKey }
	const caret = <span className="lb-rank__caret" aria-hidden="true" />

	const band = ({ tier, items }: Band, i: number) => {
		const target = dropAt?.tier === tier.id
		return (
			<section key={tier.id} className={target ? 'lb-rank__band lb-rank__band--target' : 'lb-rank__band'} aria-label={`${tier.name} tier`} {...zoneProps(tier.id)}>
				<div className="lb-rank__band-head">
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
					<button
						type="button"
						className="lb-rank__icon lb-rank__menu-btn"
						aria-label={`${tier.name} options`}
						aria-haspopup="menu"
						aria-expanded={typeof menu === 'object' && menu?.tier === tier.id}
						onPointerDown={swallow}
						onClick={() => setMenu(typeof menu === 'object' && menu?.tier === tier.id ? null : { tier: tier.id })}
					>
						<MoreHorizontal size={16} aria-hidden />
					</button>
					{typeof menu === 'object' && menu?.tier === tier.id && (
						<div className="lb-rank__pop lb-rank__tier-menu" role="menu" onPointerDown={swallow}>
							<button type="button" role="menuitem" onClick={() => (setMenu(null), setRenaming(tier.id))}>
								<Pencil size={14} aria-hidden /> Rename
							</button>
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
								className="lb-rank__danger"
								disabled={ranking.tiers.length <= 1}
								title={ranking.tiers.length <= 1 ? 'A ranking keeps one tier at least' : undefined}
								onClick={() => (setMenu(null), change((r) => removeTier(r, tier.id), `${tier.name} removed. Its ${kind.noun} are unranked.`))}
							>
								<Trash2 size={14} aria-hidden /> Remove tier
							</button>
						</div>
					)}
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
							<Cover entry={entry} tier={tier.id} {...coverProps} />
						</Fragment>
					))}
					{target && dropAt?.beforeId === null && items.length > 0 && caret}
					{items.length === 0 && <span className="lb-rank__empty-band">Drop covers here</span>}
				</div>
			</section>
		)
	}

	const settingsOpen = menu === 'settings'
	const canAdd = ranking.tiers.length < MAX_TIERS
	const total = source.entries.length

	return (
		<div className="lb-rank" ref={rootRef} aria-label="Ranking tiers">
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
				<span className="lb-rank__grow" />
				{source.type === 'source' && (
					<span className="lb-rank__count">
						{total} {total === 1 ? kind.one : kind.noun}
					</span>
				)}
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
					<div className="lb-rank__pop lb-rank__settings" role="dialog" aria-label="Ranking settings" onPointerDown={swallow} onKeyDown={(e) => e.key !== 'Escape' && e.stopPropagation()}>
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
					</div>
				)}
			</header>

			{source.type !== 'source' ? (
				<div className="lb-rank__empty">
					<strong>{source.type === 'missing' ? 'What this ranked is gone' : 'Nothing to rank yet'}</strong>
					<span>
						{source.type === 'missing'
							? 'Choose another source from the menu above.'
							: 'Choose a source above: everything you liked, a backlog, a feed or a syllabus. Then drag its covers into tiers.'}
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
							aria-label={`Unranked, ${view.unranked.length}. ${railOpen ? 'Collapse' : 'Expand'}`}
							onPointerDown={swallow}
							onClick={() => setRailOpen(!railOpen)}
						>
							{railOpen ? <PanelLeftClose size={16} aria-hidden /> : <PanelLeftOpen size={16} aria-hidden />}
							<span className="lb-rank__rail-n">{view.unranked.length}</span>
							<span className="lb-rank__rail-label">Unranked</span>
						</button>
						{railOpen && (
							<div className="lb-rank__rail-list" role="list" aria-label="Unranked">
								{view.unranked.slice(0, railShown).map((entry) => (
									<Cover key={entry.id} entry={entry} tier={UNRANKED} small {...coverProps} />
								))}
								{view.unranked.length > railShown && (
									<button type="button" className="lb-rank__rail-more" onPointerDown={swallow} onClick={() => setRailShown(railShown + RAIL_PAGE)}>
										+{view.unranked.length - railShown}
									</button>
								)}
								{view.unranked.length === 0 && <span className="lb-rank__rail-empty">All sorted</span>}
							</div>
						)}
					</aside>
					<div className="lb-rank__bands">{view.bands.map(band)}</div>
				</div>
			)}
			<p className="lb-rank__sr" aria-live="polite">
				{announce}
			</p>

			{isEditing && (
				<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation}>
					<SourcePicker shape={shape} editor={editor} ranking={ranking} />
				</div>
			)}
		</div>
	)
}

/** The card's editor (a double-click, or the source button): what it ranks. */
function SourcePicker({ shape, editor, ranking }: { shape: NodeShape<RankingProps>; editor: Editor; ranking: Ranking }) {
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
					autoFocus
					onChange={(key) => updateRanking(ranking.rankingId, (r) => ({ ...r, source: key }))}
				/>
				<p className="lb-rank-editor__hint">
					{ranking.source
						? `${count} ${count === 1 ? kind.one : kind.noun}. Each source keeps its own tiers: switch back, and they are as you left them.`
						: 'Anything the other extensions offer: everything you liked on a randomizer, a backlog, a feed, a syllabus.'}
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
