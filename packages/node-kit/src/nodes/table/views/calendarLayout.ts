import type { LaneMember } from './kanbanLayout'

/**
 * A calendar's grid: which days it shows, where each one is, and where the cards standing on them go.
 *
 * Pure, and used by the chrome, the drop target *and* the placement pass — the same rule
 * `kanbanLayout` follows, for the same reason: the cell a card lands in has to be the cell the user
 * aimed at, and the cell it is drawn in. Everything is in **shape space**, x/y from the card's top-left.
 *
 * A calendar is a kanban whose lanes are days. The differences are only that its columns are a week
 * wide, that they wrap into rows, and that every row is the same height — because a calendar with
 * ragged rows reads as broken in a way a kanban with ragged lanes does not.
 *
 * Every function takes the period it is drawing as an argument: no clock, so the tests can be written
 * and a grid cannot change under a sleeping snapshot. The one exception is {@link calendarAnchor},
 * which is the props → layout adapter and has to answer "today" for a card nobody has pinned.
 */

export const CALENDAR_SPANS = ['week', 'month'] as const
export type CalendarSpan = (typeof CALENDAR_SPANS)[number]

/** The one place a calendar's dimensions are written down. See `KANBAN_METRICS` for why it is here. */
export const CALENDAR_METRICS = {
	pad: 8,
	/** The title strip: the period being shown, and how many cards are on it. */
	titleHeight: 26,
	/** Mon–Sun across the top. */
	weekdayHeight: 18,
	cellGap: 6,
	/** A day's number, above whatever is standing on that day. */
	dayHeadHeight: 18,
	cardGap: 6,
	/** A day with nothing on it is still a place to drop something. */
	emptyDayHeight: 72,
	/** What a day column is given when a card is first switched to this view. */
	defaultDayWidth: 150,
} as const

/** Monday first: this is a European board, and the weekend reads as a weekend at the end of a row. */
export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

const DAYS_PER_WEEK = 7

/**
 * Which day a card is anchored on, and which span — the two adapters from props to a grid.
 *
 * Here rather than in the component because the **drop target has to agree with what was drawn**: a
 * calendar that computed its anchor twice could take a card dropped on the 14th and write the 7th. One
 * function, three callers.
 *
 * An absent anchor means **today**, so a new calendar opens on the week you are in — a board that
 * opened on the week it was created in would be showing last April by the summer.
 */
export function calendarAnchor(layout: { anchor?: string | null }, today = new Date()): string {
	const stored = layout.anchor
	if (stored && /^\d{4}-\d{2}$/.test(stored)) return `${stored}-01`
	if (stored && /^\d{4}-\d{2}-\d{2}/.test(stored)) return stored.slice(0, 10)
	const month = String(today.getMonth() + 1).padStart(2, '0')
	const day = String(today.getDate()).padStart(2, '0')
	return `${today.getFullYear()}-${month}-${day}`
}

/**
 * **A week unless told otherwise.**
 *
 * A week is the span a board can actually be worked in: seven columns wide enough to stand real cards
 * in, showing the days you are deciding about. A month is four to six rows of the same thing, which is
 * for looking at rather than working in — so it is the answer to a question, not the default.
 */
export function calendarSpan(layout: { span?: string }): CalendarSpan {
	return layout.span === 'month' ? 'month' : 'week'
}

/** Shape-space y where the first row of days starts. */
export function gridTop(): number {
	return CALENDAR_METRICS.titleHeight + CALENDAR_METRICS.weekdayHeight
}

export interface DayBox {
	/** `YYYY-MM-DD`. */
	day: string
	/** False for the days either side of a month that fill out its first and last weeks. */
	inSpan: boolean
	/** Mon = 0. */
	column: number
	row: number
	/** Shape-space left edge. */
	x: number
	width: number
}

/**
 * Splits an ISO day into numbers, without going through `Date` and its timezone opinions.
 *
 * `new Date('2026-08-13')` is parsed as **UTC midnight**, so west of Greenwich it is the 12th — exactly
 * the class of bug a calendar cannot have. Constructing from parts (`new Date(y, m, d)`) is local by
 * definition, so that is what everything here does.
 */
function partsOf(day: string): { year: number; month: number; date: number } | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
	if (!match) return null
	return { year: Number(match[1]), month: Number(match[2]) - 1, date: Number(match[3]) }
}

function isoOf(date: Date): string {
	const month = String(date.getMonth() + 1).padStart(2, '0')
	const day = String(date.getDate()).padStart(2, '0')
	return `${date.getFullYear()}-${month}-${day}`
}

/** Monday = 0, Sunday = 6 — `getDay()` counts from Sunday, which is the one thing it gets wrong here. */
function weekdayIndex(date: Date): number {
	return (date.getDay() + 6) % 7
}

/**
 * The days a span covers, as ISO strings, always in whole weeks.
 *
 * A week is the seven days containing the anchor, Monday first. A month starts on the Monday on or
 * before the 1st and runs to the Sunday on or after the last — **four to six rows, whichever the month
 * needs**, rather than a fixed number. A fixed grid would either leave a blank row on February or, far
 * worse for a view that stands real cards on its days, leave the last week of a long month with nowhere
 * to put them.
 */
export function daysInSpan(anchor: string, span: CalendarSpan): string[] {
	const parts = partsOf(anchor)
	if (!parts) return []
	const { year, month, date } = parts

	let start: Date
	let count: number
	if (span === 'week') {
		start = new Date(year, month, date - weekdayIndex(new Date(year, month, date)))
		count = DAYS_PER_WEEK
	} else {
		const first = new Date(year, month, 1)
		start = new Date(year, month, 1 - weekdayIndex(first))
		const daysInMonth = new Date(year, month + 1, 0).getDate()
		count = Math.ceil((weekdayIndex(first) + daysInMonth) / DAYS_PER_WEEK) * DAYS_PER_WEEK
	}

	const days: string[] = []
	for (let i = 0; i < count; i++) {
		days.push(isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))
	}
	return days
}

/** What the title strip says: "August 2026", or "10 – 16 Aug". */
export function spanTitle(anchor: string, span: CalendarSpan): string {
	const parts = partsOf(anchor)
	if (!parts) return ''
	if (span === 'month') {
		return new Date(parts.year, parts.month, 1).toLocaleDateString('en-GB', {
			month: 'long',
			year: 'numeric',
		})
	}
	const days = daysInSpan(anchor, span)
	const from = partsOf(days[0]!)!
	const to = partsOf(days[days.length - 1]!)!
	const fmt = (p: { year: number; month: number; date: number }, withMonth: boolean) =>
		new Date(p.year, p.month, p.date).toLocaleDateString('en-GB', {
			day: 'numeric',
			...(withMonth ? { month: 'short' } : {}),
		})
	return `${fmt(from, from.month !== to.month)} – ${fmt(to, true)}`
}

/**
 * The seven columns, wrapped into however many rows the span needs.
 *
 * Width is derived from the card, never stored — the same bargain the kanban's lanes make, so resizing
 * is ordinary `resizeBox` and a wider card means wider days. Heights are *not* here: they come from the
 * cards standing on the days, which is what `calendarSlots` works out.
 */
export function dayBoxes(anchor: string, span: CalendarSpan, width: number): DayBox[] {
	const { pad, cellGap } = CALENDAR_METRICS
	const days = daysInSpan(anchor, span)
	const month = partsOf(anchor)?.month
	const columnWidth = Math.max(1, (width - pad * 2 - cellGap * (DAYS_PER_WEEK - 1)) / DAYS_PER_WEEK)

	return days.map((day, i) => {
		const column = i % DAYS_PER_WEEK
		return {
			day,
			// A day drawn to fill out the week either side of a month is dimmed, not hidden: it is a real
			// day, and a card due on it must have somewhere to stand.
			inSpan: span === 'week' || partsOf(day)?.month === month,
			column,
			row: Math.floor(i / DAYS_PER_WEEK),
			x: pad + column * (columnWidth + cellGap),
			width: columnWidth,
		}
	})
}

/** How many week rows a set of boxes spans. */
export function rowCount(boxes: readonly DayBox[]): number {
	return Math.max(1, Math.ceil(boxes.length / DAYS_PER_WEEK))
}

/**
 * How tall one row of days is, given the card's height.
 *
 * The inverse of what `calendarSlots` computed, so the chrome and the drop target can both work out
 * where a row starts from the card's own `h` — which is the only thing they are given. Every row is the
 * same height on purpose: a calendar whose weeks were different heights because one of them was busy
 * would read as a rendering fault, where a kanban with a long lane plainly does not.
 */
export function rowHeight(rows: number, height: number): number {
	const { pad, cellGap } = CALENDAR_METRICS
	return Math.max(1, (height - gridTop() - pad - cellGap * (rows - 1)) / rows)
}

/** Shape-space y of a row's top edge. */
export function rowTop(row: number, rows: number, height: number): number {
	return gridTop() + row * (rowHeight(rows, height) + CALENDAR_METRICS.cellGap)
}

export interface CalendarSlots {
	/** Shape-space top-left per member id. */
	slots: Map<string, { x: number; y: number }>
	/** What the card's own height must be for the busiest day to fit. */
	height: number
}

/**
 * Stands each day's cards on that day, and reports the height the card needs.
 *
 * The busiest day sets the height of **every** row, since the rows are uniform — so a month with one
 * heavy Tuesday is tall throughout. That is the price of a grid that reads as a calendar, and it is
 * paid in a direction that cannot hide anything.
 *
 * Cards keep their own size, exactly as in a lane: a card wider than a day column overhangs, visibly,
 * which is the honest failure and the hint to widen the card or switch to a week.
 */
export function calendarSlots(
	boxes: readonly DayBox[],
	membersByDay: ReadonlyMap<string, readonly LaneMember[]>
): CalendarSlots {
	const { pad, cellGap, dayHeadHeight, cardGap, emptyDayHeight } = CALENDAR_METRICS
	const rows = rowCount(boxes)

	let tallest: number = emptyDayHeight
	for (const box of boxes) {
		const members = membersByDay.get(box.day) ?? []
		if (!members.length) continue
		// The trailing gap is dropped: it is the space *between* cards, and counting it after the last one
		// leaves every day looking like it is waiting for another.
		const stack = members.reduce((total, member) => total + member.height + cardGap, 0) - cardGap
		tallest = Math.max(tallest, dayHeadHeight + stack)
	}

	const height = gridTop() + rows * tallest + cellGap * (rows - 1) + pad
	const slots = new Map<string, { x: number; y: number }>()
	for (const box of boxes) {
		const members = membersByDay.get(box.day) ?? []
		let y = rowTop(box.row, rows, height) + dayHeadHeight
		for (const member of members) {
			slots.set(member.id, { x: box.x, y })
			y += member.height + cardGap
		}
	}
	return { slots, height }
}

/**
 * The day under a point in the card, or `null` for one that is not offering to set a date.
 *
 * Strict containment, unlike the kanban's nearest-lane rule: the gaps here are between *seven* columns
 * and several rows, so "nearest" would guess a day either side of the one aimed at — and unlike two
 * adjacent lanes, which are adjacent states, the wrong guess is a wrong date. A miss is better.
 */
export function dayAt(
	boxes: readonly DayBox[],
	height: number,
	local: { x: number; y: number }
): string | null {
	if (local.y < gridTop()) return null
	const rows = rowCount(boxes)
	const rowSize = rowHeight(rows, height)
	for (const box of boxes) {
		const top = rowTop(box.row, rows, height)
		if (
			local.x >= box.x &&
			local.x < box.x + box.width &&
			local.y >= top &&
			local.y < top + rowSize
		) {
			return box.day
		}
	}
	return null
}

/** What a calendar asks to be when it is first switched to: seven days wide enough to stand cards on. */
export function calendarWidth(): number {
	const { pad, cellGap, defaultDayWidth } = CALENDAR_METRICS
	return defaultDayWidth * DAYS_PER_WEEK + cellGap * (DAYS_PER_WEEK - 1) + pad * 2
}

// A day wants exactly what a lane wants from a member — how tall it stands — so the type is shared
// rather than duplicated under a calendar-flavoured name.
export type { LaneMember }
