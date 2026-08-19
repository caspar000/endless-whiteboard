import { describe, expect, it } from 'vitest'
import {
	CALENDAR_METRICS,
	calendarAnchor,
	calendarSlots,
	calendarSpan,
	dayAt,
	dayBoxes,
	daysInSpan,
	gridTop,
	rowCount,
	rowHeight,
	rowTop,
	spanTitle,
	type LaneMember,
} from './calendarLayout'

describe('daysInSpan', () => {
	/**
	 * August 2026 starts on a Saturday, so the grid opens on Monday 27 July and runs to Sunday 6
	 * September: six weeks. Whole weeks always, or the columns would stop being weekdays.
	 */
	it('covers a month in whole weeks, starting on the Monday before it', () => {
		const days = daysInSpan('2026-08-01', 'month')
		expect(days).toHaveLength(42)
		expect(days[0]).toBe('2026-07-27')
		expect(days[days.length - 1]).toBe('2026-09-06')
	})

	/** February 2026 begins on a Sunday and has 28 days: five rows, not a padded six. A fixed grid would
	 * leave a blank row and read as a rendering fault. */
	it('uses only the rows a month needs', () => {
		expect(daysInSpan('2026-02-10', 'month')).toHaveLength(35)
		// March 2026 starts on a Sunday too, with 31 days — the six-row case.
		expect(daysInSpan('2026-03-01', 'month')).toHaveLength(42)
	})

	it('starts a month that begins on a Monday with the 1st', () => {
		// June 2026 starts on a Monday.
		expect(daysInSpan('2026-06-15', 'month')[0]).toBe('2026-06-01')
	})

	it('gives a week the Monday-to-Sunday around the anchor', () => {
		expect(daysInSpan('2026-08-13', 'week')).toEqual([
			'2026-08-10',
			'2026-08-11',
			'2026-08-12',
			'2026-08-13',
			'2026-08-14',
			'2026-08-15',
			'2026-08-16',
		])
	})

	/** A week that straddles a month, and the year boundary — where naive day arithmetic gives up. */
	it('crosses month and year boundaries', () => {
		expect(daysInSpan('2026-09-02', 'week')[0]).toBe('2026-08-31')
		expect(daysInSpan('2027-01-01', 'week')).toEqual([
			'2026-12-28',
			'2026-12-29',
			'2026-12-30',
			'2026-12-31',
			'2027-01-01',
			'2027-01-02',
			'2027-01-03',
		])
	})

	it('is empty for something that is not a date', () => {
		expect(daysInSpan('not a date', 'month')).toEqual([])
	})
})

describe('calendarAnchor', () => {
	/** What the config panel stores is a month; the layout wants a day inside it. */
	it('takes a stored month to its first day', () => {
		expect(calendarAnchor({ anchor: '2026-08' })).toBe('2026-08-01')
	})

	it('keeps a stored day', () => {
		expect(calendarAnchor({ anchor: '2026-08-13' })).toBe('2026-08-13')
	})

	/**
	 * Absent follows today — a card that opened on the month it was created in would be showing last
	 * April by the summer. Injected here rather than read, which is the whole reason this is testable.
	 */
	it('follows today when nothing is stored', () => {
		expect(calendarAnchor({}, new Date(2026, 7, 13))).toBe('2026-08-13')
		expect(calendarAnchor({ anchor: null }, new Date(2026, 0, 5))).toBe('2026-01-05')
	})

	it('reads a nonsense anchor as today rather than drawing nothing', () => {
		expect(calendarAnchor({ anchor: 'soon' }, new Date(2026, 7, 13))).toBe('2026-08-13')
	})
})

describe('calendarSpan', () => {
	/**
	 * A **week** unless a month was asked for. A week is the span a board can be worked in — seven columns
	 * wide enough to stand real cards in — where a month is for looking at, so it is an answer rather than
	 * the default.
	 */
	it('is a week unless a month was asked for', () => {
		expect(calendarSpan({})).toBe('week')
		expect(calendarSpan({ span: 'month' })).toBe('month')
		expect(calendarSpan({ span: 'nonsense' })).toBe('week')
	})
})

describe('spanTitle', () => {
	it('names the month', () => {
		expect(spanTitle('2026-08-13', 'month')).toBe('August 2026')
	})

	it('names a week by its ends, and only repeats the month when it changes', () => {
		expect(spanTitle('2026-08-13', 'week')).toBe('10 – 16 Aug')
		// "Sept", not "Sep": that is `en-GB`'s own short form, and the same one every other date in the app
		// is formatted with. Pinned rather than worked around, so a locale change is a visible decision.
		expect(spanTitle('2026-09-02', 'week')).toBe('31 Aug – 6 Sept')
	})
})

const member = (id: string, height: number): LaneMember => ({ id, height })

describe('dayBoxes', () => {
	const boxes = dayBoxes('2026-08-01', 'month', 700)

	it('lays seven columns across the card, wrapping into week rows', () => {
		const firstWeek = boxes.slice(0, 7)
		expect(new Set(firstWeek.map((b) => b.row)).size).toBe(1)
		for (let i = 1; i < firstWeek.length; i++) {
			expect(firstWeek[i]!.x).toBeGreaterThan(firstWeek[i - 1]!.x)
		}
		expect(boxes[7]!.row).toBe(1)
		expect(boxes[7]!.x).toBe(boxes[0]!.x)
	})

	/** A week is one row — the span this view defaults to, and the one you can actually work in. */
	it('gives a week a single row of seven', () => {
		const week = dayBoxes('2026-08-13', 'week', 700)
		expect(week).toHaveLength(7)
		expect(rowCount(week)).toBe(1)
		expect(new Set(week.map((b) => b.row))).toEqual(new Set([0]))
	})

	it('spans four to six rows for a month, whichever it needs', () => {
		expect(rowCount(dayBoxes('2026-02-10', 'month', 700))).toBe(5)
		expect(rowCount(dayBoxes('2026-08-01', 'month', 700))).toBe(6)
	})

	/** The days filling out the first and last weeks are real days — dimmed, never hidden, because a card
	 * due on one has to be somewhere to stand. */
	it('marks the days either side of the month', () => {
		expect(boxes.find((b) => b.day === '2026-07-27')!.inSpan).toBe(false)
		expect(boxes.find((b) => b.day === '2026-08-01')!.inSpan).toBe(true)
		expect(boxes.find((b) => b.day === '2026-09-06')!.inSpan).toBe(false)
	})

	it('widens every day when the card is widened', () => {
		expect(dayBoxes('2026-08-13', 'week', 900)[0]!.width).toBeGreaterThan(
			dayBoxes('2026-08-13', 'week', 700)[0]!.width
		)
	})

	it('never produces a column of nothing on an impossibly narrow card', () => {
		for (const box of dayBoxes('2026-08-01', 'month', 20)) {
			expect(box.width).toBeGreaterThan(0)
			expect(Number.isFinite(box.x)).toBe(true)
		}
	})
})

describe('calendarSlots', () => {
	const week = dayBoxes('2026-08-13', 'week', 700)

	it('stands the cards for a day on that day, stacked below its number', () => {
		const { slots, height } = calendarSlots(
			week,
			new Map([['2026-08-13', [member('a', 40), member('b', 60)]]])
		)
		const thursday = week.find((b) => b.day === '2026-08-13')!
		const top = rowTop(0, 1, height) + CALENDAR_METRICS.dayHeadHeight
		expect(slots.get('a')).toEqual({ x: thursday.x, y: top })
		expect(slots.get('b')).toEqual({ x: thursday.x, y: top + 40 + CALENDAR_METRICS.cardGap })
	})

	it('puts the cards for each day at its own column', () => {
		const { slots } = calendarSlots(
			week,
			new Map([
				['2026-08-10', [member('mon', 40)]],
				['2026-08-16', [member('sun', 40)]],
			])
		)
		expect(slots.get('mon')!.x).toBe(week[0]!.x)
		expect(slots.get('sun')!.x).toBe(week[6]!.x)
	})

	/**
	 * Every row is the same height, set by the busiest day anywhere in the span. A calendar whose weeks
	 * were different heights because one of them was busy reads as a rendering fault, where a kanban with
	 * one long lane plainly does not.
	 */
	it('makes every row as tall as the busiest day', () => {
		const month = dayBoxes('2026-08-01', 'month', 700)
		const { height } = calendarSlots(month, new Map([['2026-08-13', [member('a', 300)]]]))
		const rows = rowCount(month)
		const size = rowHeight(rows, height)
		expect(size).toBeGreaterThanOrEqual(300 + CALENDAR_METRICS.dayHeadHeight)
		// And what the chrome derives back out of the height matches what the slots were placed against.
		expect(rowTop(1, rows, height) - rowTop(0, rows, height)).toBeCloseTo(
			size + CALENDAR_METRICS.cellGap
		)
	})

	it('gives an empty calendar days you can still drop on', () => {
		const { slots, height } = calendarSlots(week, new Map())
		expect(slots.size).toBe(0)
		expect(rowHeight(1, height)).toBe(CALENDAR_METRICS.emptyDayHeight)
	})
})

describe('dayAt', () => {
	const boxes = dayBoxes('2026-08-01', 'month', 700)
	const height = calendarSlots(boxes, new Map()).height
	const rows = rowCount(boxes)
	const size = rowHeight(rows, height)

	it('finds the day a point is inside', () => {
		for (const day of ['2026-08-01', '2026-08-13', '2026-08-31']) {
			const box = boxes.find((b) => b.day === day)!
			const point = { x: box.x + box.width / 2, y: rowTop(box.row, rows, height) + size / 2 }
			expect(dayAt(boxes, height, point)).toBe(day)
		}
	})

	/**
	 * Strict containment, unlike the kanban's nearest-lane rule: with seven columns, "nearest" would guess
	 * a day either side of the one aimed at — and a wrong day is a wrong date, where a wrong lane is at
	 * least an adjacent state.
	 */
	it('is nothing in the gap between days', () => {
		const first = boxes[0]!
		expect(dayAt(boxes, height, { x: first.x + first.width + 1, y: rowTop(0, rows, height) + 4 }))
			.toBeNull()
	})

	it('is nothing on the title strip or the weekday row', () => {
		expect(dayAt(boxes, height, { x: 300, y: 2 })).toBeNull()
		expect(dayAt(boxes, height, { x: 300, y: CALENDAR_METRICS.titleHeight + 2 })).toBeNull()
	})
})
