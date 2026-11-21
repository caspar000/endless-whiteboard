import { stopEventPropagation, useValue } from '@lifeboard/canvas'
import {
	aspectRatio,
	chordsFor,
	getAssetBridge,
	subscribeToKeymap,
	updateNodeProps,
	useCardPopup,
	type NodeComponentProps,
	type NodeShape,
} from '@lifeboard/node-kit'
import { ChevronDown, ExternalLink, ListPlus, Shuffle, Stamp as StampIcon, Volume2, VolumeX } from 'lucide-react'
import {
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type CSSProperties,
	type DragEvent,
	type KeyboardEvent,
	type SyntheticEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { SHUFFLE_COMMAND_ID, onShuffleRequest } from './commands'
import { CoverFace, Thumb, preloadCovers } from './Cover'
import { SourceEditor } from './SourceEditor'
import {
	STAMPS,
	STAMP_KINDS,
	TYPED_SOURCE,
	currentItem,
	flipCount,
	flipDurations,
	flipSequence,
	inShuffle,
	isOut,
	isWeighted,
	itemsOf,
	lastPicks,
	latestStamp,
	localDay,
	ownStamps,
	pickNext,
	recordPick,
	shortDate,
	storeItem,
	withEntries,
	withRankings,
	type RandomItem,
	type StampKind,
} from './model'
import { Postmark } from './Postmark'
import type { RandomizerProps } from './props'
import { resolveSource } from './sources'
import { foldedItem, getRankedStamps } from './stamped'
import { clack, isMuted, setMuted, stampThump, subscribeToMuted, thunk, wakeAudio } from './sound'
import { Tiles, type TilesHandle } from './Tiles'

const TITLE_TILES = 18
const CREATOR_TILES = 22

/** What each part of the split flap is showing while a shuffle runs. `null` when nothing is moving. */
interface Faces {
	top: RandomItem
	bottom: RandomItem
	/** The flap: the old item's top half on its front, the new item's bottom half on its back. */
	flap: { front: RandomItem; back: RandomItem } | null
	/** The reduced-motion path: the new cover fading in over the old. */
	fade: RandomItem | null
}

/** Clicks on the card's controls are the card's, not the canvas's: no select, no drag. */
const swallow = (e: SyntheticEvent) => e.stopPropagation()

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/** `cmd+enter` as the platform writes it: ⌘↵ on a Mac, Ctrl ↵ elsewhere. */
function chordLabel(chord: string | undefined): string {
	if (!chord) return ''
	const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
	return chord
		.split('+')
		.map((part) => ({ cmd: mac ? '⌘' : 'Ctrl ', alt: mac ? '⌥' : 'Alt ', shift: mac ? '⇧' : 'Shift ', enter: '↵' })[part] ?? part.toUpperCase())
		.join('')
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Opens an entry the way its source would, or else its address in a new tab. */
function openEntry(open: ((entry: { id: string; url: string }) => void) | undefined, item: RandomItem) {
	if (!item.url) return
	if (open) open({ id: item.id, url: item.url })
	else window.open(item.url, '_blank', 'noopener,noreferrer')
}

function RandomizerCardImpl({ shape, isEditing, editor }: NodeComponentProps<RandomizerProps>) {
	const { source: list, items: stored, picks } = shape.props
	// The window's shape (DARK-13): square unless the card is set to another.
	const ratio = aspectRatio(shape.props.aspect ?? '')
	/*
	 * What the card shuffles, read through atoms so a source that changes (a feed reading new videos)
	 * changes the card. The typed list is the card's own; a source's entries meet the card's stamps
	 * in `withEntries`.
	 */
	const view = useValue(
		'lifeboard:randomizer-source',
		() => {
			const resolved = resolveSource(list)
			return { ...resolved, entries: resolved.type === 'source' ? (resolved.source?.entries(resolved.choiceId) ?? []) : [] }
		},
		[list]
	)
	const kind = view.kind
	// What rankings stamped counts here too (DARK-13): a ranked album is Liked, and out of the shuffle.
	// Not when the card draws from a ranking itself: its items are ranked, and drawn by their tiers.
	const ranked = useValue('lifeboard:randomizer-ranked', () => getRankedStamps(), [])
	const base = view.type === 'source' ? withEntries(stored, list, view.entries) : stored
	const items = view.source?.ranked ? base : withRankings(base, (item) => ranked.get(foldedItem(item)) ?? [])
	const ofList = itemsOf(items, list)
	const current = currentItem(items, picks, list)
	const pool = inShuffle(items, list)
	const recent = lastPicks(items, picks, list)
	const latest = current ? latestStamp(current) : null
	const canShuffle = isWeighted(pool) ? pool.length > 1 : pool.some((item) => item.id !== current?.id)

	const muted = useSyncExternalStore(subscribeToMuted, isMuted, () => false)
	const chord = useSyncExternalStore(subscribeToKeymap, () => chordsFor(SHUFFLE_COMMAND_ID)[0] ?? '', () => '')
	const [busy, setBusy] = useState(false)
	const [faces, setFaces] = useState<Faces | null>(null)
	const [menu, setMenu] = useState<'stamp' | 'history' | null>(null)
	const [justStamped, setJustStamped] = useState<string | null>(null)
	const [dropping, setDropping] = useState(false)
	const [announce, setAnnounce] = useState('')

	const moduleRef = useRef<HTMLDivElement>(null)
	const flapRef = useRef<HTMLDivElement>(null)
	const fadeRef = useRef<HTMLDivElement>(null)
	const fillRef = useRef<HTMLElement>(null)
	const flipsRef = useRef<HTMLElement>(null)
	const titleTiles = useRef<TilesHandle>(null)
	const creatorTiles = useRef<TilesHandle>(null)
	const busyRef = useRef(false)
	const latestShape = useRef(shape)
	latestShape.current = shape
	// The items as the card shows them, for the shuffle, which runs on past the render that started it.
	const latestItems = useRef(items)
	latestItems.current = items

	// A source that keeps itself fresh (a feed reading its channels) does so while a card shows it.
	const { source: watched, choiceId } = view
	useEffect(() => (watched ? watched.watch?.(choiceId) : undefined), [watched, choiceId])

	// The flap has landed and its pick been written: once the props say so, the card is at rest again.
	useEffect(() => {
		if (!busy && faces && !faces.flap && !faces.fade && faces.top.id === current?.id) setFaces(null)
	}, [busy, faces, current?.id])

	const shown = faces?.top ?? current

	/** One flap falling: the old top half folds down over the new bottom half. */
	const flip = useCallback(async (from: RandomItem, to: RandomItem, duration: number, last: boolean) => {
		flushSync(() => setFaces({ top: to, bottom: from, flap: { front: from, back: to }, fade: null }))
		const flap = flapRef.current
		const shade = (selector: string) => flap?.parentElement?.querySelector<HTMLElement>(selector) ?? null
		const anims: Animation[] = []
		if (flap && typeof flap.animate === 'function') {
			anims.push(
				flap.animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-180deg)' }], {
					duration,
					easing: last ? 'cubic-bezier(.5,0,.85,.4)' : 'cubic-bezier(.4,0,.9,.6)',
					fill: 'forwards',
				})
			)
			const front = shade('.lb-rand__flap-front .lb-rand__shade')
			const back = shade('.lb-rand__flap-back .lb-rand__shade')
			const under = shade('.lb-rand__half--bottom .lb-rand__shade')
			if (front) anims.push(front.animate([{ opacity: 0 }, { opacity: 0.65 }], { duration: duration * 0.55, easing: 'ease-in', fill: 'forwards' }))
			if (back) anims.push(back.animate([{ opacity: 0.55 }, { opacity: 0.55, offset: 0.5 }, { opacity: 0 }], { duration, easing: 'ease-out', fill: 'forwards' }))
			if (under) anims.push(under.animate([{ opacity: 0 }, { opacity: 0.45 }], { duration, easing: 'ease-in', fill: 'forwards' }))
			await anims[0]!.finished.catch(() => undefined)
		} else {
			await new Promise((resolve) => setTimeout(resolve, duration))
		}
		flushSync(() => setFaces({ top: to, bottom: to, flap: null, fade: null }))
		for (const anim of anims) anim.cancel()
		clack(last ? 1 : 0.5 + Math.random() * 0.35)
	}, [])

	const shuffle = useCallback(async () => {
		if (busyRef.current) return
		const { source: activeList, picks: allPicks } = latestShape.current.props
		const allItems = latestItems.current
		const from = currentItem(allItems, allPicks, activeList)
		const target = pickNext(allItems, activeList, from?.id ?? null)
		// A weighted draw may land where it started (`pickNext`): the flaps still run, and stop on it.
		if (!target || (target.id === from?.id && !isWeighted(itemsOf(allItems, activeList)))) return
		busyRef.current = true
		wakeAudio()
		setMenu(null)
		setBusy(true)

		const listed = itemsOf(allItems, activeList)
		const byId = new Map(listed.map((item) => [item.id, item]))
		const reduce = reducedMotion()
		const count = reduce ? 1 : flipCount(listed.length)
		const sequence = flipSequence(listed.map((item) => item.id), from?.id ?? null, target.id, count)
		const durations = flipDurations(count)
		// The covers it will flip through start loading now; any not in by its turn shows a placeholder.
		preloadCovers(sequence.map((id) => byId.get(id) ?? target))
		const total = reduce ? 400 : durations.reduce((a, b) => a + b, 0) + 600
		const progress = fillRef.current?.animate?.([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: total, easing: 'linear', fill: 'forwards' })

		try {
			if (reduce || !from) {
				if (flipsRef.current) flipsRef.current.textContent = '1 pick'
				flushSync(() => setFaces({ top: from ?? target, bottom: from ?? target, flap: null, fade: target }))
				await fadeRef.current?.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 360, easing: 'ease-out', fill: 'forwards' }).finished.catch(() => undefined)
				flushSync(() => setFaces({ top: target, bottom: target, flap: null, fade: null }))
				thunk()
			} else {
				let prev = from
				for (let i = 0; i < sequence.length; i++) {
					const next = byId.get(sequence[i]!) ?? target
					if (flipsRef.current) flipsRef.current.textContent = `${i + 1} flips`
					await flip(prev, next, durations[i]!, i === sequence.length - 1)
					prev = next
				}
				thunk()
				moduleRef.current?.animate?.([{ transform: 'translateY(0)' }, { transform: 'translateY(1.5px)' }, { transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' })
				await Promise.all([titleTiles.current?.rattle(target.title, 90), creatorTiles.current?.rattle(target.creator, 260)])
			}
			await progress?.finished.catch(() => undefined)
		} finally {
			progress?.cancel()
			// Where a shuffle landed is not an edit: undo goes back to the last thing you changed, not
			// through the last ten shuffles.
			const live = editor.getShape(latestShape.current.id) as NodeShape<RandomizerProps> | undefined
			if (live) {
				editor.run(() => updateNodeProps(editor, live, { picks: recordPick(live.props.picks, { source: activeList, id: target.id }) }), { history: 'ignore' })
			}
			setAnnounce(`Picked ${target.title}${target.creator ? ` by ${target.creator}` : ''}${target.year ? `, ${target.year}` : ''}.`)
			busyRef.current = false
			setJustStamped(null)
			setBusy(false)
		}
	}, [editor, flip])

	useEffect(() => onShuffleRequest(editor, shape.id, () => void shuffle()), [editor, shape.id, shuffle])

	/** The source picker is the card's editor: the same popover a double-click opens. */
	const chooseSource = () => {
		if (busy) return
		setMenu(null)
		editor.select(shape.id)
		editor.setEditingShape(shape.id)
	}

	/** A stamp is a real change to the item: one undo entry, like any other edit. */
	const stamp = (stampKind: StampKind) => {
		setMenu(null)
		if (!current || busy || isOut(current)) return
		wakeAudio()
		const date = localDay()
		updateNodeProps(editor, shape, { items: storeItem(stored, current, { stamps: [...ownStamps(current), { kind: stampKind, date }] }) })
		setJustStamped(current.id)
		setAnnounce(`Stamped ${STAMPS[stampKind].label}. ${current.title} ${STAMPS[stampKind].out ? 'is out of the shuffle' : 'stays in the shuffle'}.`)
		if (reducedMotion()) stampThump()
		else setTimeout(stampThump, 160)
	}

	const undoStamp = () => {
		// A ranking's stamp is the ranking's: only the card's own last stamp comes off.
		if (!current || busy || !latest || latest.ranked) return
		updateNodeProps(editor, shape, { items: storeItem(stored, current, { stamps: ownStamps(current).slice(0, -1) }) })
		setJustStamped(null)
		setMenu(null)
		setAnnounce(`Removed the ${STAMPS[latest.kind].label} stamp from ${current.title}.`)
	}

	// A menu draws past the card's edge while it is open, rather than being cut off by it (DARK-13).
	useCardPopup(editor, shape.id, menu !== null)

	// Menus close on a click anywhere else, and on Escape.
	const headRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!menu) return
		// Told to the editor as an open menu, so the board's own keys stand aside while it is up: 1, 2
		// and 3 pick a stamp here, and are tool keys everywhere else.
		const menuId = `randomizer-${menu}-${shape.id}`
		editor.addOpenMenu(menuId)
		const close = (e: PointerEvent) => {
			const target = e.target as Node
			if (!moduleRef.current?.contains(target) && !headRef.current?.contains(target)) setMenu(null)
		}
		const escape = (e: globalThis.KeyboardEvent) => {
			if (e.key === 'Escape') setMenu(null)
		}
		document.addEventListener('pointerdown', close, true)
		document.addEventListener('keydown', escape, true)
		return () => {
			editor.deleteOpenMenu(menuId)
			document.removeEventListener('pointerdown', close, true)
			document.removeEventListener('keydown', escape, true)
		}
	}, [menu, editor, shape.id])

	const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
		const picked = STAMP_KINDS.find((k) => STAMPS[k].key === e.key)
		if (picked) {
			e.preventDefault()
			e.stopPropagation()
			stamp(picked)
			return
		}
		const buttons = Array.from(e.currentTarget.querySelectorAll('button'))
		const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
		const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
		if (step) {
			e.preventDefault()
			e.stopPropagation()
			buttons[(at + step + buttons.length) % buttons.length]?.focus()
		}
	}

	/* --------------------------------------------------- a picture dropped on the cover becomes it */

	const imageFrom = (e: DragEvent) => {
		const file = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith('image/'))
		if (file) return { file }
		const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')).split('\n')[0]?.trim() ?? ''
		return /^https:\/\//.test(url) ? { url } : null
	}
	const wantsDrop = (e: DragEvent) => !busy && current !== null && (e.dataTransfer.types.includes('Files') || e.dataTransfer.types.includes('text/uri-list'))

	const onDragOver = (e: DragEvent) => {
		if (!wantsDrop(e)) return
		e.preventDefault()
		e.stopPropagation()
		e.dataTransfer.dropEffect = 'copy'
		setDropping(true)
	}
	const onDrop = async (e: DragEvent) => {
		setDropping(false)
		if (!wantsDrop(e)) return
		const image = imageFrom(e)
		if (!image || !current) return
		e.preventDefault()
		e.stopPropagation()
		const item = current
		const cover = 'file' in image && image.file ? await getAssetBridge().store(image.file) : (image.url ?? '')
		const live = editor.getShape(shape.id) as NodeShape<RandomizerProps> | undefined
		if (!live || !cover) return
		updateNodeProps(editor, live, { items: storeItem(live.props.items, item, { cover }) })
	}

	/* ----------------------------------------------------------------------------- drawing */

	const count =
		pool.length === ofList.length ? (
			<span className="lb-rand__count">
				{ofList.length} {ofList.length === 1 ? kind.one : kind.noun}
			</span>
		) : (
			<span className="lb-rand__count lb-rand__count--split">
				<span className="lb-rand__count-main">
					{pool.length} of {ofList.length}
				</span>
				<span className="lb-rand__count-sub">{kind.noun}</span>
			</span>
		)

	const fresh = !faces && justStamped !== null && justStamped === current?.id
	// Kept up through a shuffle (it is about the item the shuffle started from) so the card does not
	// change height under the flap; what it says is settled when the shuffle lands.
	const showNote = current !== null && latest !== null && (STAMPS[latest.kind].out || justStamped === current.id)
	const position = current ? ofList.findIndex((item) => item.id === current.id) + 1 : 0
	const pad2 = (n: number) => String(n).padStart(2, '0')

	// What the window says with nothing to show, by why there is nothing.
	const [emptyTitle, emptyHint] =
		view.type === 'none'
			? ['Waiting for a source', 'Double-click the card, or choose a source above: a list you type, or one of your feeds.']
			: view.type === 'missing'
				? ['This source is gone', 'Choose another from the menu above.']
				: view.type === 'typed'
					? ['Nothing on the list yet', 'Double-click the card to add things, one per line.']
					: [`No ${kind.noun} in ${view.name} yet`, 'They show here as soon as it has some.']

	return (
		<div className={`lb-rand${busy ? ' lb-rand--busy' : ''}`} aria-label="Randomizer">
			<header className="lb-rand__head" ref={headRef}>
				<button
					type="button"
					className={`lb-rand__source${view.type === 'none' ? ' lb-rand__source--empty' : ''}`}
					aria-haspopup="dialog"
					aria-label={view.type === 'none' ? 'Choose what to shuffle' : `Shuffling ${view.name}. Change the source`}
					title="Choose what this card shuffles"
					aria-disabled={busy}
					onPointerDown={swallow}
					onClick={chooseSource}
				>
					{view.type === 'none' ? <ListPlus size={14} aria-hidden /> : view.source?.icon ? <view.source.icon size={14} aria-hidden /> : null}
					<span className="lb-rand__source-name">{view.type === 'none' ? 'Choose a source' : view.name}</span>
					<ChevronDown size={14} aria-hidden />
				</button>
				<div className="lb-rand__head-right">
					{view.type !== 'none' && count}
					{current?.url && !busy && (
						<button
							type="button"
							className="lb-rand__icon"
							aria-label={`Open ${current.title}`}
							title={`Open this ${kind.one}`}
							onPointerDown={swallow}
							onClick={() => openEntry(view.source?.open?.bind(view.source), current)}
						>
							<ExternalLink size={16} aria-hidden />
						</button>
					)}
					<button
						type="button"
						className="lb-rand__icon"
						aria-label={`Stamp this ${kind.one}`}
						title={current && isOut(current) && latest ? `Stamped ${STAMPS[latest.kind].label}: undo to stamp again` : `Stamp this ${kind.one}`}
						aria-haspopup="menu"
						aria-expanded={menu === 'stamp'}
						aria-disabled={busy || !current || isOut(current)}
						onPointerDown={swallow}
						onClick={() => {
							if (busy || !current || isOut(current)) return
							setMenu(menu === 'stamp' ? null : 'stamp')
						}}
					>
						<StampIcon size={16} aria-hidden />
					</button>
					<button
						type="button"
						className="lb-rand__icon"
						aria-label="Mute sound"
						aria-pressed={muted}
						title={muted ? 'Sound off' : 'Sound on'}
						onPointerDown={swallow}
						onClick={() => setMuted(!muted)}
					>
						{muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
					</button>
					{menu === 'stamp' && current && (
						<div className="lb-rand__pop lb-rand__stamp-menu" role="menu" data-card-popup aria-label={`Stamp this ${kind.one}`} onKeyDown={onMenuKey} onPointerDown={swallow}>
							<p className="lb-rand__pop-title">Stamp this {kind.one}</p>
							<div className="lb-rand__stamp-opts">
								{STAMP_KINDS.map((k, i) => (
									<button
										key={k}
										type="button"
										role="menuitem"
										className="lb-rand__stamp-opt"
										aria-keyshortcuts={STAMPS[k].key}
										autoFocus={i === 0}
										onClick={() => stamp(k)}
									>
										<Postmark kind={k} date={localDay()} mini className="lb-rand-pm-mini" />
										<span className="lb-rand__stamp-name">{STAMPS[k].label}</span>
										<kbd className="lb-rand__stamp-key" aria-hidden="true">
											{STAMPS[k].key}
										</kbd>
									</button>
								))}
							</div>
						</div>
					)}
				</div>
			</header>

			<div className="lb-rand__module" ref={moduleRef}>
				<span className="lb-rand__pin lb-rand__pin--l" aria-hidden="true" />
				<span className="lb-rand__pin lb-rand__pin--r" aria-hidden="true" />
				<div
					className={`lb-rand__stage${dropping ? ' lb-rand__stage--drop' : ''}${ratio ? ' lb-rand__stage--shaped' : ''}`}
					style={ratio ? { aspectRatio: String(ratio) } : undefined}
					role="img"
					aria-label={
						shown
							? `${capitalise(kind.one)} cover: ${shown.title}${shown.creator ? ` by ${shown.creator}` : ''}${latest && !faces ? `. Stamped ${STAMPS[latest.kind].label}, ${shortDate(latest.date)}` : ''}`
							: `No ${kind.noun} yet`
					}
					onDragOver={onDragOver}
					onDragLeave={() => setDropping(false)}
					onDrop={(e) => void onDrop(e)}
				>
					{shown ? (
						<>
							<div className="lb-rand__half lb-rand__half--top">
								<CoverFace item={shown} shape={kind.shape} fresh={fresh} />
							</div>
							<div className="lb-rand__half lb-rand__half--bottom">
								<CoverFace item={faces?.bottom ?? shown} shape={kind.shape} fresh={fresh} />
								<div className="lb-rand__shade" />
							</div>
							<div className="lb-rand__flap" ref={flapRef} style={{ visibility: faces?.flap ? 'visible' : 'hidden' }} aria-hidden="true">
								<div className="lb-rand__flap-face lb-rand__flap-front">
									{faces?.flap && <CoverFace item={faces.flap.front} shape={kind.shape} />}
									<div className="lb-rand__shade" />
								</div>
								<div className="lb-rand__flap-face lb-rand__flap-back">
									{faces?.flap && <CoverFace item={faces.flap.back} shape={kind.shape} />}
									<div className="lb-rand__shade" />
								</div>
							</div>
							<div className="lb-rand__fade" ref={fadeRef} style={{ visibility: faces?.fade ? 'visible' : 'hidden' }} aria-hidden="true">
								{faces?.fade && <CoverFace item={faces.fade} shape={kind.shape} />}
							</div>
						</>
					) : (
						<div className="lb-rand__empty">
							<strong>{emptyTitle}</strong>
							<span>{emptyHint}</span>
						</div>
					)}
					<div className="lb-rand__axle" aria-hidden="true" />
					{dropping && <div className="lb-rand__drop-hint">Drop to make this the cover</div>}
				</div>
				{!busy && current && current.stamps.length > 0 && (
					<button
						type="button"
						className="lb-rand__pile-hit"
						aria-label={`Stamp history: ${current.stamps.length} ${current.stamps.length === 1 ? 'stamp' : 'stamps'}${latest ? `, latest ${STAMPS[latest.kind].label} on ${shortDate(latest.date)}` : ''}`}
						aria-haspopup="dialog"
						aria-expanded={menu === 'history'}
						onPointerDown={swallow}
						onClick={() => setMenu(menu === 'history' ? null : 'history')}
					/>
				)}
				{menu === 'history' && current && (
					<div className="lb-rand__pop lb-rand__history" role="dialog" data-card-popup aria-label="Stamp history" onPointerDown={swallow}>
						<p className="lb-rand__pop-title">Stamp history</p>
						<ol className="lb-rand__timeline">
							{current.stamps.map((s, i) => (
								<li key={i} className={i === current.stamps.length - 1 ? 'lb-rand__timeline-latest' : undefined}>
									<span className="lb-rand__timeline-dot" style={{ '--lb-rand-ink': STAMPS[s.kind].ink } as CSSProperties} aria-hidden="true" />
									<span>
										{STAMPS[s.kind].label} · {shortDate(s.date)}
										{s.ranked ? ' · ranked' : ''}
									</span>
								</li>
							))}
						</ol>
					</div>
				)}
			</div>

			<div className="lb-rand__board" aria-hidden="true">
				<div>
					<div className="lb-rand__row-label">
						<span>Title</span>
						<span className="lb-rand__meta">{current ? `No. ${pad2(position)} / ${pad2(ofList.length)}` : ''}</span>
					</div>
					<Tiles count={TITLE_TILES} text={current?.title ?? ''} frozen={busy} className="lb-rand__tiles lb-rand__tiles--title" handle={titleTiles} />
				</div>
				<div>
					<div className="lb-rand__row-label">
						<span>{kind.creator}</span>
						<span className="lb-rand__meta">{current ? [current.year, kind.tag].filter(Boolean).join(' · ') : ''}</span>
					</div>
					<Tiles count={CREATOR_TILES} text={current?.creator ?? ''} frozen={busy} className="lb-rand__tiles lb-rand__tiles--creator" handle={creatorTiles} />
				</div>
			</div>

			{showNote && latest && (
				<p className="lb-rand__note">
					<span className="lb-rand__note-ring" style={{ '--lb-rand-ink': STAMPS[latest.kind].ink } as CSSProperties} aria-hidden="true" />
					<span>
						{latest.ranked ? 'Ranked, so ' : 'Stamped '}
						<b>{STAMPS[latest.kind].label}</b> — {STAMPS[latest.kind].out ? 'out of the shuffle.' : 'stays in the shuffle.'}
					</span>
					{!latest.ranked && (
						<button type="button" className="lb-rand__undo" onPointerDown={swallow} onClick={undoStamp}>
							Undo
						</button>
					)}
				</p>
			)}
			<p className="lb-rand__sr" aria-live="polite">
				{announce}
			</p>

			<button
				type="button"
				className={`lb-rand__shuffle${busy ? ' lb-rand__shuffle--busy' : ''}`}
				aria-disabled={busy || !canShuffle}
				aria-keyshortcuts={chord ? chord.replace('cmd', 'Meta').replace('enter', 'Enter') : undefined}
				onPointerDown={swallow}
				onClick={() => {
					if (!busy && canShuffle) void shuffle()
				}}
			>
				<span className="lb-rand__shuffle-main">
					<Shuffle size={16} aria-hidden />
					<span>{busy ? 'Shuffling' : canShuffle || ofList.length === 0 ? 'Shuffle' : 'Nothing left to shuffle'}</span>
				</span>
				{chord && canShuffle && (
					<kbd className="lb-rand__kbd" aria-hidden="true">
						{chordLabel(chord)}
					</kbd>
				)}
				<span className="lb-rand__progress" aria-hidden="true">
					<span className="lb-rand__progress-cap">
						<span>Shuffling…</span>
						<b ref={flipsRef}>0 flips</b>
					</span>
					<span className="lb-rand__track">
						<i ref={fillRef} />
					</span>
				</span>
			</button>

			<div className="lb-rand__history-row">
				<span className="lb-rand__history-label">Last picks</span>
				<ul className="lb-rand__thumbs" aria-label="Last picks">
					{Array.from({ length: 4 }, (_, i) => {
						const item = recent[i]
						if (!item) return <li key={`empty${i}`} className="lb-rand__thumb lb-rand__thumb--empty" aria-hidden="true" />
						const stamped = latestStamp(item)
						return (
							<Thumb
								key={item.id}
								item={item}
								shape={kind.shape}
								ink={stamped ? STAMPS[stamped.kind].ink : null}
								from={list === TYPED_SOURCE ? '' : list}
								via={view.type === 'typed' ? 'Randomizer' : (view.source?.label ?? '')}
								label={`${item.title}${item.creator ? ` — ${item.creator}` : ''}${stamped ? `, stamped ${STAMPS[stamped.kind].label}` : ''}`}
							/>
						)
					})}
				</ul>
			</div>

			{isEditing && (
				<div onPointerDown={stopEventPropagation} onTouchStart={stopEventPropagation}>
					<SourceEditor shape={shape} editor={editor} />
				</div>
			)}
		</div>
	)
}

/** `h` is left out: auto-height writes it after every layout, and the card draws nothing from it. */
export const RandomizerCard = memo(
	RandomizerCardImpl,
	(prev, next) =>
		prev.isEditing === next.isEditing &&
		prev.shape.id === next.shape.id &&
		prev.shape.props.source === next.shape.props.source &&
		prev.shape.props.items === next.shape.props.items &&
		prev.shape.props.picks === next.shape.props.picks &&
		prev.shape.props.aspect === next.shape.props.aspect
)
