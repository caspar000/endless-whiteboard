import { useValue } from '@lifeboard/canvas'
import { getItemStamps, resolveItemSource, sourceEntries } from '@lifeboard/node-kit'
import { ArrowRight, CalendarDays, Camera, CircleHelp, Heart, HeartOff, Pencil, Plus, Shuffle, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CatalogueIcon } from '../app/boardLook/iconBridge'
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
	longDay,
	newId,
	recentPicks,
	shortDay,
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
import { clockNow, storePhoto, usePhotoUrl } from './photos'
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
export function Block({ title, meta, children, className }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
	return (
		<section className={`lb-daily-block ${className ?? ''}`}>
			<header className="lb-daily-block__head">
				<h3 className="lb-daily-block__title">{title}</h3>
				{meta !== undefined && <span className="lb-daily-block__meta">{meta}</span>}
			</header>
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
export function IconTile({ task, done, onToggle }: { task: IconTask; done: boolean; onToggle: () => void }) {
	return (
		<button
			type="button"
			className="lb-daily-tile"
			aria-pressed={done}
			aria-label={`${task.name}${done ? ', done' : ''}`}
			title={task.name}
			onClick={onToggle}
		>
			<span className="lb-daily-tile__icon">
				{task.icon ? <CatalogueIcon name={task.icon} size={22} strokeWidth={1.6} /> : <span className="lb-daily-tile__letter">{task.name.slice(0, 1).toUpperCase()}</span>}
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

function IconTiles({ template }: { template: BlockTemplate }) {
	const { setup, page } = useDaily()
	const toggle = useToggleTick()
	const tasks = template.iconTaskIds.flatMap((id) => setup.iconTasks.find((t) => t.id === id) ?? [])
	if (!tasks.length) return <p className="lb-daily-empty">No icon tasks yet: add them in the Inspector.</p>
	return (
		<div className="lb-daily-tiles">
			{tasks.map((t) => (
				<IconTile key={t.id} task={t} done={page.ticks.includes(t.id)} onToggle={() => toggle(t.id)} />
			))}
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
	const toggle = useToggleTick()
	const template = setup.templates.find((t) => t.id === widget.config.templateId)
	const title = widgetTitle(widget, setup.templates)
	if (!template) {
		return (
			<Block title={title}>
				<p className="lb-daily-empty">Its template was deleted. Pick another in the Inspector.</p>
			</Block>
		)
	}
	const ids = template.kind === 'icons' ? template.iconTaskIds : template.items.map((i) => i.id)
	const done = ids.filter((id) => page.ticks.includes(id)).length
	return (
		<Block title={title} meta={`${done}/${ids.length}`}>
			{template.kind === 'icons' ? (
				<IconTiles template={template} />
			) : (
				<ul className="lb-daily-checks">
					{template.items.map((item) => (
						<Check key={item.id} done={page.ticks.includes(item.id)} text={item.text} onToggle={() => toggle(item.id)} />
					))}
				</ul>
			)}
		</Block>
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
	const ids = template ? (template.kind === 'icons' ? template.iconTaskIds : template.items.map((i) => i.id)) : []
	const done = ids.filter((id) => page.ticks.includes(id)).length
	const camera = useRef<HTMLInputElement>(null)
	const [saving, setSaving] = useState(false)
	const addPhotos = async (files: FileList | null) => {
		if (!files?.length) return
		setSaving(true)
		try {
			for (const file of Array.from(files)) {
				const hash = await storePhoto(blobs, file)
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
				{template?.kind === 'icons' && <IconTiles template={template} />}
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
							accept="image/*"
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
				</div>
			)}
		</Block>
	)
}

function FoodPhoto({ hash, at, onRemove }: { hash: string; at: string; onRemove: () => void }) {
	const { blobs } = useDaily()
	const url = usePhotoUrl(blobs, hash)
	return (
		<figure className="lb-daily-food__photo">
			{url ? (
				<a href={url} target="_blank" rel="noreferrer">
					<img src={url} alt={`Food at ${at}`} />
				</a>
			) : (
				<span className="lb-daily-food__loading" />
			)}
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
	const stamp = (kind: string) => {
		if (!pick) return
		const next = pick.stamp === kind ? '' : kind
		stamps?.stamp?.({ boardId: board, card: `daily-${day}`, source: pick.source, entry: pick, kind: next || null, date: day })
		setPick({ ...pick, stamp: next })
	}
	const another = () => {
		if (!pick) return
		const next = draw(pick.draws + 1, pick.id)
		if (next) setPick(next)
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
			{!pick ? (
				<p className="lb-daily-empty">{day > today() ? 'Draws that morning.' : entries.length ? 'Not drawn that day.' : `${resolved.name} is empty.`}</p>
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
										disabled={!stamps?.stamp || !board}
										title={!stamps?.stamp ? 'Turn the Randomizer on to stamp' : !board ? 'Choose a board to save to first' : `${label}, saved to ${boardName ?? 'the board'}`}
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
						<button type="button" className="lb-daily-linkbtn" onClick={another} disabled={entries.length < 2}>
							<Shuffle size={12} aria-hidden="true" /> Another one
						</button>
						{board ? (
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
							<span className="lb-daily-faint">No board to save to</span>
						)}
					</div>
				</>
			)}
		</Block>
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

