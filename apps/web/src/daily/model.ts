/**
 * The daily page (DARK-17): an A5 page a day, built like a dashboard from widgets on a grid, and a
 * weekly review on the review day, built the same way from the week's pages.
 *
 * Three things are kept, all in the vault (`store.ts`):
 *
 * - **The setup**, one record: the areas you rotate through, the week cycles made of them, the
 *   numbers you track, the fasting kinds, the icon tasks and the block templates made of them, the
 *   lists the review logs into, and the layouts of the daily page and of the review. Nothing in it
 *   is fixed by the code: `defaultSetup` is only where a vault starts.
 * - **A page per day**, keyed by its date: what was ticked, the day's own tasks, numbers, fasting,
 *   food photos, the daily pick and notes.
 * - **A plan per week**, keyed by its Monday: the cycle chosen for it, its evenings, its weekly tasks,
 *   and what the review writes down.
 *
 * Everything here is pure, so it can be tested without a browser.
 */

/* ------------------------------------------------------------------------------------------ days */

/** A local day as `YYYY-MM-DD`, as the randomizer dates its stamps. */
export type Day = string

const pad = (n: number) => String(n).padStart(2, '0')

export function dayOf(date: Date): Day {
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function today(): Day {
	return dayOf(new Date())
}

export function isDay(value: unknown): value is Day {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(toDate(value).getTime())
}

/** Noon, so a change of clocks never moves it to another day. */
export function toDate(day: Day): Date {
	const [y = 1970, m = 1, d = 1] = day.split('-').map(Number)
	return new Date(y, m - 1, d, 12)
}

export function addDays(day: Day, n: number): Day {
	const date = toDate(day)
	date.setDate(date.getDate() + n)
	return dayOf(date)
}

/** Monday is 0, Sunday 6: weeks start on Monday, as the page's day strip does. */
export function weekday(day: Day): number {
	return (toDate(day).getDay() + 6) % 7
}

/** The Monday of a day's week: the key its week plan is kept under. */
export function weekOf(day: Day): Day {
	return addDays(day, -weekday(day))
}

export function daysOfWeek(week: Day): Day[] {
	return Array.from({ length: 7 }, (_, i) => addDays(week, i))
}

/** The ISO week number. */
export function weekNumber(day: Day): number {
	const date = toDate(day)
	date.setDate(date.getDate() + 3 - weekday(day))
	const firstThursday = new Date(date.getFullYear(), 0, 4, 12)
	return 1 + Math.round((date.getTime() - firstThursday.getTime()) / 86_400_000 / 7 - (3 - ((firstThursday.getDay() + 6) % 7)) / 7)
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'] as const
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** `2026 Nov 24`, as the page's header writes it. */
export function longDay(day: Day): string {
	const date = toDate(day)
	return `${date.getFullYear()} ${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** `Nov 24`. */
export function shortDay(day: Day): string {
	const date = toDate(day)
	return `${MONTHS[date.getMonth()]} ${date.getDate()}`
}

/** `23 – 29 Nov 2026`, or across months `30 Nov – 6 Dec 2026`. */
export function weekRange(week: Day): string {
	const first = toDate(week)
	const last = toDate(addDays(week, 6))
	const end = `${last.getDate()} ${MONTHS[last.getMonth()]} ${last.getFullYear()}`
	if (first.getMonth() === last.getMonth()) return `${first.getDate()} – ${end}`
	if (first.getFullYear() === last.getFullYear()) return `${first.getDate()} ${MONTHS[first.getMonth()]} – ${end}`
	return `${first.getDate()} ${MONTHS[first.getMonth()]} ${first.getFullYear()} – ${end}`
}

/* ----------------------------------------------------------------------------------------- setup */

/** Something you rotate through: Music, Game dev, Art, Family, Rest. */
export interface Area {
	id: string
	name: string
	color: string
	/** The tasks a day with this focus has, every time: "Figure drawing 30 min". */
	tasks: TaskText[]
}

export interface TaskText {
	id: string
	text: string
}

/** One week of the rotation: W1, Music & Game dev. Its days take its areas in turn. */
export interface Cycle {
	id: string
	name: string
	areaIds: string[]
}

export type MetricTotal = 'avg' | 'sum'

/** A number you write down on a day: weight, pages read, minutes at the piano. */
export interface Metric {
	id: string
	name: string
	unit: string
	/** How a week adds it up: weight averages, pages add up. */
	total: MetricTotal
}

/** A kind of fast: IF 16:8, ADF, 24h. A day with none chosen did not fast. */
export interface FastingKind {
	id: string
	name: string
}

/** A tile to cross out: brush teeth, shower, listen to an album. */
export interface IconTask {
	id: string
	name: string
	/** A board icon's name (`app/boardLook/boardIcons.ts`), or '' for the name's first letter. */
	icon: string
}

/** What a block holds: icon tasks to cross out, a checklist under them, or both. */
export interface BlockContents {
	/** Its icon tasks, in order. */
	iconTaskIds: string[]
	/** Its checklist: "Download album", "Prepare bags". */
	items: TaskText[]
}

/**
 * MORNING, HABITS, EVENING: a block made once and put on any number of pages. A block on a page
 * follows it until that page changes the block's contents, which are then the block's own.
 */
export interface BlockTemplate extends BlockContents {
	id: string
	name: string
}

/** Everything a block has to tick: its icon tasks, then its checklist. */
export function templateTickIds(contents: BlockContents): string[] {
	return [...contents.iconTaskIds, ...contents.items.map((i) => i.id)]
}

export function templateOf(setup: DailySetup, widget: Widget): BlockTemplate | undefined {
	return widget.config.templateId ? setup.templates.find((t) => t.id === widget.config.templateId) : undefined
}

/** What a block or a physical widget shows: its own contents, else its template's. */
export function blockContents(setup: DailySetup, widget: Widget): BlockContents | undefined {
	return widget.config.contents ?? templateOf(setup, widget)
}

/** Every checklist item there is, in a template or in a block of its own, for naming what a tick was. */
export function checklistItems(setup: DailySetup): TaskText[] {
	const seen = new Map<string, TaskText>()
	for (const t of setup.templates) for (const i of t.items) if (!seen.has(i.id)) seen.set(i.id, i)
	for (const l of setup.layouts) for (const w of l.widgets) for (const i of w.config.contents?.items ?? []) if (!seen.has(i.id)) seen.set(i.id, i)
	return [...seen.values()]
}

/** How many layouts have a block that follows the template (one with contents of its own doesn't). */
export function templateUse(setup: DailySetup, templateId: string): number {
	return setup.layouts.filter((l) => l.widgets.some((w) => w.config.templateId === templateId && !w.config.contents)).length
}

/**
 * The setup without a template. The blocks made from it keep what they showed, as contents and a
 * heading of their own, so no page changes.
 */
export function withoutTemplate(setup: DailySetup, templateId: string): DailySetup {
	const template = setup.templates.find((t) => t.id === templateId)
	if (!template) return setup
	const bake = (w: Widget): Widget => {
		if (w.config.templateId !== templateId) return w
		const { templateId: _, ...config } = w.config
		const contents = config.contents ?? { iconTaskIds: [...template.iconTaskIds], items: template.items.map((i) => ({ ...i })) }
		const title = w.title ?? (w.type === 'block' ? template.name : undefined)
		return { ...w, ...(title ? { title } : {}), config: { ...config, contents } }
	}
	return {
		...setup,
		templates: setup.templates.filter((t) => t.id !== templateId),
		layouts: setup.layouts.map((l) => ({ ...l, widgets: l.widgets.map(bake) })),
	}
}

export type LogColumn = 'rating' | 'pages' | 'done'

/** A list the review keeps per week: movies & series, books. */
export interface LogList {
	id: string
	name: string
	columns: LogColumn[]
}

export const DAILY_WIDGETS = ['header', 'block', 'tasks', 'physical', 'pick', 'focus', 'notes', 'reviewLink'] as const
export const REVIEW_WIDGETS = ['nextWeek', 'weeklyTasks', 'rotation', 'logs', 'habits', 'numbers', 'creative', 'reflection', 'picks'] as const
export type DailyWidgetType = (typeof DAILY_WIDGETS)[number]
export type ReviewWidgetType = (typeof REVIEW_WIDGETS)[number]
export type WidgetType = DailyWidgetType | ReviewWidgetType

/** What a habit row or a number in the review counts. */
export type TrackRef =
	| { kind: 'tick'; id: string }
	| { kind: 'metric'; id: string }
	| { kind: 'fasting' }
	| { kind: 'pick' }

/** A row of the habit grid, or one of the week's numbers. */
export interface TrackRow {
	id: string
	label: string
	ref: TrackRef
	/** Out of how many: "Swim /5". Without one, a tick counts out of 7. */
	target?: number
}

export interface WidgetConfig {
	/** A block's template. A physical block's icon tasks come from one too. */
	templateId?: string
	/**
	 * The block's own icon tasks and checklist, once they were changed on a page: it shows these and no
	 * longer follows its template's.
	 */
	contents?: BlockContents
	/**
	 * A block's icon tasks as a grid, rows by columns, the tiles sized to fill it. Either left out is
	 * worked out from the other; both left out, the tiles take whatever arrangement draws them largest.
	 */
	iconRows?: number
	iconCols?: number
	/** A block drawn without its heading, so a row of icons fits a single grid row. */
	hideTitle?: boolean
	/** The numbers a physical block asks for. */
	metricIds?: string[]
	/** Whether a physical block shows fasting and the food log. */
	fasting?: boolean
	food?: boolean
	/** A daily pick's list (a source key) and the board its stamps are filed on. */
	source?: string
	board?: string
	/** A review's habit grid or numbers. */
	rows?: TrackRow[]
	/** The log lists a review's logs widget shows. */
	listIds?: string[]
	/** The areas creative progress has a card for. */
	areaIds?: string[]
	/** Reflection's questions. */
	prompts?: TaskText[]
	/** How many weeks the rotation check looks back over, this one included. */
	weeks?: number
	/** Whether the next week planner shows a note under each evening ("Kendo"). */
	notes?: boolean
}

/** A widget on a page: where it sits on the grid and what it shows. */
export interface Widget {
	id: string
	type: WidgetType
	col: number
	row: number
	w: number
	h: number
	/** Its heading, when it isn't the template's or the widget's own name. */
	title?: string
	config: WidgetConfig
}

/**
 * The daily page's layout from a day on: a change applies to that day and later, never earlier ones.
 * One saved for "only this page" is that day's alone (`only`), and the days after keep the layout
 * they had.
 */
export interface DailyLayout {
	from: Day
	widgets: Widget[]
	only?: true
}

export interface DailySetup {
	areas: Area[]
	cycles: Cycle[]
	metrics: Metric[]
	fasting: FastingKind[]
	iconTasks: IconTask[]
	templates: BlockTemplate[]
	logLists: LogList[]
	layouts: DailyLayout[]
	review: Widget[]
	/** The day the review takes the place of the daily page: 0 Monday … 6 Sunday. */
	reviewDay: number
	/** Tasks left unticked show on the next page. */
	carryTasks: boolean
}

/** The daily page: an A5 sheet, two columns of twelve rows. */
export const DAILY_GRID = { cols: 2, rows: 12 } as const
/** The review: an A4 sheet on its side, three columns of twelve rows. */
export const REVIEW_GRID = { cols: 3, rows: 12 } as const

/* ------------------------------------------------------------------------------------ day pages */

export interface Task {
	id: string
	text: string
	done: boolean
	/** The day it was first written, when it was carried here from an earlier page. */
	from?: Day
}

export interface FoodPhoto {
	/** The picture's SHA-256, in the asset store. */
	hash: string
	/** `HH:MM`, when it was taken. */
	at: string
}

/** The day's draw from a pick widget's list. */
export interface DayPick {
	source: string
	id: string
	title: string
	creator: string
	year: string
	cover: string
	url: string
	/** How many times "Another one" was pressed: the draw is the date's and this. */
	draws: number
	/** Stamped on the board the widget files on: 'liked', 'disliked', 'unsure', or ''. */
	stamp: string
	impression: string
}

export interface DayPage {
	date: Day
	/** Icon tasks, checklist items and focus tasks done that day, by id. */
	ticks: string[]
	/** A tasks widget's list, or a focus widget's own tasks, by widget id. */
	lists: Record<string, Task[]>
	/** The day's focus when it was changed from the cycle's: an area id. */
	focusId?: string
	/** A fasting kind's id, or '' for none. */
	fasting: string
	numbers: Record<string, number>
	food: FoodPhoto[]
	/** A pick widget's draw, by widget id. */
	picks: Record<string, DayPick>
	notes: Record<string, string>
}

export function newPage(date: Day): DayPage {
	return { date, ticks: [], lists: {}, fasting: '', numbers: {}, food: [], picks: {}, notes: {} }
}

/* ------------------------------------------------------------------------------------ week plans */

export interface WeekTask extends Task {
	/** The day it was put on, where that day's tasks list shows it. */
	day?: Day
}

export interface LogRow {
	id: string
	title: string
	rating?: number
	pages?: number
	done?: boolean
}

export interface CreativeNote {
	goal: string
	done: string
	next: string
}

export interface WeekPlan {
	/** The week's Monday. */
	week: Day
	/** The cycle chosen for it, by hand; '' for none yet. */
	cycleId: string
	/** What each evening goes to, Monday first: an area id or ''. */
	evenings: string[]
	eveningNotes: string[]
	tasks: WeekTask[]
	logs: Record<string, LogRow[]>
	creative: Record<string, CreativeNote>
	reflection: Record<string, string>
	/** The rotation check's answers. */
	answers: Record<string, string>
}

export function newWeek(week: Day): WeekPlan {
	return {
		week,
		cycleId: '',
		evenings: Array(7).fill(''),
		eveningNotes: Array(7).fill(''),
		tasks: [],
		logs: {},
		creative: {},
		reflection: {},
		answers: {},
	}
}

/* --------------------------------------------------------------------------------- reading stored */

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const bool = (v: unknown): boolean => v === true
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const strings = (v: unknown): string[] => arr(v).filter((s): s is string => typeof s === 'string')
/** Items that read, without the ones that don't, and none twice by id. */
function list<T extends { id: string }>(v: unknown, read: (raw: Record<string, unknown>) => T | null): T[] {
	const seen = new Set<string>()
	const out: T[] = []
	for (const raw of arr(v)) {
		const item = read(obj(raw))
		if (!item || !item.id || seen.has(item.id)) continue
		seen.add(item.id)
		out.push(item)
	}
	return out
}

const readText = (r: Record<string, unknown>): TaskText | null => (str(r.id) ? { id: str(r.id), text: str(r.text) } : null)

function readTask(r: Record<string, unknown>): Task | null {
	if (!str(r.id)) return null
	return { id: str(r.id), text: str(r.text), done: bool(r.done), ...(isDay(r.from) ? { from: r.from } : {}) }
}

function readRef(r: Record<string, unknown>): TrackRef | null {
	if (r.kind === 'tick' && str(r.id)) return { kind: 'tick', id: str(r.id) }
	if (r.kind === 'metric' && str(r.id)) return { kind: 'metric', id: str(r.id) }
	if (r.kind === 'fasting') return { kind: 'fasting' }
	if (r.kind === 'pick') return { kind: 'pick' }
	return null
}

function readRow(r: Record<string, unknown>): TrackRow | null {
	const ref = readRef(obj(r.ref))
	if (!str(r.id) || !ref) return null
	const target = num(r.target)
	return { id: str(r.id), label: str(r.label), ref, ...(target && target > 0 ? { target } : {}) }
}

function readConfig(r: Record<string, unknown>): WidgetConfig {
	const out: WidgetConfig = {}
	if (typeof r.templateId === 'string') out.templateId = r.templateId
	if (r.contents && typeof r.contents === 'object') {
		const c = obj(r.contents)
		out.contents = { iconTaskIds: strings(c.iconTaskIds), items: list(c.items, readText) }
	}
	const gridSide = (v: unknown) => {
		const n = num(v)
		return n === undefined ? undefined : Math.max(1, Math.min(GRID_MAX, Math.round(n)))
	}
	const iconRows = gridSide(r.iconRows)
	if (iconRows) out.iconRows = iconRows
	const iconCols = gridSide(r.iconCols)
	if (iconCols) out.iconCols = iconCols
	if (r.hideTitle === true) out.hideTitle = true
	if (Array.isArray(r.metricIds)) out.metricIds = strings(r.metricIds)
	if (typeof r.fasting === 'boolean') out.fasting = r.fasting
	if (typeof r.food === 'boolean') out.food = r.food
	if (typeof r.source === 'string') out.source = r.source
	if (typeof r.board === 'string') out.board = r.board
	if (Array.isArray(r.rows)) out.rows = list(r.rows, readRow)
	if (Array.isArray(r.listIds)) out.listIds = strings(r.listIds)
	if (Array.isArray(r.areaIds)) out.areaIds = strings(r.areaIds)
	if (Array.isArray(r.prompts)) out.prompts = list(r.prompts, readText)
	const weeks = num(r.weeks)
	if (weeks) out.weeks = Math.max(1, Math.min(12, Math.round(weeks)))
	if (typeof r.notes === 'boolean') out.notes = r.notes
	return out
}

/** The most rows or columns a block's icon grid can have. */
export const GRID_MAX = 8

/**
 * How a block draws `n` icon tiles in a box `width` by `height`: rows, columns and the tiles' side, as
 * large as fits and no larger than `max`. Rows or columns left out are worked out from the other; with
 * neither, the arrangement that draws the tiles largest. A grid too small for every tile grows rows.
 */
export function fitTiles(
	n: number,
	box: { width: number; height: number },
	grid: { rows?: number; cols?: number },
	{ gap, min, max }: { gap: number; min: number; max: number }
): { rows: number; cols: number; size: number } {
	if (n <= 0) return { rows: 0, cols: 0, size: 0 }
	const side = (rows: number, cols: number) => Math.min((box.width - gap * (cols - 1)) / cols, (box.height - gap * (rows - 1)) / rows)
	const sized = (rows: number, cols: number) => ({ rows, cols, size: Math.floor(Math.max(min, Math.min(max, side(rows, cols)))) })
	const { rows, cols } = grid
	if (cols) return sized(Math.max(rows ?? 1, Math.ceil(n / cols)), cols)
	if (rows) return sized(rows, Math.ceil(n / rows))
	let best = { rows: 1, cols: n }
	for (let r = 2; r <= n; r++) {
		const c = Math.ceil(n / r)
		if (side(r, c) > side(best.rows, best.cols)) best = { rows: r, cols: c }
	}
	return sized(best.rows, best.cols)
}

const WIDGET_TYPES: readonly string[] = [...DAILY_WIDGETS, ...REVIEW_WIDGETS]

function readWidget(r: Record<string, unknown>): Widget | null {
	if (!str(r.id) || !WIDGET_TYPES.includes(str(r.type))) return null
	const int = (v: unknown, fallback: number) => Math.max(0, Math.round(num(v) ?? fallback))
	return {
		id: str(r.id),
		type: str(r.type) as WidgetType,
		col: int(r.col, 0),
		row: int(r.row, 0),
		w: Math.max(1, int(r.w, 1)),
		h: Math.max(1, int(r.h, 1)),
		...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
		config: readConfig(obj(r.config)),
	}
}

const LOG_COLUMNS: readonly LogColumn[] = ['rating', 'pages', 'done']

/** A stored setup, with whatever doesn't read left out. `null` when there is none. */
export function readSetup(raw: unknown): DailySetup | null {
	const r = obj(raw)
	if (!Array.isArray(r.areas)) return null
	const layouts = arr(r.layouts)
		.map((l) => obj(l))
		.filter((l) => isDay(l.from))
		.map((l): DailyLayout => ({ from: l.from as Day, widgets: list(l.widgets, readWidget), ...(l.only === true ? { only: true as const } : {}) }))
		.sort((a, b) => a.from.localeCompare(b.from))
	const reviewDay = num(r.reviewDay)
	return {
		areas: list(r.areas, (a) => (str(a.id) ? { id: str(a.id), name: str(a.name), color: str(a.color) || '#6c8cff', tasks: list(a.tasks, readText) } : null)),
		cycles: list(r.cycles, (c) => (str(c.id) ? { id: str(c.id), name: str(c.name), areaIds: strings(c.areaIds) } : null)),
		metrics: list(r.metrics, (m) => (str(m.id) ? { id: str(m.id), name: str(m.name), unit: str(m.unit), total: m.total === 'sum' ? 'sum' : 'avg' } : null)),
		fasting: list(r.fasting, (f) => (str(f.id) ? { id: str(f.id), name: str(f.name) } : null)),
		iconTasks: list(r.iconTasks, (t) => (str(t.id) ? { id: str(t.id), name: str(t.name), icon: str(t.icon) } : null)),
		// A template from before it could hold both kept the list of its other type out of sight: that
		// one is dropped rather than shown for the first time.
		templates: list(r.templates, (t) =>
			str(t.id)
				? {
						id: str(t.id),
						name: str(t.name),
						iconTaskIds: t.kind === 'checklist' ? [] : strings(t.iconTaskIds),
						items: t.kind === 'icons' ? [] : list(t.items, readText),
					}
				: null
		),
		logLists: list(r.logLists, (l) =>
			str(l.id) ? { id: str(l.id), name: str(l.name), columns: strings(l.columns).filter((c): c is LogColumn => LOG_COLUMNS.includes(c as LogColumn)) } : null
		),
		layouts,
		review: list(r.review, readWidget),
		reviewDay: reviewDay !== undefined && reviewDay >= 0 && reviewDay <= 6 ? Math.round(reviewDay) : 6,
		carryTasks: r.carryTasks !== false,
	}
}

function readPick(r: Record<string, unknown>): DayPick | null {
	if (!str(r.id) || !str(r.source)) return null
	return {
		source: str(r.source),
		id: str(r.id),
		title: str(r.title),
		creator: str(r.creator),
		year: str(r.year),
		cover: str(r.cover),
		url: str(r.url),
		draws: Math.max(0, Math.round(num(r.draws) ?? 0)),
		stamp: str(r.stamp),
		impression: str(r.impression),
	}
}

const record = <T>(v: unknown, read: (raw: unknown) => T | null): Record<string, T> => {
	const out: Record<string, T> = {}
	for (const [key, value] of Object.entries(obj(v))) {
		const item = read(value)
		if (item !== null) out[key] = item
	}
	return out
}

export function readPage(r: Record<string, unknown>): DayPage | null {
	if (!isDay(r.date)) return null
	return {
		date: r.date,
		ticks: [...new Set(strings(r.ticks))],
		lists: record(r.lists, (v) => list(v, readTask)),
		...(str(r.focusId) ? { focusId: str(r.focusId) } : {}),
		fasting: str(r.fasting),
		numbers: record(r.numbers, (v) => num(v) ?? null),
		food: arr(r.food)
			.map(obj)
			.filter((f) => /^[0-9a-f]{64}$/.test(str(f.hash)))
			.map((f) => ({ hash: str(f.hash), at: str(f.at) })),
		picks: record(r.picks, (v) => readPick(obj(v))),
		notes: record(r.notes, (v) => (typeof v === 'string' ? v : null)),
	}
}

const seven = (v: unknown): string[] => Array.from({ length: 7 }, (_, i) => str(arr(v)[i]))

export function readWeek(r: Record<string, unknown>): WeekPlan | null {
	if (!isDay(r.week)) return null
	return {
		week: r.week,
		cycleId: str(r.cycleId),
		evenings: seven(r.evenings),
		eveningNotes: seven(r.eveningNotes),
		tasks: list(r.tasks, (t) => {
			const task = readTask(t)
			return task && (isDay(t.day) ? { ...task, day: t.day } : task)
		}),
		logs: record(r.logs, (v) =>
			list(v, (row) => {
				if (!str(row.id)) return null
				const out: LogRow = { id: str(row.id), title: str(row.title) }
				const rating = num(row.rating)
				const pages = num(row.pages)
				if (rating !== undefined) out.rating = rating
				if (pages !== undefined) out.pages = pages
				if (typeof row.done === 'boolean') out.done = row.done
				return out
			})
		),
		creative: record(r.creative, (v) => {
			const c = obj(v)
			return { goal: str(c.goal), done: str(c.done), next: str(c.next) }
		}),
		reflection: record(r.reflection, (v) => (typeof v === 'string' ? v : null)),
		answers: record(r.answers, (v) => (typeof v === 'string' ? v : null)),
	}
}

/** Every picture a page keeps, for the clean-ups that delete files nothing uses any more. */
export function pagePhotoHashes(pages: Iterable<DayPage>): Set<string> {
	const out = new Set<string>()
	for (const page of pages) for (const photo of page.food) out.add(photo.hash)
	return out
}

/* ------------------------------------------------------------------------------------ the layout */

/**
 * The daily layout a day is drawn with: one saved for that day alone, else the newest one made on or
 * before it, else the first.
 */
export function layoutFor(setup: DailySetup, day: Day): Widget[] {
	const own = setup.layouts.find((l) => l.only && l.from === day)
	if (own) return own.widgets
	return carriedLayout(setup, day)
}

/** The layout a day has from the days before it, leaving out any saved for it alone. */
function carriedLayout(setup: DailySetup, day: Day): Widget[] {
	let found: DailyLayout | undefined
	let first: DailyLayout | undefined
	for (const layout of setup.layouts) {
		if (layout.only) continue
		first ??= layout
		if (layout.from <= day) found = layout
	}
	return (found ?? first)?.widgets ?? []
}

/**
 * The setup with the daily layout changed from `day` on: that day's layout is replaced, or one is
 * started there. Layouts made for later days are kept, since they were made on purpose.
 */
export function withLayout(setup: DailySetup, day: Day, widgets: Widget[]): DailySetup {
	const layouts = setup.layouts.filter((l) => l.from !== day)
	layouts.push({ from: day, widgets })
	layouts.sort((a, b) => a.from.localeCompare(b.from))
	return { ...setup, layouts }
}

/**
 * "Only this page": the layout saved for `day` alone. The days after keep theirs. A layout the same as
 * the one the day would have anyway is no exception, so none is kept.
 */
export function withPageLayout(setup: DailySetup, day: Day, widgets: Widget[]): DailySetup {
	const layouts = setup.layouts.filter((l) => !(l.only && l.from === day))
	if (!sameWidgets(widgets, carriedLayout(setup, day))) layouts.push({ from: day, widgets, only: true })
	layouts.sort((a, b) => a.from.localeCompare(b.from))
	return { ...setup, layouts }
}

/**
 * "This and all future pages": `day` takes the layout from then on, and every layout saved for a later
 * day, one day's alone or from a day on, takes the same changes (`applyChanges`) while keeping its
 * own. Earlier days are left as they were.
 */
export function withLayoutFrom(setup: DailySetup, day: Day, before: readonly Widget[], after: Widget[]): DailySetup {
	const layouts = setup.layouts
		.filter((l) => l.from !== day)
		.map((l) => (l.from > day ? { ...l, widgets: applyChanges(l.widgets, before, after) } : l))
	layouts.push({ from: day, widgets: after })
	layouts.sort((a, b) => a.from.localeCompare(b.from))
	return { ...setup, layouts }
}

/** JSON with every object's keys in order, so the same widget compares the same however it was built. */
const stable = (v: unknown): string =>
	JSON.stringify(v, (_, x: unknown) =>
		x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : x
	)
const same = (a: unknown, b: unknown) => stable(a) === stable(b)

export function sameWidgets(a: readonly Widget[], b: readonly Widget[]): boolean {
	return same(a, b)
}

/**
 * What was changed from `before` to `after`, made to another layout too: widgets taken out go, new
 * ones come in where they fit, and a changed one takes only what changed (its heading, a setting, its
 * place), so what the other layout changed for itself stays. A move that would land on another widget
 * there is left out.
 */
export function applyChanges(target: readonly Widget[], before: readonly Widget[], after: readonly Widget[]): Widget[] {
	const was = new Map(before.map((w) => [w.id, w]))
	const now = new Set(after.map((w) => w.id))
	let out = target.filter((w) => !(was.has(w.id) && !now.has(w.id)))
	for (const a of after) {
		const b = was.get(a.id)
		const t = out.find((w) => w.id === a.id)
		if (!b) {
			if (!t && fits(out, a, DAILY_GRID)) out = [...out, a]
			continue
		}
		// Gone from that layout on purpose, or not changed here.
		if (!t || same(a, b)) continue
		let next: Widget = { ...t, config: { ...t.config } }
		if (a.title !== b.title) {
			const { title: _, ...rest } = next
			next = a.title ? { ...rest, title: a.title } : rest
		}
		const keys = new Set([...Object.keys(a.config), ...Object.keys(b.config)] as (keyof WidgetConfig)[])
		for (const key of keys) {
			if (same(a.config[key], b.config[key])) continue
			if (a.config[key] === undefined) delete next.config[key]
			else (next.config as Record<string, unknown>)[key] = a.config[key]
		}
		if (a.col !== b.col || a.row !== b.row || a.w !== b.w || a.h !== b.h) {
			const placed = { ...next, col: a.col, row: a.row, w: a.w, h: a.h }
			if (fits(out, placed, DAILY_GRID, t.id)) next = placed
		}
		out = out.map((w) => (w.id === t.id ? next : w))
	}
	return out
}

interface Grid {
	cols: number
	rows: number
}

const overlaps = (a: Pick<Widget, 'col' | 'row' | 'w' | 'h'>, b: Pick<Widget, 'col' | 'row' | 'w' | 'h'>) =>
	a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h

/** Whether a widget can sit there: on the grid, and over no other widget (`ignore` is the one moving). */
export function fits(widgets: readonly Widget[], place: Pick<Widget, 'col' | 'row' | 'w' | 'h'>, grid: Grid, ignore?: string): boolean {
	if (place.col < 0 || place.row < 0 || place.col + place.w > grid.cols || place.row + place.h > grid.rows) return false
	return widgets.every((w) => w.id === ignore || !overlaps(w, place))
}

/** The first place, row by row, a widget of that size fits: what the Library's + uses. */
export function firstGap(widgets: readonly Widget[], size: { w: number; h: number }, grid: Grid): { col: number; row: number } | null {
	for (let row = 0; row + size.h <= grid.rows; row++) {
		for (let col = 0; col + size.w <= grid.cols; col++) {
			if (fits(widgets, { col, row, ...size }, grid)) return { col, row }
		}
	}
	return null
}

/** The free cells, as `col,row`. */
export function freeCells(widgets: readonly Widget[], grid: Grid): { col: number; row: number }[] {
	const out: { col: number; row: number }[] = []
	for (let row = 0; row < grid.rows; row++) {
		for (let col = 0; col < grid.cols; col++) {
			if (fits(widgets, { col, row, w: 1, h: 1 }, grid)) out.push({ col, row })
		}
	}
	return out
}

/**
 * Where a widget dropped on a cell goes: there at its size if it fits, else as tall as fits from that
 * cell down (at least one row), else `null`.
 */
export function placeAt(widgets: readonly Widget[], cell: { col: number; row: number }, size: { w: number; h: number }, grid: Grid, ignore?: string): { col: number; row: number; w: number; h: number } | null {
	const w = Math.min(size.w, grid.cols - cell.col)
	for (let h = size.h; h >= 1; h--) {
		const place = { ...cell, w, h }
		if (fits(widgets, place, grid, ignore)) return place
	}
	return null
}

/* ------------------------------------------------------------------------------ cycles and focus */

/** A day's week plan, or a new one. */
export function weekPlanOr(plans: Readonly<Record<string, WeekPlan>>, week: Day): WeekPlan {
	return plans[week] ?? newWeek(week)
}

export function cycleOf(setup: DailySetup, plan: WeekPlan | undefined): Cycle | undefined {
	return plan?.cycleId ? setup.cycles.find((c) => c.id === plan.cycleId) : undefined
}

/**
 * A day's focus, as an area id: the one chosen on the page, else the evening planned for it in the
 * week plan, else the week's cycle's areas in turn (Monday the first, Tuesday the second…). `''` when
 * none of those says.
 */
export function focusOf(setup: DailySetup, plan: WeekPlan | undefined, page: DayPage | undefined, day: Day): string {
	if (page?.focusId && setup.areas.some((a) => a.id === page.focusId)) return page.focusId
	const evening = plan?.evenings[weekday(day)]
	if (evening && setup.areas.some((a) => a.id === evening)) return evening
	const cycle = cycleOf(setup, plan)
	const areas = cycle?.areaIds.filter((id) => setup.areas.some((a) => a.id === id)) ?? []
	return areas.length ? areas[weekday(day) % areas.length]! : ''
}

/** A cycle's name and its areas': `W3 · Art & Music`. */
export function cycleLabel(setup: DailySetup, cycle: Cycle | undefined): string {
	if (!cycle) return 'No cycle set'
	const names = cycle.areaIds.map((id) => setup.areas.find((a) => a.id === id)?.name).filter(Boolean)
	return names.length ? `${cycle.name} · ${names.join(' & ')}` : cycle.name
}

/* ---------------------------------------------------------------------------------- a day's page */

/**
 * The page a day shows: the stored one, or a new one. With carrying on, a tasks list the day hasn't
 * written yet starts with what the latest earlier page left unticked in the same widget, each marked
 * with the day it was first written. Nothing is stored until the page is changed.
 */
export function pageFor(pages: Readonly<Record<string, DayPage>>, day: Day, carry: boolean, listIds: readonly string[]): DayPage {
	const stored = pages[day]
	if (!carry) return stored ?? newPage(day)
	const page = stored ?? newPage(day)
	const missing = listIds.filter((id) => !(id in page.lists))
	if (!missing.length) return page
	const earlier = Object.keys(pages)
		.filter((d) => d < day)
		.sort()
		.reverse()
	const lists = { ...page.lists }
	for (const id of missing) {
		const before = earlier.find((d) => pages[d]!.lists[id])
		if (!before) continue
		const left = pages[before]!.lists[id]!.filter((t) => !t.done && t.text.trim())
		if (left.length) lists[id] = left.map((t) => ({ ...t, from: t.from ?? before }))
	}
	return { ...page, lists }
}

/**
 * What an edit starts from: the stored page as it is now, with the lists the day shows but hasn't
 * stored yet (carried from an earlier page by `pageFor`) put in. Without them, ticking a carried task
 * on a day that already had a page for something else would edit a list the store doesn't have, and
 * the carried tasks would be lost.
 */
export function editBase(stored: DayPage | undefined, shown: DayPage | undefined, date: Day): DayPage {
	if (!stored) return shown?.date === date ? shown : newPage(date)
	if (!shown || shown.date !== date) return stored
	const carried = Object.fromEntries(Object.entries(shown.lists).filter(([id]) => !(id in stored.lists)))
	return Object.keys(carried).length ? { ...stored, lists: { ...carried, ...stored.lists } } : stored
}

/** How much of a day's ticks are done, 0 to 1, over the icon tasks and checklist items its layout shows. */
export function dayProgress(setup: DailySetup, page: DayPage | undefined, day: Day, focus: string): number | null {
	if (!page) return null
	const ids = tickIdsOf(setup, layoutFor(setup, day), focus)
	const lists = Object.values(page.lists).flat()
	const total = ids.length + lists.length
	if (!total) return null
	const done = ids.filter((id) => page.ticks.includes(id)).length + lists.filter((t) => t.done).length
	return done / total
}

/** Every icon task, checklist item and focus task a layout shows. */
export function tickIdsOf(setup: DailySetup, widgets: readonly Widget[], focus: string): string[] {
	const ids: string[] = []
	for (const w of widgets) {
		const contents = blockContents(setup, w)
		if ((w.type === 'block' || w.type === 'physical') && contents) ids.push(...templateTickIds(contents))
		if (w.type === 'focus') ids.push(...(setup.areas.find((a) => a.id === focus)?.tasks.map((t) => t.id) ?? []))
	}
	return [...new Set(ids)]
}

/* -------------------------------------------------------------------------------------- the week */

/** One cell of a habit row: ticked, a number, or nothing written. */
export type TrackCell = { kind: 'tick'; done: boolean } | { kind: 'number'; value: number } | { kind: 'empty' }

export function trackCell(row: TrackRow, page: DayPage | undefined): TrackCell {
	if (!page) return { kind: 'empty' }
	switch (row.ref.kind) {
		case 'tick':
			return { kind: 'tick', done: page.ticks.includes(row.ref.id) }
		case 'fasting':
			return { kind: 'tick', done: !!page.fasting }
		case 'pick':
			return { kind: 'tick', done: Object.values(page.picks).some((p) => !!p.stamp || !!p.impression.trim()) }
		case 'metric': {
			const value = page.numbers[row.ref.id]
			return value === undefined ? { kind: 'empty' } : { kind: 'number', value }
		}
	}
}

/** A row's total over the week: "3/5" ticked, "72.5 avg", "46 pp". */
export interface TrackTotal {
	value: number | null
	text: string
}

const round1 = (n: number) => Math.round(n * 10) / 10

export function trackTotal(setup: DailySetup, row: TrackRow, cells: readonly TrackCell[]): TrackTotal {
	if (row.ref.kind === 'metric') {
		const id = row.ref.id
		const metric = setup.metrics.find((m) => m.id === id)
		const values = cells.flatMap((c) => (c.kind === 'number' ? [c.value] : []))
		if (!values.length) return { value: null, text: '—' }
		const sum = values.reduce((a, b) => a + b, 0)
		const value = round1(metric?.total === 'sum' ? sum : sum / values.length)
		const unit = metric?.total === 'sum' ? (metric.unit ? ` ${metric.unit}` : '') : ' avg'
		return { value, text: row.target ? `${value}/${row.target}` : `${value}${unit}` }
	}
	const done = cells.filter((c) => c.kind === 'tick' && c.done).length
	return { value: done, text: `${done}/${row.target ?? 7}` }
}

/** A metric's total over some pages, or `null` when none of them has it. */
export function metricTotal(metric: Metric, pages: readonly (DayPage | undefined)[]): number | null {
	const values = pages.flatMap((p) => (p && p.numbers[metric.id] !== undefined ? [p.numbers[metric.id]!] : []))
	if (!values.length) return null
	const sum = values.reduce((a, b) => a + b, 0)
	return round1(metric.total === 'sum' ? sum : sum / values.length)
}

/** How many evenings each area got over some weeks. */
export function eveningCounts(plans: readonly (WeekPlan | undefined)[]): Map<string, number> {
	const counts = new Map<string, number>()
	for (const plan of plans) for (const id of plan?.evenings ?? []) if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
	return counts
}

/**
 * The areas getting squeezed out: fewer than half the evenings the others get on average, over weeks
 * that planned any at all. Areas named in `skip` (Rest, say) never count as squeezed.
 */
export function squeezed(areas: readonly Area[], counts: ReadonlyMap<string, number>): Area[] {
	if (areas.length < 2) return []
	const total = areas.reduce((n, a) => n + (counts.get(a.id) ?? 0), 0)
	if (!total) return []
	const mean = total / areas.length
	return areas.filter((a) => (counts.get(a.id) ?? 0) < mean / 2)
}

/* ---------------------------------------------------------------------------------- the day's pick */

/** A number from a string, the same every time: the day's draw has to be the same on every device. */
export function seeded(text: string): number {
	let h = 2166136261
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i)
		h = Math.imul(h, 16777619)
	}
	// FNV alone leaves the high bits nearly alike for strings that differ in their last letter (the
	// draw's number), and the high bits are what pick the entry: mix them through (MurmurHash3's finish).
	h ^= h >>> 16
	h = Math.imul(h, 0x85ebca6b)
	h ^= h >>> 13
	h = Math.imul(h, 0xc2b2ae35)
	h ^= h >>> 16
	return (h >>> 0) / 4294967296
}

export interface PickEntry {
	id: string
	title: string
	creator: string
	year: string
	cover: string
	url: string
}

/**
 * The day's draw from a list: the date and how many times it was drawn again pick it, so it is the
 * same wherever it is worked out. Entries in `skip` (stamped already, or drawn on a recent day) are
 * passed over while anything else is left.
 */
export function drawPick<T extends PickEntry>(entries: readonly T[], day: Day, draws: number, skip: ReadonlySet<string>): T | null {
	if (!entries.length) return null
	const open = entries.filter((e) => !skip.has(e.id))
	const pool = open.length ? open : entries
	return pool[Math.floor(seeded(`${day}#${draws}`) * pool.length)] ?? null
}

/** The ids drawn on the days before `day`, back `days` days: a draw doesn't come round again so soon. */
export function recentPicks(pages: Readonly<Record<string, DayPage>>, day: Day, days: number): Set<string> {
	const out = new Set<string>()
	for (let i = 1; i <= days; i++) {
		const page = pages[addDays(day, -i)]
		for (const pick of Object.values(page?.picks ?? {})) out.add(pick.id)
	}
	return out
}

/**
 * What a draw for `day` steers clear of: the days before it (`recentPicks`), and the day after, which
 * is drawn a day early so its album can be fetched the evening before. Whichever of two neighbouring
 * days is drawn first, the other skips it.
 */
export function nearbyPicks(pages: Readonly<Record<string, DayPage>>, day: Day, days: number): Set<string> {
	const out = recentPicks(pages, day, days)
	for (const pick of Object.values(pages[addDays(day, 1)]?.picks ?? {})) out.add(pick.id)
	return out
}

/* ------------------------------------------------------------------------------------- the start */

let counter = 0
/** A new id: time and a counter, so two made in the same millisecond differ. */
export function newId(prefix: string): string {
	counter = (counter + 1) % 1296
	return `${prefix}${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}${Math.floor(Math.random() * 1296)
		.toString(36)
		.padStart(2, '0')}`
}

/** The size a widget takes when it is put on a page, before it is resized. */
export const WIDGET_SIZE: Record<WidgetType, { w: number; h: number }> = {
	header: { w: 2, h: 2 },
	block: { w: 1, h: 2 },
	tasks: { w: 1, h: 3 },
	physical: { w: 1, h: 3 },
	pick: { w: 1, h: 3 },
	focus: { w: 1, h: 3 },
	notes: { w: 1, h: 2 },
	reviewLink: { w: 1, h: 1 },
	nextWeek: { w: 3, h: 2 },
	weeklyTasks: { w: 1, h: 3 },
	rotation: { w: 1, h: 3 },
	logs: { w: 1, h: 2 },
	habits: { w: 2, h: 3 },
	numbers: { w: 1, h: 3 },
	creative: { w: 2, h: 2 },
	reflection: { w: 2, h: 2 },
	picks: { w: 3, h: 2 },
}

/**
 * Where a vault starts: one person's week as an example of every widget, so the page is usable on the
 * first day. Every part of it can be renamed, changed or removed.
 */
export function defaultSetup(day: Day = today()): DailySetup {
	const areas: Area[] = [
		{ id: 'music', name: 'Music', color: '#6c8cff', tasks: [{ id: 'music-1', text: 'Music theory drill' }, { id: 'music-2', text: 'Creative exploration' }] },
		{ id: 'gamedev', name: 'Game dev', color: '#3dd68c', tasks: [{ id: 'gamedev-1', text: 'Fix one open bug' }] },
		{ id: 'art', name: 'Art', color: '#e5484d', tasks: [{ id: 'art-1', text: 'Figure drawing 30 min' }, { id: 'art-2', text: 'Color study' }] },
		{ id: 'family', name: 'Family', color: '#f5c451', tasks: [] },
		{ id: 'rest', name: 'Rest', color: '#9a9aa4', tasks: [] },
	]
	const iconTasks: IconTask[] = [
		{ id: 'brush-teeth', name: 'Brush teeth', icon: 'everyday:toothbrush' },
		{ id: 'scrape-tongue', name: 'Scrape tongue', icon: 'mood-tongue' },
		{ id: 'shower', name: 'Shower', icon: 'everyday:shower' },
		{ id: 'drink-water', name: 'Drink water', icon: 'everyday:drink-water' },
		{ id: 'album', name: 'Listen to an album', icon: 'everyday:music' },
		{ id: 'draw', name: 'Draw', icon: 'everyday:draw' },
		{ id: 'read', name: 'Read', icon: 'everyday:read' },
		{ id: 'journal', name: 'Journal', icon: 'everyday:journal' },
		{ id: 'workout', name: 'Workout', icon: 'activities:weightlifting' },
		{ id: 'swim', name: 'Swim', icon: 'activities:swimming' },
		{ id: 'ate-to-plan', name: 'Ate to plan', icon: 'everyday:salad' },
	]
	const templates: BlockTemplate[] = [
		{ id: 'morning', name: 'MORNING', iconTaskIds: ['brush-teeth', 'scrape-tongue', 'shower', 'drink-water'], items: [] },
		{ id: 'habits', name: 'HABITS', iconTaskIds: ['album', 'draw', 'read', 'journal'], items: [] },
		{
			id: 'evening',
			name: 'EVENING',
			iconTaskIds: [],
			items: [
				{ id: 'evening-1', text: 'Download album' },
				{ id: 'evening-2', text: 'Prepare bags' },
			],
		},
		{ id: 'physical', name: 'PHYSICAL', iconTaskIds: ['workout', 'swim', 'ate-to-plan'], items: [] },
	]
	const widget = (id: string, type: WidgetType, col: number, row: number, w: number, h: number, config: WidgetConfig = {}, title?: string): Widget => ({
		id,
		type,
		col,
		row,
		w,
		h,
		...(title ? { title } : {}),
		config,
	})
	const track = (id: string, label: string, ref: TrackRef, target?: number): TrackRow => ({ id, label, ref, ...(target ? { target } : {}) })
	return {
		areas,
		cycles: [
			{ id: 'w1', name: 'W1', areaIds: ['music', 'gamedev'] },
			{ id: 'w2', name: 'W2', areaIds: ['gamedev', 'art'] },
			{ id: 'w3', name: 'W3', areaIds: ['art', 'music'] },
		],
		metrics: [
			{ id: 'weight', name: 'Weight', unit: 'kg', total: 'avg' },
			{ id: 'pages', name: 'Pages read', unit: 'pp', total: 'sum' },
			{ id: 'piano', name: 'Piano', unit: 'min', total: 'sum' },
		],
		fasting: [
			{ id: 'if168', name: 'IF 16:8' },
			{ id: 'adf', name: 'ADF' },
			{ id: '24h', name: '24h' },
		],
		iconTasks,
		templates,
		logLists: [
			{ id: 'watched', name: 'Movies & series', columns: ['rating'] },
			{ id: 'books', name: 'Books', columns: ['pages', 'done'] },
		],
		layouts: [
			{
				from: day,
				widgets: [
					widget('header', 'header', 0, 0, 2, 2),
					widget('morning', 'block', 0, 2, 1, 2, { templateId: 'morning' }),
					widget('tasks', 'tasks', 1, 2, 1, 3, {}, 'TASKS'),
					widget('habits', 'block', 0, 4, 1, 2, { templateId: 'habits' }),
					widget('focus', 'focus', 1, 5, 1, 3),
					widget('evening', 'block', 0, 6, 1, 2, { templateId: 'evening' }),
					widget('physical', 'physical', 0, 8, 1, 3, { templateId: 'physical', metricIds: ['weight'], fasting: true, food: true }),
					widget('pick', 'pick', 1, 8, 1, 3, { source: '', board: '' }, 'ALBUM'),
					widget('review-link', 'reviewLink', 0, 11, 1, 1),
					widget('notes', 'notes', 1, 11, 1, 1),
				],
			},
		],
		review: [
			widget('next-week', 'nextWeek', 0, 0, 3, 2, { notes: true }),
			widget('weekly-tasks', 'weeklyTasks', 0, 2, 1, 3),
			widget('habit-grid', 'habits', 1, 2, 2, 4, {
				rows: [
					track('r-swim', 'Swim', { kind: 'tick', id: 'swim' }, 5),
					track('r-diet', 'Ate to plan', { kind: 'tick', id: 'ate-to-plan' }),
					track('r-weight', 'Weight', { kind: 'metric', id: 'weight' }),
					track('r-album', 'Album', { kind: 'pick' }),
					track('r-draw', 'Drawing', { kind: 'tick', id: 'draw' }),
					track('r-piano', 'Piano, min', { kind: 'metric', id: 'piano' }),
					track('r-pages', 'Pages read', { kind: 'metric', id: 'pages' }),
					track('r-journal', 'Journal', { kind: 'tick', id: 'journal' }),
				],
			}),
			widget('rotation', 'rotation', 0, 5, 1, 3, { weeks: 4 }),
			widget('numbers', 'numbers', 1, 6, 1, 2, {
				rows: [
					track('n-weight', 'Weight', { kind: 'metric', id: 'weight' }),
					track('n-workouts', 'Workouts', { kind: 'tick', id: 'workout' }, 4),
					track('n-diet', 'Diet followed', { kind: 'tick', id: 'ate-to-plan' }),
					track('n-pages', 'Pages read', { kind: 'metric', id: 'pages' }),
				],
			}),
			widget('creative', 'creative', 2, 6, 1, 2, { areaIds: ['music', 'gamedev', 'art'] }),
			widget('logs', 'logs', 0, 8, 1, 2, { listIds: ['watched', 'books'] }),
			widget('reflection', 'reflection', 1, 8, 2, 2, {
				prompts: [
					{ id: 'went-well', text: 'Went well' },
					{ id: 'in-the-way', text: 'Got in the way' },
					{ id: 'change', text: 'Change next week' },
				],
			}),
			widget('picks', 'picks', 0, 10, 3, 2),
		],
		reviewDay: 6,
		carryTasks: true,
	}
}
