import { useValue } from 'tldraw'
import { dateGroupProperty } from '../spec'
import {
	CALENDAR_METRICS,
	WEEKDAY_LABELS,
	calendarAnchor,
	calendarSpan,
	dayBoxes,
	gridTop,
	rowCount,
	rowHeight,
	rowTop,
	spanTitle,
} from './calendarLayout'
import { getDropHint } from './dropHint'
import { rowsByLane } from './lanes'
import type { ViewProps } from './shared'

/**
 * The calendar: a week (or a month) of the board's dates, with the cards standing on their days.
 *
 * A kanban whose lanes are days — same bargain, same behaviour. There are no cards in here: they are
 * the real shapes, drawn by tldraw at the positions `placement.ts` gave them, still carrying their own
 * text and property strips. What this draws is the days they are standing on.
 *
 * A week is one row of seven; a month is the four to six rows that month spans. Metrics come from
 * `CALENDAR_METRICS` and are applied inline rather than from the stylesheet, because these same numbers
 * position the cards — see the note on `KANBAN_METRICS`.
 */
export function CalendarView({ id, result, props, width, height }: ViewProps) {
	const hint = useValue('lifeboard:view-drop-hint', () => getDropHint(), [])
	const hinted = hint?.viewId === id ? hint.lane : null

	const dayProperty = dateGroupProperty(props.groupBy)
	// The dispatcher shows `blockedReason` instead of this when there is no date to go on.
	if (!dayProperty) return null

	const anchor = calendarAnchor(props.layout)
	const span = calendarSpan(props.layout)
	const boxes = dayBoxes(anchor, span, width)
	const rows = rowCount(boxes)
	const size = rowHeight(rows, height)
	const byDay = rowsByLane(result.groups)
	const { pad, titleHeight, weekdayHeight, dayHeadHeight, cellGap } = CALENDAR_METRICS
	const columnWidth = boxes[0]?.width ?? 0
	const today = todayISO()

	return (
		<div className="lb-cal">
			<div className="lb-cal__title" style={{ height: titleHeight, padding: `0 ${pad}px` }}>
				{/* The period leads, the way it does on every calendar ever drawn — the card's own title is
				    what a new one calls itself ("Table"), which says nothing about what is on screen. The
				    title still names this card in the config panel, in ⌘K and in another view's rows. */}
				<span className="lb-table__title">{spanTitle(anchor, span)}</span>
				<span className="lb-table__count">
					{/* This period's own count, not the query's: a card due in September is a real row of this
					    table and is not on this week, so reporting `result.matched` would count something the
					    user cannot see. */}
					{countShown(boxes, byDay)} of {result.matched}
				</span>
			</div>

			<div
				className="lb-cal__weekdays"
				style={{ top: titleHeight, height: weekdayHeight, left: pad }}
			>
				{WEEKDAY_LABELS.map((label, i) => (
					<span
						key={label}
						className="lb-cal__weekday"
						style={{ left: i * (columnWidth + cellGap), width: columnWidth }}
					>
						{label}
					</span>
				))}
			</div>

			{boxes.map((box) => {
				const classes = ['lb-cal__day']
				if (!box.inSpan) classes.push('lb-cal__day--outside')
				if (box.day === today) classes.push('lb-cal__day--today')
				if (box.day === hinted) classes.push('lb-cal__day--drop')
				return (
					<div
						className={classes.join(' ')}
						key={box.day}
						style={{
							left: box.x,
							top: rowTop(box.row, rows, height),
							width: box.width,
							height: size,
						}}
					>
						<span className="lb-cal__date" style={{ height: dayHeadHeight }}>
							{dayNumber(box.day)}
							{/* The month is repeated on the 1st, the one day whose number does not say which
							    month it belongs to — and in a week straddling two, that is the difference between
							    reading the row and counting back from Monday. */}
							{box.day.endsWith('-01') && (
								<span className="lb-cal__month">{monthLabel(box.day)}</span>
							)}
						</span>
					</div>
				)
			})}

			<div className="lb-kanban__rule" style={{ top: gridTop() - 1, left: pad, right: pad }} />
		</div>
	)
}

function dayNumber(day: string): string {
	return String(Number(day.slice(8, 10)))
}

function monthLabel(day: string): string {
	const [year, month] = day.split('-').map(Number)
	return new Date(year!, month! - 1, 1).toLocaleDateString('en-GB', { month: 'short' })
}

/** Today, from local parts — never `toISOString`, which is UTC and so is yesterday for half the world. */
function todayISO(): string {
	const now = new Date()
	const month = String(now.getMonth() + 1).padStart(2, '0')
	const day = String(now.getDate()).padStart(2, '0')
	return `${now.getFullYear()}-${month}-${day}`
}

function countShown(
	boxes: readonly { day: string }[],
	byDay: ReadonlyMap<string, { rows: readonly unknown[] }>
): number {
	let total = 0
	for (const box of boxes) total += byDay.get(box.day)?.rows.length ?? 0
	return total
}
