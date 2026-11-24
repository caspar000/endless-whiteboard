import { useValue } from '@lifeboard/canvas'
import { foldText, getItemStamps, resolveItemSource, sourceEntries, type SourceEntry } from '@lifeboard/node-kit'
import { ArrowRight, CalendarDays, Camera, CircleHelp, Heart, HeartOff, Pencil, Plus, Search, Shuffle, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { CatalogueIcon } from '../app/boardLook/iconBridge'
import { ImageLightbox } from '../app/ImageLightbox'
import { createAssetBridge } from '../persistence/assetStore'
import { fetchServerAsset } from '../server/serverVault'
import { useDaily } from './context'
import {
	WEEKDAYS,
	WEEKDAY_LETTERS,
	addDays,
	cycleLabel,
	cycleOf,
	daysOfWeek,
	drawPick,
	fitTiles,
	longDay,
	newId,
	recentPicks,
	shortDay,
	templateTickIds,
	today,
	weekNumber,
	weekOf,
	weekday,
	type BlockTemplate,
	type DayPick,
	type IconTask,
	type Task,
	type Widget,
} from './model'
import { PHOTO_ACCEPT, clockNow, storePhoto, usePhotoUrl } from './photos'
import { updateSetup, updateWeek } from './store'

/** How long the daily pick keeps a draw from coming round again. */
const PICK_MEMORY_DAYS = 30

/** A widget's heading: its own title, its template's name, or the widget's name. */
export function widgetTitle(widget: Widget, templates: readonly BlockTemplate[]): string {
	if (widget.title) return widget.title
	const template = widget.config.templateId ? templates.find((t) => t.id === widget.config.templateId) : undefined
	if (template && widget.type === 'block') return template.name
	return WIDGET_NAMES[widget.type]
}

export const WIDGET_NAMES: Record<Widget['type'], string> = {
	header: 'Page header',
	block: 'Task block',
	tasks: 'TASKS',
	physical: 'PHYSICAL',
	pick: 'DAILY PICK',
	focus: 'FOCUS OF THE DAY',
	notes: 'NOTES',
	reviewLink: 'Weekly review',
	nextWeek: 'NEXT WEEK',
	weeklyTasks: 'WEEKLY TASKS',
	rotation: 'ROTATION CHECK',
	logs: 'LOGS',
	habits: 'HABITS',
	numbers: 'IN NUMBERS',
	creative: 'CREATIVE PROGRESS',
	reflection: 'REFLECTION',
	picks: 'PICKS OF THE WEEK',
}

/** A block's frame: its heading, a count on the right, and what it holds. */
export function Block({ title, meta, children, className, hideHead }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string; hideHead?: boolean }) {
	return (
		<section className={`lb-daily-block ${className ?? ''}`} aria-label={hideHead && typeof title === 'string' ? title : undefined}>
			{!hideHead && (
				<header className="lb-daily-block__head">
					<h3 className="lb-daily-block__title">{title}</h3>
					{meta !== undefined && <span className="lb-daily-block__meta">{meta}</span>}
				</header>
			)}
			<div className="lb-daily-block__body">{children}</div>
		</section>
	)
}

/** The day's widgets, by type. */
export function DailyWidget({ widget }: { widget: Widget }) {
	switch (widget.type) {
		case 'header':
			return <HeaderWidget />
		case 'block':
			return <TemplateBlock widget={widget} />
		case 'tasks':
			return <TasksWidget widget={widget} />
		case 'physical':
			return <PhysicalWidget widget={widget} />
		case 'pick':
			return <PickWidget widget={widget} />
		case 'focus':
			return <FocusWidget widget={widget} />
		case 'notes':
			return <NotesWidget widget={widget} />
		case 'reviewLink':
			return <ReviewLinkWidget />
		default:
			return null
	}
}

/* ------------------------------------------------------------------------------------------ header */

function HeaderWidget() {
	const { setup, day, plan, focus, openDay, openReview, updatePage } = useDaily()
	const week = weekOf(day)
	const isToday = day === today()
	const cycle = cycleOf(setup, plan)
	const area = setup.areas.find((a) => a.id === focus)
	const [choosing, setChoosing] = useState(false)
	const reviewDay = addDays(week, setup.reviewDay)
	return (
		<section className="lb-daily-header">
			<div className="lb-daily-header__date">
				<h2 className="lb-daily-header__day">{longDay(day)}</h2>
				<p className="lb-daily-header__sub">
					{WEEKDAYS[weekday(day)]} · Week {weekNumber(day)}
					{isToday ? ' · Today' : ''}
				</p>
			</div>
			<div className="lb-daily-header__side">
				<div className="lb-daily-header__strip" role="group" aria-label="Days of this week">
					{daysOfWeek(week).map((d, i) => (
						<button
							key={d}
							type="button"
							className="lb-daily-header__letter"
							aria-current={d === day ? 'date' : undefined}
							aria-label={`${WEEKDAYS[i]} ${shortDay(d)}`}
							onClick={() => openDay(d)}
						>
							{WEEKDAY_LETTERS[i]}
						</button>
					))}
					<button type="button" className="lb-daily-chip lb-daily-noprint" onClick={() => openReview(reviewDay)} title="Open the weekly review">
						<CalendarDays size={12} aria-hidden="true" /> Review
					</button>
				</div>
				<p className="lb-daily-header__cycle">
					{cycleLabel(setup, cycle)}
					{area && (
						<>
							{' · today: '}
							<strong style={{ color: area.color }}>{area.name.toUpperCase()}</strong>
						</>
					)}
					<button type="button" className="lb-daily-iconbtn lb-daily-noprint" aria-label="Change today's focus" title="Change today's focus" onClick={() => setChoosing(!choosing)}>
						<Pencil size={12} aria-hidden="true" />
					</button>
				</p>
				{choosing && (
					<div className="lb-daily-chips lb-daily-noprint" role="group" aria-label="Today's focus">
						{setup.areas.map((a) => (
							<button
								key={a.id}
								type="button"
								className="lb-daily-chip"
								aria-pressed={a.id === focus}
								style={{ '--chip': a.color } as React.CSSProperties}
								onClick={() => {
									updatePage((p) => ({ ...p, focusId: a.id }))
									setChoosing(false)
								}}
							>
								{a.name}
							</button>
						))}
						<button
							type="button"
							className="lb-daily-chip"
							onClick={() => {
								updatePage((p) => {
									const { focusId: _, ...rest } = p
									return rest
								})
								setChoosing(false)
							}}
						>
							As the week says
						</button>
					</div>
				)}
			</div>
		</section>
	)
}

/* ---------------------------------------------------------------------------------- icon tasks */

/** A tile to cross out: the icon, struck through with an X once done. */
export function IconTile({ task, done, onToggle, size }: { task: IconTask; done: boolean; onToggle: () => void; size?: number }) {
	return (
		<button
			type="button"
			className="lb-daily-tile"
			aria-pressed={done}
			aria-label={`${task.name}${done ? ', done' : ''}`}
			title={task.name}
			onClick={onToggle}
			style={size ? { width: size, height: size, borderRadius: Math.max(5, Math.round(size * 0.2)) } : undefined}
		>
			<span className="lb-daily-tile__icon">
				{task.icon ? (
					<CatalogueIcon name={task.icon} size={size ? Math.round(size * 0.5) : 22} strokeWidth={1.6} />
				) : (
					<span className="lb-daily-tile__letter" style={size ? { fontSize: Math.round(size * 0.38) } : undefined}>
						{task.name.slice(0, 1).toUpperCase()}
					</span>
				)}
			</span>
			{done && (
				<svg className="lb-daily-tile__cross" viewBox="0 0 40 40" aria-hidden="true">
					<path d="M5 5 L35 35 M35 5 L5 35" />
				</svg>
			)}
		</button>
	)
}

function useToggleTick() {
	const { updatePage } = useDaily()
	return (id: string) =>
		updatePage((p) => ({ ...p, ticks: p.ticks.includes(id) ? p.ticks.filter((t) => t !== id) : [...p.ticks, id] }))
}

function useIconTasks(template: BlockTemplate): IconTask[] {
	const { setup } = useDaily()
	return template.iconTaskIds.flatMap((id) => setup.iconTasks.find((t) => t.id === id) ?? [])
}

/** A template's icon tasks in a row that wraps, at their own size: Physical's, beside its numbers. */
function IconTiles({ template }: { template: BlockTemplate }) {
	const { page } = useDaily()
	const toggle = useToggleTick()
	const tasks = useIconTasks(template)
	return (
		<div className="lb-daily-tiles">
			{tasks.map((t) => (
				<IconTile key={t.id} task={t} done={page.ticks.includes(t.id)} onToggle={() => toggle(t.id)} />
			))}
		</div>
	)
}

const TILE_GAP = 6

/**
 * A block's icon tasks on a grid that fills the room the block leaves them, the tiles growing or
 * shrinking with it: rows by columns as the widget says, or whatever draws them largest. Measured
 * unscaled (`clientWidth`), since the page around it is scaled to fit the screen.
 */
function IconGrid({ template, rows, cols }: { template: BlockTemplate; rows?: number; cols?: number }) {
	const { page } = useDaily()
	const toggle = useToggleTick()
	const tasks = useIconTasks(template)
	const box = useRef<HTMLDivElement>(null)
	const [room, setRoom] = useState({ width: 0, height: 0 })
	useLayoutEffect(() => {
		const el = box.current
		if (!el) return
		const measure = () => setRoom((was) => (was.width === el.clientWidth && was.height === el.clientHeight ? was : { width: el.clientWidth, height: el.clientHeight }))
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [])
	// Left to itself a tile stays the size it always was; on a grid set by hand it may grow larger.
	const fit = fitTiles(tasks.length, room, { rows, cols }, { gap: TILE_GAP, min: 16, max: rows || cols ? 96 : 44 })
	return (
		<div ref={box} className="lb-daily-icongrid">
			<div className="lb-daily-tiles lb-daily-tiles--grid" style={{ gridTemplateColumns: `repeat(${fit.cols}, ${fit.size}px)`, gap: TILE_GAP }}>
				{tasks.map((t) => (
					<IconTile key={t.id} task={t} size={fit.size} done={page.ticks.includes(t.id)} onToggle={() => toggle(t.id)} />
				))}
			</div>
		</div>
	)
}

function Check({ done, text, onToggle, extra, onRemove }: { done: boolean; text: string; onToggle: () => void; extra?: ReactNode; onRemove?: () => void }) {
	return (
		<li className="lb-daily-check" data-done={done || undefined}>
			<label>
				<input type="checkbox" checked={done} onChange={onToggle} />
				<span className="lb-daily-check__text">{text}</span>
			</label>
			{extra}
			{onRemove && (
				<button type="button" className="lb-daily-iconbtn lb-daily-check__remove lb-daily-noprint" aria-label={`Remove ${text}`} onClick={onRemove}>
					<X size={12} aria-hidden="true" />
				</button>
			)}
		</li>
	)
}

function TemplateBlock({ widget }: { widget: Widget }) {
	const { setup, page } = useDaily()
	const template = setup.templates.find((t) => t.id === widget.config.templateId)
	const title = widgetTitle(widget, setup.templates)
	if (!template) {
		return (
			<Block title={title}>
				<p className="lb-daily-empty">Its template was deleted. Pick another in the Inspector.</p>
			</Block>
		)
	}
	const ids = templateTickIds(template)
	const done = ids.filter((id) => page.ticks.includes(id)).length
	return (
		<Block title={title} meta={`${done}/${ids.length}`} className="lb-daily-block--grid" hideHead={widget.config.hideTitle}>
			{!ids.length && <p className="lb-daily-empty">Nothing in it yet: add icon tasks or a checklist in the Inspector.</p>}
			{template.iconTaskIds.length > 0 && <IconGrid template={template} rows={widget.config.iconRows} cols={widget.config.iconCols} />}
			<Checklist template={template} />
		</Block>
	)
}

/** A template's checklist, under its icon tasks. */
function Checklist({ template }: { template: BlockTemplate }) {
	const { page } = useDaily()
	const toggle = useToggleTick()
	if (!template.items.length) return null
	return (
		<ul className="lb-daily-checks">
			{template.items.map((item) => (
				<Check key={item.id} done={page.ticks.includes(item.id)} text={item.text} onToggle={() => toggle(item.id)} />
			))}
		</ul>
	)
}

/* --------------------------------------------------------------------------------------- tasks */

/** A line to type a new task into, added on Enter. */
function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (text: string) => void }) {
	const [text, setText] = useState('')
	const add = () => {
		if (!text.trim()) return
		onAdd(text.trim())
		setText('')
	}
	return (
		<div className="lb-daily-addrow lb-daily-noprint">
			<input
				className="lb-daily-input"
				placeholder={placeholder}
				aria-label={placeholder}
				value={text}
				onChange={(e) => setText(e.target.value)}
				onKeyDown={(e) => {
					if (e.key === 'Enter') add()
				}}
			/>
			<button type="button" className="lb-daily-iconbtn" aria-label="Add" onClick={add}>
				<Plus size={14} aria-hidden="true" />
			</button>
		</div>
	)
}

/** A day's own list in a widget: what was typed there, and what was carried from an earlier day. */
function OwnTasks({ widget, placeholder }: { widget: Widget; placeholder: string }) {
	const { page, updatePage } = useDaily()
	const tasks = page.lists[widget.id] ?? []
	const set = (change: (tasks: Task[]) => Task[]) => updatePage((p) => ({ ...p, lists: { ...p.lists, [widget.id]: change(p.lists[widget.id] ?? []) } }))
	return (
		<>
			<ul className="lb-daily-checks">
				{tasks.map((t) => (
					<Check
						key={t.id}
						done={t.done}
						text={t.text}
						onToggle={() => set((list) => list.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))}
						onRemove={() => set((list) => list.filter((x) => x.id !== t.id))}
						extra={t.from ? <span className="lb-daily-badge">from {WEEKDAYS[weekday(t.from)]!.slice(0, 3)}</span> : undefined}
					/>
				))}
			</ul>
			<AddRow placeholder={placeholder} onAdd={(text) => set((list) => [...list, { id: newId('t'), text, done: false }])} />
		</>
	)
}

function TasksWidget({ widget }: { widget: Widget }) {
	const { setup, page, day, plan } = useDaily()
	const own = page.lists[widget.id] ?? []
	// The week's tasks put on this day in the review.
	const fromWeek = (plan?.tasks ?? []).filter((t) => t.day === day)
	const all = [...own, ...fromWeek]
	const done = all.filter((t) => t.done).length
	const toggleWeek = (id: string) =>
		updateWeek(weekOf(day), (w) => ({ ...w, tasks: w.tasks.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) }))
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={all.length ? `${done}/${all.length} done` : undefined}>
			{fromWeek.length > 0 && (
				<ul className="lb-daily-checks">
					{fromWeek.map((t) => (
						<Check key={t.id} done={t.done} text={t.text} onToggle={() => toggleWeek(t.id)} extra={<span className="lb-daily-badge">week</span>} />
					))}
				</ul>
			)}
			<OwnTasks widget={widget} placeholder="Add a task, press Enter" />
		</Block>
	)
}

/* ------------------------------------------------------------------------------------ physical */

function PhysicalWidget({ widget }: { widget: Widget }) {
	const { setup, page, updatePage, blobs } = useDaily()
	const template = setup.templates.find((t) => t.id === widget.config.templateId)
	const metrics = (widget.config.metricIds ?? []).flatMap((id) => setup.metrics.find((m) => m.id === id) ?? [])
	const ids = template ? templateTickIds(template) : []
	const done = ids.filter((id) => page.ticks.includes(id)).length
	const camera = useRef<HTMLInputElement>(null)
	const [saving, setSaving] = useState(false)
	const [refused, setRefused] = useState('')
	const addPhotos = async (files: FileList | null) => {
		if (!files?.length) return
		setSaving(true)
		setRefused('')
		try {
			for (const file of Array.from(files)) {
				const hash = await storePhoto(blobs, file)
				if (!hash) {
					setRefused(`${file.name} isn’t a photo the food log keeps.`)
					continue
				}
				const at = clockNow(new Date(file.lastModified || Date.now()))
				updatePage((p) => (p.food.some((f) => f.hash === hash) ? p : { ...p, food: [...p.food, { hash, at }] }))
			}
		} catch (error) {
			console.error('Lifeboard: could not keep a food photo.', error)
		} finally {
			setSaving(false)
		}
	}
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={ids.length ? `${done}/${ids.length}` : undefined}>
			<div className="lb-daily-physical__top">
				{template && template.iconTaskIds.length > 0 && <IconTiles template={template} />}
				{metrics.map((m) => (
					<label key={m.id} className="lb-daily-number">
						<span>{m.name}</span>
						<input
							className="lb-daily-input lb-daily-input--number"
							type="number"
							inputMode="decimal"
							step="any"
							placeholder="—"
							value={page.numbers[m.id] ?? ''}
							onChange={(e) => {
								const value = e.target.value === '' ? undefined : Number(e.target.value)
								updatePage((p) => {
									const numbers = { ...p.numbers }
									if (value === undefined || !Number.isFinite(value)) delete numbers[m.id]
									else numbers[m.id] = value
									return { ...p, numbers }
								})
							}}
						/>
						{m.unit && <span className="lb-daily-number__unit">{m.unit}</span>}
					</label>
				))}
			</div>
			{template && <Checklist template={template} />}
			{widget.config.fasting !== false && (
				<div className="lb-daily-row">
					<span className="lb-daily-label">Fasting</span>
					<div className="lb-daily-seg" role="group" aria-label="Fasting">
						{[{ id: '', name: 'None' }, ...setup.fasting].map((f) => (
							<button key={f.id || 'none'} type="button" aria-pressed={page.fasting === f.id} onClick={() => updatePage((p) => ({ ...p, fasting: f.id }))}>
								{f.name}
							</button>
						))}
					</div>
				</div>
			)}
			{widget.config.food !== false && (
				<div className="lb-daily-food">
					<span className="lb-daily-label">
						Food log <span className="lb-daily-faint">{page.food.length ? `${page.food.length} photo${page.food.length === 1 ? '' : 's'}` : ''}</span>
					</span>
					<div className="lb-daily-food__row">
						<button type="button" className="lb-daily-food__add lb-daily-noprint" aria-label="Add a food photo" title="Take or choose a photo" disabled={saving} onClick={() => camera.current?.click()}>
							<Camera size={16} aria-hidden="true" />
						</button>
						<input
							ref={camera}
							type="file"
							accept={PHOTO_ACCEPT}
							capture="environment"
							multiple
							hidden
							onChange={(e) => {
								void addPhotos(e.target.files)
								e.target.value = ''
							}}
						/>
						{page.food.map((photo) => (
							<FoodPhoto key={photo.hash} hash={photo.hash} at={photo.at} onRemove={() => updatePage((p) => ({ ...p, food: p.food.filter((f) => f.hash !== photo.hash) }))} />
						))}
					</div>
					{refused && (
						<p className="lb-daily-empty lb-daily-noprint" role="status">
							{refused}
						</p>
					)}
				</div>
			)}
		</Block>
	)
}

function FoodPhoto({ hash, at, onRemove }: { hash: string; at: string; onRemove: () => void }) {
	const { blobs } = useDaily()
	const url = usePhotoUrl(blobs, hash)
	const [open, setOpen] = useState(false)
	const alt = `Food at ${at}`
	return (
		<figure className="lb-daily-food__photo">
			{url ? (
				<button type="button" className="lb-daily-food__open" aria-label={`Show the photo from ${at}`} onClick={() => setOpen(true)}>
					<img src={url} alt={alt} />
				</button>
			) : (
				<span className="lb-daily-food__loading" />
			)}
			{open && url && <ImageLightbox image={{ src: url, alt }} onClose={() => setOpen(false)} />}
			<figcaption>{at}</figcaption>
			<button type="button" className="lb-daily-food__remove lb-daily-noprint" aria-label={`Remove the photo from ${at}`} onClick={onRemove}>
				<X size={10} aria-hidden="true" />
			</button>
		</figure>
	)
}

/* ----------------------------------------------------------------------------------- daily pick */

/** A cover: an address, or a picture in the asset store. */
export function Cover({ src, alt }: { src: string; alt: string }) {
	const { blobs } = useDaily()
	const [url, setUrl] = useState<string | null>(src.startsWith('asset:') ? null : src || null)
	useEffect(() => {
		if (!src.startsWith('asset:')) {
			setUrl(src || null)
			return
		}
		let live = true
		void createAssetBridge(blobs, fetchServerAsset)
			.resolveUrl(src)
			.then((u) => live && setUrl(u))
			.catch(() => {})
		return () => {
			live = false
		}
	}, [blobs, src])
	return url ? <img className="lb-daily-cover" src={url} alt={alt} loading="lazy" /> : <span className="lb-daily-cover lb-daily-cover--empty" aria-hidden="true" />
}

const STAMP_BUTTONS = [
	{ id: 'liked', label: 'Liked', icon: Heart },
	{ id: 'disliked', label: 'Disliked', icon: HeartOff },
	{ id: 'unsure', label: 'Unsure', icon: CircleHelp },
] as const

/** The board a pick widget files its stamps on, by name. */
function useBoardName(boardId: string | undefined): string | null {
	const { boards } = useDaily()
	return boardId ? (boards.find((b) => b.id === boardId)?.name ?? null) : null
}

function PickWidget({ widget }: { widget: Widget }) {
	const { setup, page, pages, day, updatePage, editing, boards, openBoard } = useDaily()
	const source = widget.config.source ?? ''
	const board = widget.config.board ?? ''
	const resolved = useValue('lifeboard:daily-pick-source', () => resolveItemSource(source), [source])
	const entries = useValue('lifeboard:daily-pick-entries', () => (source ? sourceEntries(source) : []), [source])
	const stamps = useValue('lifeboard:daily-pick-stamps', () => getItemStamps(), [])
	useEffect(() => (resolved.source ? resolved.source.watch?.(resolved.choiceId) : undefined), [resolved.source, resolved.choiceId])
	const stored = page.picks[widget.id]
	const isToday = day === today()
	const boardName = useBoardName(board)
	const [searching, setSearching] = useState(false)

	// The pick of a day nobody drew for yet: today's is drawn and kept the first time it is shown, so it
	// stays put whatever the list does later. Another day's is left alone.
	const draw = (draws: number, alsoSkip?: string): DayPick | null => {
		const skip = recentPicks(pages, day, PICK_MEMORY_DAYS)
		if (alsoSkip) skip.add(alsoSkip)
		if (stamps && board) for (const e of entries) if (stamps.stampOf(e, board)) skip.add(e.id)
		const entry = drawPick(entries, day, draws, skip)
		return entry ? { source, id: entry.id, title: entry.title, creator: entry.creator, year: entry.year, cover: entry.cover, url: entry.url, draws, stamp: '', impression: '' } : null
	}
	const drawn = isToday && (!stored || stored.source !== source) ? draw(0) : null
	useEffect(() => {
		if (isToday && drawn && (!stored || stored.source !== source)) updatePage((p) => ({ ...p, picks: { ...p.picks, [widget.id]: drawn } }))
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [isToday, drawn?.id, source, widget.id])
	// Another day keeps what it drew, even from a list the widget no longer draws from.
	const pick = stored && (stored.source === source || !isToday) ? stored : drawn

	const setPick = (next: DayPick) => updatePage((p) => ({ ...p, picks: { ...p.picks, [widget.id]: next } }))
	// A stamp is always kept on the page; it is filed on the board too once there is one to file it on.
	const fileOn = stamps?.stamp && board ? stamps.stamp : null
	const stamp = (kind: string) => {
		if (!pick) return
		const next = pick.stamp === kind ? '' : kind
		fileOn?.({ boardId: board, card: `daily-${day}`, source: pick.source, entry: pick, kind: next || null, date: day })
		setPick({ ...pick, stamp: next })
	}
	const another = () => {
		if (!pick) return
		const next = draw(pick.draws + 1, pick.id)
		if (next) setPick(next)
	}
	// One chosen by hand, say an album already heard apart from the draw: it is the day's pick from now
	// on, with a stamp and an impression of its own.
	const choose = (entry: SourceEntry) => {
		const { id, title, creator, year, cover, url } = entry
		setPick({ source, id, title, creator, year, cover, url, draws: pick?.draws ?? 0, stamp: '', impression: '' })
		setSearching(false)
	}
	const title = widgetTitle(widget, setup.templates)

	if (!source || resolved.type !== 'source') {
		return (
			<Block title={title} meta={resolved.type === 'missing' ? 'List gone' : undefined}>
				<p className="lb-daily-empty">{editing ? 'Choose a list to draw from in the Inspector.' : 'No list to draw from yet.'}</p>
			</Block>
		)
	}
	return (
		<Block title={title} meta={resolved.source?.label === 'Randomizer stamps' ? resolved.name : 'Randomizer'}>
			{searching ? (
				<PickSearch entries={entries} listName={resolved.name} onChoose={choose} onClose={() => setSearching(false)} />
			) : !pick ? (
				<>
					<p className="lb-daily-empty">{day > today() ? 'Draws that morning.' : entries.length ? 'Not drawn that day.' : `${resolved.name} is empty.`}</p>
					{entries.length > 0 && (
						<button type="button" className="lb-daily-linkbtn lb-daily-noprint" onClick={() => setSearching(true)}>
							<Search size={12} aria-hidden="true" /> Choose one
						</button>
					)}
				</>
			) : (
				<>
					<div className="lb-daily-pick">
						{pick.url ? (
							<a href={pick.url} target="_blank" rel="noreferrer">
								<Cover src={pick.cover} alt="" />
							</a>
						) : (
							<Cover src={pick.cover} alt="" />
						)}
						<div className="lb-daily-pick__text">
							<span className="lb-daily-faint">from {resolved.name}</span>
							<strong className="lb-daily-pick__title">{pick.title}</strong>
							<span className="lb-daily-pick__by">
								{[pick.creator, pick.year].filter(Boolean).join(' · ')}
							</span>
							<div className="lb-daily-stamps" role="group" aria-label="Stamp it">
								{STAMP_BUTTONS.map(({ id, label, icon: Icon }) => (
									<button
										key={id}
										type="button"
										className="lb-daily-chip"
										aria-pressed={pick.stamp === id}
										title={fileOn ? `${label}, saved to ${boardName ?? 'the board'}` : `${label}, kept on this page`}
										onClick={() => stamp(id)}
									>
										<Icon size={11} aria-hidden="true" /> {label}
									</button>
								))}
							</div>
						</div>
					</div>
					<input
						className="lb-daily-input lb-daily-pick__impression"
						placeholder="One-line impression…"
						aria-label="One-line impression"
						value={pick.impression}
						onChange={(e) => setPick({ ...pick, impression: e.target.value })}
					/>
					<div className="lb-daily-pick__foot lb-daily-noprint">
						<span className="lb-daily-pick__actions">
							<button type="button" className="lb-daily-linkbtn" onClick={another} disabled={entries.length < 2}>
								<Shuffle size={12} aria-hidden="true" /> Another one
							</button>
							<button type="button" className="lb-daily-linkbtn" onClick={() => setSearching(true)} title={`Search ${resolved.name} for one to pick`}>
								<Search size={12} aria-hidden="true" /> Search
							</button>
						</span>
						{!stamps?.stamp ? (
							<span className="lb-daily-faint">Randomizer off: stamps stay on this page</span>
						) : board ? (
							<button
								type="button"
								className="lb-daily-chip"
								title="Open the board its stamps are saved to"
								onClick={() => {
									const b = boards.find((x) => x.id === board)
									if (b) openBoard(b)
								}}
							>
								Save to <ArrowRight size={11} aria-hidden="true" /> {boardName ?? 'a board that is gone'}
							</button>
						) : (
							<span className="lb-daily-faint">No board: stamps stay on this page</span>
						)}
					</div>
				</>
			)}
		</Block>
	)
}

/** How many matches the pick's search lists at once. */
const SEARCH_SHOWN = 8

/** Looks through the pick's list for one to make the day's pick: every word typed has to match. */
function PickSearch({ entries, listName, onChoose, onClose }: { entries: readonly SourceEntry[]; listName: string; onChoose: (entry: SourceEntry) => void; onClose: () => void }) {
	const [query, setQuery] = useState('')
	const words = foldText(query).split(' ').filter(Boolean)
	const found = words.length ? entries.filter((e) => words.every((w) => foldText(`${e.title} ${e.creator} ${e.year}`).includes(w))) : []
	return (
		<div className="lb-daily-picksearch lb-daily-noprint">
			<div className="lb-daily-addrow">
				{/* eslint-disable-next-line jsx-a11y/no-autofocus */}
				<input
					autoFocus
					className="lb-daily-input"
					placeholder={`Search ${listName}…`}
					aria-label={`Search ${listName}`}
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === 'Escape') onClose()
						if (e.key === 'Enter' && found[0]) onChoose(found[0])
					}}
				/>
				<button type="button" className="lb-daily-iconbtn" aria-label="Close the search" onClick={onClose}>
					<X size={14} aria-hidden="true" />
				</button>
			</div>
			{words.length > 0 &&
				(found.length ? (
					<ul className="lb-daily-picksearch__list">
						{found.slice(0, SEARCH_SHOWN).map((e) => (
							<li key={e.id}>
								<button type="button" className="lb-daily-picksearch__item" onClick={() => onChoose(e)}>
									<strong>{e.title}</strong>
									<span className="lb-daily-faint">{[e.creator, e.year].filter(Boolean).join(' · ')}</span>
								</button>
							</li>
						))}
						{found.length > SEARCH_SHOWN && <li className="lb-daily-faint">{found.length - SEARCH_SHOWN} more: type more of the name</li>}
					</ul>
				) : (
					<p className="lb-daily-empty">Nothing in {listName} matches.</p>
				))}
		</div>
	)
}

/* -------------------------------------------------------------------------------------- focus */

function FocusWidget({ widget }: { widget: Widget }) {
	const { setup, page, focus, plan } = useDaily()
	const toggle = useToggleTick()
	const area = setup.areas.find((a) => a.id === focus)
	const own = page.lists[widget.id] ?? []
	const total = (area?.tasks.length ?? 0) + own.length
	const done = (area?.tasks.filter((t) => page.ticks.includes(t.id)).length ?? 0) + own.filter((t) => t.done).length
	const left = total - done
	const cycle = cycleOf(setup, plan)
	return (
		<Block title={widgetTitle(widget, setup.templates)} meta={total ? `${done}/${total}` : undefined}>
			{!area ? (
				<p className="lb-daily-empty">No focus today: set this week's cycle, or pick one in the header.</p>
			) : (
				<>
					<p className="lb-daily-focus__area">
						<strong style={{ color: area.color }}>{area.name.toUpperCase()}</strong>
						{cycle && <span className="lb-daily-faint"> {cycleLabel(setup, cycle)}</span>}
					</p>
					<div className="lb-daily-bar" aria-hidden="true">
						<span style={{ width: `${total ? (done / total) * 100 : 0}%`, background: area.color }} />
					</div>
					<ul className="lb-daily-checks">
						{area.tasks.map((t) => (
							<Check key={t.id} done={page.ticks.includes(t.id)} text={t.text} onToggle={() => toggle(t.id)} />
						))}
					</ul>
					<OwnTasks widget={widget} placeholder={`Add a ${area.name} task`} />
					{total > 0 && (
						<p className="lb-daily-faint lb-daily-focus__left">
							{left ? `${left} left to close today's ${area.name} cycle` : `Today's ${area.name} cycle is closed`}
						</p>
					)}
				</>
			)}
		</Block>
	)
}

/* --------------------------------------------------------------------------------- notes, link */

function NotesWidget({ widget }: { widget: Widget }) {
	const { setup, page, updatePage } = useDaily()
	return (
		<Block title={widgetTitle(widget, setup.templates)}>
			<textarea
				className="lb-daily-notes"
				aria-label="Notes"
				placeholder="Anything for today…"
				value={page.notes[widget.id] ?? ''}
				onChange={(e) => updatePage((p) => ({ ...p, notes: { ...p.notes, [widget.id]: e.target.value } }))}
			/>
		</Block>
	)
}

function ReviewLinkWidget() {
	const { setup, day, openReview } = useDaily()
	const reviewDay = addDays(weekOf(day), setup.reviewDay)
	const days = Math.round((new Date(`${reviewDay}T12:00`).getTime() - new Date(`${day}T12:00`).getTime()) / 86_400_000)
	const when = days === 0 ? 'today' : days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : `${-days} day${days === -1 ? '' : 's'} ago`
	return (
		<button type="button" className="lb-daily-reviewlink" onClick={() => openReview(reviewDay)}>
			<CalendarDays size={16} aria-hidden="true" />
			<span>
				<strong>Weekly review</strong>
				<span className="lb-daily-faint">
					{WEEKDAYS[setup.reviewDay]!.slice(0, 3)} {shortDay(reviewDay)} · {when}
				</span>
			</span>
			<ArrowRight size={14} aria-hidden="true" className="lb-daily-noprint" />
		</button>
	)
}

/** Keeps the setup's area tasks editable from a focus widget's inspector. */
export function setAreaTasks(areaId: string, tasks: { id: string; text: string }[]): void {
	updateSetup((s) => ({ ...s, areas: s.areas.map((a) => (a.id === areaId ? { ...a, tasks } : a)) }))
}

