import { useValue } from '@lifeboard/canvas'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, GripVertical, Pencil, Plus, Printer, RotateCcw, Star } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { usePhone } from '../app/usePhone'
import type { BoardMeta } from '../boards/boardIndex'
import { usePlatform } from '../platform/PlatformContext'
import { DailyContext, type DailyContextValue } from './context'
import { Inspector } from './Inspector'
import { DRAG_TYPE, Library, type DragPayload } from './Library'
import {
	DAILY_GRID,
	REVIEW_GRID,
	WEEKDAYS,
	WEEKDAY_LETTERS,
	WIDGET_SIZE,
	addDays,
	cycleLabel,
	cycleOf,
	dayProgress,
	daysOfWeek,
	firstGap,
	fits,
	focusOf,
	freeCells,
	isDay,
	layoutFor,
	longDay,
	newId,
	pageFor,
	placeAt,
	sameWidgets,
	shortDay,
	today,
	weekNumber,
	weekOf,
	weekRange,
	weekday,
	withLayoutFrom,
	withPageLayout,
	type DailySetup,
	type Day,
	type DayPage,
	type Widget,
} from './model'
import { ReviewWidget } from './reviewWidgets'
import { dailyPages, dailyWeeks, getSetup, layoutDraft, setupAtom, updatePage, updateSetup, updateWeek, type LayoutDraft } from './store'
import { DailyWidget } from './widgets'
import './daily.css'

/** The pages' own sizes, in CSS pixels at 96 per inch: A5 upright, A4 on its side. */
const PAGE_SIZE = {
	daily: { w: 559, h: 794, print: '148mm 210mm' },
	review: { w: 1123, h: 794, print: '297mm 210mm' },
} as const

const EDITING_KEY = 'lifeboard:daily:editing'

function readEditing(): boolean {
	try {
		return localStorage.getItem(EDITING_KEY) !== 'false'
	} catch {
		return true
	}
}

export interface DailyScreenProps {
	day: string | undefined
	review: boolean
	boards: readonly BoardMeta[]
	onNavigate: (day: Day | undefined, review: boolean) => void
	onOpenBoard: (board: BoardMeta) => void
}

/**
 * The daily page (DARK-17): the week across the top, and the day's A5 page between the Library and the
 * Inspector while the layout is being edited, or alone once it is done. On the review day's cell, the
 * weekly review, an A4 page built the same way.
 */
export default function DailyScreen({ day: routeDay, review, boards, onNavigate: navigateNow, onOpenBoard }: DailyScreenProps) {
	const platform = usePlatform()
	const phone = usePhone()
	const day = routeDay && isDay(routeDay) ? routeDay : today()
	const mode = review ? 'review' : 'daily'
	const setup = useValue('lifeboard:daily-setup-value', () => setupAtom.get() ?? getSetup(), [])
	const pages = useValue('lifeboard:daily-pages-value', () => dailyPages.get(), [])
	const plans = useValue('lifeboard:daily-weeks-value', () => dailyWeeks.get(), [])
	const draft = useValue('lifeboard:daily-layout-draft-value', () => layoutDraft.get(), [])
	/**
	 * The save question is open: asked by Done, or by leaving a page with unsaved changes, and `then` is
	 * what to do once it is answered.
	 */
	const [asking, setAsking] = useState<{ then?: () => void } | null>(null)
	const [reveal, setReveal] = useState<{ id: string; n: number } | null>(null)
	const [editing, setEditingState] = useState(readEditing)
	const [selected, setSelected] = useState<string | null>(null)
	/**
	 * Which of the Library and the Inspector is shown where there is room for one only (a tablet, a
	 * narrow window, a phone), and on a phone whether its sheet is up over the page.
	 */
	const [panel, setPanel] = useState<'library' | 'inspector'>('library')
	const [sheet, setSheet] = useState(false)
	/** Selecting a widget brings up the Inspector, where it is changed. */
	const select = useCallback(
		(id: string | null) => {
			setSelected(id)
			if (id) {
				setPanel('inspector')
				if (phone) setSheet(true)
			}
		},
		[phone]
	)
	const showPanel = (which: 'library' | 'inspector') => {
		if (phone && sheet && panel === which) setSheet(false)
		else {
			setPanel(which)
			setSheet(true)
		}
	}
	/** Why the last thing asked of the layout couldn't be done, for a few seconds. */
	const [notice, setNotice] = useState('')
	useEffect(() => {
		if (!notice) return
		const timer = setTimeout(() => setNotice(''), 4000)
		return () => clearTimeout(timer)
	}, [notice])
	const setEditing = (next: boolean) => {
		setEditingState(next)
		if (!next) {
			setSelected(null)
			setSheet(false)
			setNotice('')
		}
		try {
			localStorage.setItem(EDITING_KEY, String(next))
		} catch {
			// The choice is a convenience; without storage it lasts the session.
		}
	}

	// The daily layout as saved, or as it is being changed: page edits wait in a draft until it is said
	// whether they are this page's alone or every page's after it too.
	const saved = mode === 'daily' ? layoutFor(setup, day) : setup.review
	const ownDraft = mode === 'daily' && draft?.day === day ? draft : null
	const widgets = ownDraft?.widgets ?? saved
	const grid = mode === 'daily' ? DAILY_GRID : REVIEW_GRID
	const listIds = useMemo(() => widgets.filter((w) => w.type === 'tasks' || w.type === 'focus').map((w) => w.id), [widgets])
	const page = useMemo(() => pageFor(pages, day, setup.carryTasks, listIds), [pages, day, setup.carryTasks, listIds])
	const week = weekOf(day)
	const plan = plans[week]
	const focus = focusOf(setup, plan, page, day)
	const selectedWidget = widgets.find((w) => w.id === selected) ?? null

	useEffect(() => setSelected(null), [mode])

	// On a phone the Inspector comes up over the page's lower half: the widget it is for is scrolled into
	// what is left of the screen, the scroll padding (daily.css) keeping it clear of the sheet.
	const root = useRef<HTMLDivElement>(null)
	useEffect(() => {
		if (!phone || !sheet || !selected) return
		const frame = requestAnimationFrame(() => root.current?.querySelector('.lb-daily-slot[data-selected]')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
		return () => cancelAnimationFrame(frame)
	}, [phone, sheet, selected])

	/** Going to another page asks about unsaved changes first. */
	const onNavigate = useCallback(
		(d: Day | undefined, r: boolean) => {
			if (layoutDraft.get()) setAsking({ then: () => navigateNow(d, r) })
			else navigateNow(d, r)
		},
		[navigateNow]
	)
	const openDay = useCallback((d: Day) => onNavigate(d, false), [onNavigate])
	const openReview = useCallback((d: Day) => onNavigate(d, true), [onNavigate])

	const context = useMemo<DailyContextValue>(
		() => ({
			setup,
			day,
			page,
			pages,
			plans,
			plan,
			focus,
			editing,
			blobs: platform.blobs,
			boards,
			updatePage: (change: (p: DayPage) => DayPage) => updatePage(day, change, page),
			openDay,
			openReview,
			openBoard: onOpenBoard,
		}),
		[setup, day, page, pages, plans, plan, focus, editing, platform.blobs, boards, openDay, openReview, onOpenBoard]
	)

	const setWidgets = (next: Widget[]) => {
		if (mode === 'review') {
			updateSetup((s) => ({ ...s, review: next }))
			return
		}
		const base = ownDraft?.base ?? saved
		layoutDraft.set(sameWidgets(next, base) ? null : { day, base, widgets: next })
	}
	const addWidget = (payload: DragPayload & { kind: 'new' }, cell?: { col: number; row: number }) => {
		const size = WIDGET_SIZE[payload.type]
		const fitSize = { w: Math.min(size.w, grid.cols), h: size.h }
		const place = cell ? placeAt(widgets, cell, fitSize, grid) : (() => {
			const gap = firstGap(widgets, fitSize, grid) ?? firstGap(widgets, { w: fitSize.w, h: 1 }, grid) ?? firstGap(widgets, { w: 1, h: 1 }, grid)
			return gap ? placeAt(widgets, gap, fitSize, grid) : null
		})()
		if (!place) {
			setNotice(cell ? 'That cell is taken: drop it on a free one.' : 'No room left on the page: remove or shrink a widget first.')
			return
		}
		const id = newId('wd')
		const templateId = payload.templateId
		// A new icon-task block starts empty, with tasks of its own to fill in the Inspector.
		const config: Widget['config'] =
			payload.type === 'physical' ? { metricIds: setup.metrics.slice(0, 1).map((m) => m.id), fasting: true, food: true }
			: templateId ? { templateId }
			: payload.type === 'block' ? { contents: { iconTaskIds: [], items: [] } }
			: payload.type === 'reflection' ? { prompts: [{ id: newId('q'), text: 'Went well' }] }
			: {}
		const widget: Widget = { id, type: payload.type, ...place, ...(payload.type === 'block' && !templateId ? { title: 'NEW BLOCK' } : {}), config }
		setWidgets([...widgets, widget])
		select(id)
	}
	const moveWidget = (id: string, cell: { col: number; row: number }) => {
		const widget = widgets.find((w) => w.id === id)
		if (!widget) return
		const place = placeAt(widgets, cell, widget, grid, id)
		if (place) setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...place } : w)))
		else setNotice('It doesn’t fit there: move or shrink what is in the way first.')
	}
	/** One cell over, the same size: from the Inspector's arrows. */
	const nudgeWidget = (id: string, cell: { col: number; row: number }) => {
		const widget = widgets.find((w) => w.id === id)
		if (!widget) return
		const next = { ...widget, ...cell }
		if (fits(widgets, next, grid, id)) setWidgets(widgets.map((w) => (w.id === id ? next : w)))
		else setNotice('Something is in the way: move it or shrink this one first.')
	}
	const changeWidget = (next: Widget) => {
		if (!fits(widgets, next, grid, next.id)) {
			setNotice('No free row below: move or shrink the block underneath first.')
			return
		}
		setWidgets(widgets.map((w) => (w.id === next.id ? next : w)))
	}
	const removeWidget = (id: string) => {
		setWidgets(widgets.filter((w) => w.id !== id))
		setSelected(null)
	}

	const reviewDay = addDays(week, setup.reviewDay)
	const isToday = day === today()
	const size = PAGE_SIZE[mode]

	// Changes to a page left some other way than through the screen (the browser's Back, a link) are
	// asked about as soon as they are noticed.
	const stray = !!draft && (draft.day !== day || mode !== 'daily')
	const question = asking ?? (stray ? {} : null)
	const answer = (change: ((d: LayoutDraft) => void) | null) => {
		const pending = layoutDraft.get()
		if (pending && change) change(pending)
		layoutDraft.set(null)
		const then = asking?.then
		setAsking(null)
		then?.()
	}
	/** Done, or Save… when the page has changes: they are asked about first. */
	const finish = () => (editing && ownDraft ? setAsking({ then: () => setEditing(false) }) : setEditing(!editing))
	const keepEditing = () => {
		setAsking(null)
		if (stray && draft) navigateNow(draft.day, false)
	}

	return (
		<DailyContext.Provider value={context}>
			<div className={`lb-daily lb-daily--${mode} ${editing ? 'lb-daily--editing' : 'lb-daily--clean'}`} data-panel={panel} data-sheet={editing && sheet ? '' : undefined} ref={root}>
				<style>{`@page { size: ${size.print}; margin: 0; }`}</style>
				<header className="lb-daily__top">
					<button type="button" className="lb-daily-iconbtn lb-daily-iconbtn--box" aria-label={mode === 'daily' ? 'Previous day' : 'Previous week'} onClick={() => onNavigate(addDays(day, mode === 'daily' ? -1 : -7), review)}>
						<ChevronLeft size={16} aria-hidden="true" />
					</button>
					<div className="lb-daily__when">
						<strong>
							{WEEKDAYS[weekday(day)]!.slice(0, 3)} · {longDay(day)}
						</strong>
						<span className="lb-daily-faint">{mode === 'review' ? `Weekly review · Week ${weekNumber(day)}` : isToday ? 'Today' : `Week ${weekNumber(day)}`}</span>
					</div>
					<button type="button" className="lb-daily-iconbtn lb-daily-iconbtn--box" aria-label={mode === 'daily' ? 'Next day' : 'Next week'} onClick={() => onNavigate(addDays(day, mode === 'daily' ? 1 : 7), review)}>
						<ChevronRight size={16} aria-hidden="true" />
					</button>
					<button type="button" className="lb-daily-linkbtn" disabled={isToday && !review} onClick={() => onNavigate(undefined, false)}>
						Today
					</button>
					{editing && <span className="lb-daily-pill">{mode === 'review' ? 'Editing the review' : ownDraft ? 'Editing this page · not saved' : 'Editing this page'}</span>}
					{notice && (
						<span className="lb-daily-notice" role="status">
							{notice}
						</span>
					)}
					<div className="lb-daily__actions">
						{mode === 'daily' ? (
							<button type="button" className="lb-daily-btn" onClick={() => openReview(reviewDay)}>
								<CalendarDays size={14} aria-hidden="true" /> Weekly review <span className="lb-daily-faint">{WEEKDAYS[setup.reviewDay]!.slice(0, 3)} {Number(reviewDay.slice(8))}</span>
							</button>
						) : (
							<button type="button" className="lb-daily-btn" onClick={() => openDay(isDayInWeek(today(), week) ? today() : day)}>
								<CalendarDays size={14} aria-hidden="true" /> Daily page
							</button>
						)}
						{!editing && (
							<button type="button" className="lb-daily-btn lb-daily-btn--print" onClick={() => window.print()}>
								<Printer size={14} aria-hidden="true" /> Print
							</button>
						)}
						{editing && ownDraft && (
							<button type="button" className="lb-daily-btn lb-daily-btn--save" onClick={() => layoutDraft.set(null)}>
								Discard changes
							</button>
						)}
						<button type="button" className={editing ? 'lb-daily-btn lb-daily-btn--primary lb-daily-btn--save' : 'lb-daily-btn'} onClick={finish}>
							{editing ? (
								ownDraft ? 'Save…' : 'Done'
							) : (
								<>
									<Pencil size={13} aria-hidden="true" /> Edit layout
								</>
							)}
						</button>
					</div>
				</header>

				<WeekStrip setup={setup} week={week} day={day} review={review} pages={pages} onDay={openDay} onReview={openReview} />

				<div className="lb-daily__body">
					{editing && (
						// The switch between the two panels where only one fits, and on a phone the edit bar along
						// the bottom, with Save… in reach of a thumb.
						<nav className="lb-daily-dock" aria-label="Layout editing">
							<div className="lb-daily-switch" role="tablist" aria-label="Panel">
								{(
									[
										['library', 'Library'],
										['inspector', selectedWidget ? 'Inspector' : 'Page settings'],
									] as const
								).map(([id, label]) => (
									<button key={id} type="button" role="tab" aria-selected={panel === id && (!phone || sheet)} onClick={() => showPanel(id)}>
										{label}
									</button>
								))}
							</div>
							{ownDraft && (
								<button type="button" className="lb-daily-btn lb-daily-dock__discard" aria-label="Discard changes" title="Discard changes" onClick={() => layoutDraft.set(null)}>
									<RotateCcw size={15} aria-hidden="true" />
								</button>
							)}
							<button type="button" className="lb-daily-btn lb-daily-btn--primary lb-daily-dock__save" onClick={finish}>
								{ownDraft ? 'Save…' : 'Done'}
							</button>
						</nav>
					)}
					{editing && <Library mode={mode} setup={setup} widgets={widgets} onAdd={(p) => addWidget(p)} onSelect={select} reveal={reveal} />}
					<PageCanvas
						mode={mode}
						size={size}
						grid={grid}
						widgets={widgets}
						editing={editing}
						selected={selected}
						onSelect={select}
						onDropNew={addWidget}
						onMove={moveWidget}
						onResize={(id, h) => {
							const w = widgets.find((x) => x.id === id)
							if (w && w.h !== h) changeWidget({ ...w, h })
						}}
						render={(w) => (mode === 'daily' ? <DailyWidget widget={w} /> : <ReviewWidget widget={w} />)}
					/>
					{editing && (
						<Inspector
							mode={mode}
							setup={setup}
							widget={selectedWidget}
							focus={focus}
							boards={boards}
							grid={grid}
							onChange={changeWidget}
							onMove={nudgeWidget}
							onRemove={removeWidget}
							onClose={() => setSelected(null)}
							onEditTemplate={(id) => {
								setPanel('library')
								setReveal((r) => ({ id, n: (r?.n ?? 0) + 1 }))
							}}
						/>
					)}
				</div>
				{question && draft && <SaveDialog day={draft.day} onAnswer={answer} onCancel={keepEditing} stray={stray} />}
			</div>
		</DailyContext.Provider>
	)
}

const isDayInWeek = (d: Day, week: Day) => weekOf(d) === week

/**
 * Where a page's changes go, asked as a calendar asks about a repeating event: this page alone, or this
 * page and every one after it. Earlier pages are never changed.
 */
function SaveDialog({ day, stray, onAnswer, onCancel }: { day: Day; stray: boolean; onAnswer: (change: ((d: LayoutDraft) => void) | null) => void; onCancel: () => void }) {
	const first = useRef<HTMLButtonElement>(null)
	useEffect(() => first.current?.focus(), [])
	const name = `${WEEKDAYS[weekday(day)]} ${shortDay(day)}`
	return (
		<div
			className="lb-daily-modal"
			onPointerDown={(e) => e.target === e.currentTarget && onCancel()}
			onKeyDown={(e) => {
				if (e.key === 'Escape') onCancel()
			}}
		>
			<div className="lb-daily-modal__card" role="dialog" aria-modal="true" aria-labelledby="lb-daily-save-title">
				<h2 id="lb-daily-save-title">Save the changes to {name}’s page</h2>
				<p className="lb-daily-faint">Pages before it stay as they are.</p>
				<div className="lb-daily-modal__choices">
					<button ref={first} type="button" className="lb-daily-modal__choice" onClick={() => onAnswer((d) => updateSetup((s) => withPageLayout(s, d.day, d.widgets)))}>
						<strong>Only this page</strong>
						<span className="lb-daily-faint">{name} alone. The pages after it keep the layout they have.</span>
					</button>
					<button type="button" className="lb-daily-modal__choice" onClick={() => onAnswer((d) => updateSetup((s) => withLayoutFrom(s, d.day, d.base, d.widgets)))}>
						<strong>This and all future pages</strong>
						<span className="lb-daily-faint">{name} and every page after it, including ones changed on their own.</span>
					</button>
				</div>
				<div className="lb-daily-modal__foot">
					<button type="button" className="lb-daily-linkbtn lb-daily-linkbtn--danger" onClick={() => onAnswer(null)}>
						Discard changes
					</button>
					<button type="button" className="lb-daily-btn" onClick={onCancel}>
						{stray ? `Back to ${name}` : 'Keep editing'}
					</button>
				</div>
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------------------------ the week */

function WeekStrip({
	setup,
	week,
	day,
	review,
	pages,
	onDay,
	onReview,
}: {
	setup: DailySetup
	week: Day
	day: Day
	review: boolean
	pages: Readonly<Record<string, DayPage>>
	onDay: (day: Day) => void
	onReview: (day: Day) => void
}) {
	const plans = useValue('lifeboard:daily-weeks-strip', () => dailyWeeks.get(), [])
	const plan = plans[week]
	const cycle = cycleOf(setup, plan)
	const [open, setOpen] = useState(false)
	const now = today()
	return (
		<section className="lb-daily-week" aria-label="Week overview">
			<div className="lb-daily-week__cycle">
				<button type="button" className="lb-daily-week__cyclebtn" aria-expanded={open} aria-label={`Week ${weekNumber(week)}, ${cycleLabel(setup, cycle)}. Change the week's cycle`} onClick={() => setOpen(!open)}>
					<strong>Week {weekNumber(week)}</strong>
					<span className="lb-daily-faint">·</span>
					<span>{cycle ? cycleLabel(setup, cycle) : 'Set the cycle'}</span>
					<ChevronDown size={14} aria-hidden="true" />
				</button>
				<span className="lb-daily-faint">{weekRange(week)}</span>
				{open && (
					<div className="lb-daily-pop" role="dialog" aria-label="Week cycle">
						<p className="lb-daily-faint">Pick this week’s cycle by hand. Its days take its areas in turn.</p>
						{setup.cycles.map((c) => (
							<button
								key={c.id}
								type="button"
								className="lb-daily-pop__item"
								aria-pressed={plan?.cycleId === c.id}
								onClick={() => {
									updateWeek(week, (w) => ({ ...w, cycleId: c.id }))
									setOpen(false)
								}}
							>
								{cycleLabel(setup, c)}
							</button>
						))}
						<button
							type="button"
							className="lb-daily-pop__item"
							aria-pressed={!plan?.cycleId}
							onClick={() => {
								updateWeek(week, (w) => ({ ...w, cycleId: '' }))
								setOpen(false)
							}}
						>
							No cycle this week
						</button>
						{!setup.cycles.length && <p className="lb-daily-faint">No cycles yet: add them in the Inspector’s page settings.</p>}
					</div>
				)}
			</div>
			<div className="lb-daily-week__days" role="group" aria-label="Days of this week">
				{daysOfWeek(week).map((d, i) => {
					const area = setup.areas.find((a) => a.id === focusOf(setup, plan, pages[d], d))
					if (i === setup.reviewDay) {
						return (
							<button key={d} type="button" className="lb-daily-day lb-daily-day--review" aria-pressed={review} onClick={() => onReview(d)} aria-label={`${WEEKDAYS[i]} ${d}: weekly review`}>
								<span className="lb-daily-day__top">
									<span>{WEEKDAY_LETTERS[i]}</span>
									<span className="lb-daily-faint">Every {WEEKDAYS[i]}</span>
								</span>
								<span className="lb-daily-day__bottom">
									<span className="lb-daily-day__num">{Number(d.slice(8))}</span>
									<span className="lb-daily-day__review">
										<Star size={12} aria-hidden="true" fill="currentColor" /> Weekly review
									</span>
								</span>
							</button>
						)
					}
					// A day still to come has nothing done, even when its page is there already (its pick is drawn the day before).
					const progress = d > now ? null : dayProgress(setup, pages[d], d, area?.id ?? '')
					return (
						<button
							key={d}
							type="button"
							className="lb-daily-day"
							data-today={d === now ? '' : undefined}
							aria-pressed={!review && d === day}
							style={area ? ({ '--area': area.color } as CSSProperties) : undefined}
							aria-label={`${WEEKDAYS[i]} ${d}${d === now ? ', today' : ''}${area ? `, focus ${area.name}` : ''}${progress === null ? ', no page yet' : `, ${Math.round(progress * 100)}% done`}`}
							onClick={() => onDay(d)}
						>
							<span className="lb-daily-day__top">
								<span>
									{WEEKDAY_LETTERS[i]}
									{d === now && <span className="lb-daily-day__today"> · Today</span>}
								</span>
								{area && <span style={{ color: area.color }}>{area.name.toUpperCase()}</span>}
							</span>
							<span className="lb-daily-day__bottom">
								<span className="lb-daily-day__num">{Number(d.slice(8))}</span>
								<Ring value={progress} />
							</span>
						</button>
					)
				})}
			</div>
		</section>
	)
}

function Ring({ value }: { value: number | null }) {
	const r = 7
	const c = 2 * Math.PI * r
	return (
		<span className="lb-daily-ring">
			<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
				<circle cx="10" cy="10" r={r} className="lb-daily-ring__track" />
				{value !== null && <circle cx="10" cy="10" r={r} className="lb-daily-ring__value" strokeDasharray={`${c * value} ${c}`} transform="rotate(-90 10 10)" />}
			</svg>
			<span className="lb-daily-faint">{value === null ? '—' : `${Math.round(value * 100)}%`}</span>
		</span>
	)
}

/* -------------------------------------------------------------------------------------- the page */

function PageCanvas({
	mode,
	size,
	grid,
	widgets,
	editing,
	selected,
	onSelect,
	onDropNew,
	onMove,
	onResize,
	render,
}: {
	mode: 'daily' | 'review'
	size: { w: number; h: number }
	grid: { cols: number; rows: number }
	widgets: readonly Widget[]
	editing: boolean
	selected: string | null
	onSelect: (id: string | null) => void
	onDropNew: (payload: DragPayload & { kind: 'new' }, cell: { col: number; row: number }) => void
	onMove: (id: string, cell: { col: number; row: number }) => void
	onResize: (id: string, h: number) => void
	render: (widget: Widget) => ReactNode
}) {
	const frame = useRef<HTMLDivElement>(null)
	const gridRef = useRef<HTMLDivElement>(null)
	const [scale, setScale] = useState(1)
	const [hover, setHover] = useState<{ col: number; row: number } | null>(null)
	const [resizing, setResizing] = useState<{ id: string; h: number } | null>(null)

	// The page keeps its paper size and is scaled to fit the column's height (and width).
	useLayoutEffect(() => {
		const el = frame.current
		if (!el) return
		const fit = () => {
			const { width, height } = el.getBoundingClientRect()
			// The A5 page fills the column's height, as on paper; the A4 review, lying on its side, its width,
			// and scrolls when that makes it taller than the column. Neither is drawn larger than life.
			const across = (width - 8) / size.w
			// On a phone the page is as wide as the screen and the screen scrolls, as the review does.
			const phone = window.matchMedia('(max-width: 767px)').matches
			const fit = mode === 'daily' && !phone ? Math.min(across, (height - 8) / size.h) : across
			setScale(Math.max(0.3, Math.min(mode === 'daily' ? 1.4 : 1, fit)))
		}
		fit()
		const observer = new ResizeObserver(fit)
		observer.observe(el)
		return () => observer.disconnect()
	}, [size.w, size.h, mode])

	const cellAt = (x: number, y: number) => {
		const rect = gridRef.current?.getBoundingClientRect()
		if (!rect) return null
		const col = Math.floor(((x - rect.left) / rect.width) * grid.cols)
		const row = Math.floor(((y - rect.top) / rect.height) * grid.rows)
		if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null
		return { col, row }
	}
	const rowHeight = () => (gridRef.current?.getBoundingClientRect().height ?? size.h) / grid.rows

	const free = editing ? freeCells(widgets, grid) : []
	const shown = resizing ? widgets.map((w) => (w.id === resizing.id ? { ...w, h: resizing.h } : w)) : widgets
	const style = { width: size.w, height: size.h, transform: `scale(${scale})` } as CSSProperties

	return (
		<div className="lb-daily__stage">
			<p className="lb-daily__paper lb-daily-faint">
				{mode === 'daily' ? 'A5 page · 148 × 210 mm' : 'A4 page · 297 × 210 mm · landscape'} · {grid.cols} × {grid.rows} snap grid
				{editing && <span> · {free.length} free cell{free.length === 1 ? '' : 's'}</span>}
			</p>
			<div className="lb-daily__frame" ref={frame}>
				<div className="lb-daily__sizer" style={{ width: size.w * scale, height: size.h * scale }}>
					<article className={`lb-daily-sheet lb-daily-sheet--${mode} lb-daily-print`} style={style} onClick={(e) => editing && e.target === e.currentTarget && onSelect(null)}>
						<div
							className="lb-daily-grid"
							ref={gridRef}
							style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${grid.rows}, minmax(0, 1fr))` }}
							onDragOver={(e) => {
								if (!editing || !e.dataTransfer.types.includes(DRAG_TYPE)) return
								e.preventDefault()
								setHover(cellAt(e.clientX, e.clientY))
							}}
							onDragLeave={(e) => {
								if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHover(null)
							}}
							onDrop={(e) => {
								setHover(null)
								const raw = e.dataTransfer.getData(DRAG_TYPE)
								const cell = cellAt(e.clientX, e.clientY)
								if (!raw || !cell) return
								e.preventDefault()
								const payload = JSON.parse(raw) as DragPayload
								if (payload.kind === 'new') onDropNew(payload, cell)
								else onMove(payload.id, cell)
							}}
						>
							{free.map(({ col, row }) => (
								<div key={`${col},${row}`} className="lb-daily-cell" style={{ gridColumn: col + 1, gridRow: row + 1 }} data-hover={hover?.col === col && hover?.row === row ? '' : undefined}>
									<Plus size={14} aria-hidden="true" />
								</div>
							))}
							{shown.map((w) => (
								<div
									key={w.id}
									className="lb-daily-slot"
									data-type={w.type}
									data-selected={editing && selected === w.id ? '' : undefined}
									style={{ gridColumn: `${w.col + 1} / span ${w.w}`, gridRow: `${w.row + 1} / span ${w.h}` }}
									// On a tap, not a touch: a finger put down to scroll the page doesn't select what is under it.
									onClickCapture={() => editing && onSelect(w.id)}
								>
									{editing && (
										<span
											className="lb-daily-slot__grip"
											draggable
											title="Drag to move"
											aria-label="Drag to move"
											onDragStart={(e) => {
												e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind: 'move', id: w.id } satisfies DragPayload))
												e.dataTransfer.effectAllowed = 'move'
											}}
										>
											<GripVertical size={12} aria-hidden="true" />
										</span>
									)}
									{render(w)}
									{editing && selected === w.id && (
										<span
											className="lb-daily-slot__resize"
											role="separator"
											aria-label="Drag to change the height"
											onPointerDown={(e) => {
												e.preventDefault()
												e.stopPropagation()
												const startY = e.clientY
												const start = w.h
												const unit = rowHeight()
												const target = e.currentTarget
												target.setPointerCapture(e.pointerId)
												let h = start
												const move = (ev: PointerEvent) => {
													h = Math.max(1, Math.min(grid.rows - w.row, start + Math.round((ev.clientY - startY) / unit)))
													setResizing({ id: w.id, h })
												}
												const up = () => {
													target.removeEventListener('pointermove', move)
													target.removeEventListener('pointerup', up)
													target.removeEventListener('pointercancel', up)
													setResizing(null)
													onResize(w.id, h)
												}
												target.addEventListener('pointermove', move)
												target.addEventListener('pointerup', up)
												target.addEventListener('pointercancel', up)
											}}
										/>
									)}
								</div>
							))}
						</div>
					</article>
				</div>
			</div>
		</div>
	)
}
