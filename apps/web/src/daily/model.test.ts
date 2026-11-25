import { describe, expect, it } from 'vitest'
import {
	DAILY_GRID,
	addDays,
	applyChanges,
	blockContents,
	dayProgress,
	defaultSetup,
	drawPick,
	editBase,
	eveningCounts,
	firstGap,
	fitTiles,
	fits,
	focusOf,
	freeCells,
	layoutFor,
	nearbyPicks,
	metricTotal,
	newPage,
	newWeek,
	pagePhotoHashes,
	pageFor,
	placeAt,
	readPage,
	readSetup,
	readWeek,
	recentPicks,
	squeezed,
	trackCell,
	trackTotal,
	weekNumber,
	weekOf,
	weekRange,
	weekday,
	withLayout,
	withLayoutFrom,
	withPageLayout,
	withoutTemplate,
	type DayPage,
	type TrackRow,
	type Widget,
} from './model'

const widget = (id: string, col: number, row: number, w: number, h: number): Widget => ({ id, type: 'notes', col, row, w, h, config: {} })

describe('days and weeks', () => {
	it('starts weeks on Monday', () => {
		expect(weekday('2026-11-23')).toBe(0)
		expect(weekday('2026-11-29')).toBe(6)
		expect(weekOf('2026-11-29')).toBe('2026-11-23')
		expect(weekOf('2026-11-30')).toBe('2026-11-30')
	})

	it('steps over months and years', () => {
		expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
		expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
		expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
	})

	it('numbers weeks the ISO way', () => {
		expect(weekNumber('2026-11-24')).toBe(48)
		expect(weekNumber('2027-01-01')).toBe(53)
		expect(weekNumber('2027-01-04')).toBe(1)
	})

	it('writes a week’s range', () => {
		expect(weekRange('2026-11-23')).toBe('23 – 29 Nov 2026')
		expect(weekRange('2026-11-30')).toBe('30 Nov – 6 Dec 2026')
		expect(weekRange('2026-12-28')).toBe('28 Dec 2026 – 3 Jan 2027')
	})
})

describe('the layout grid', () => {
	const widgets = [widget('a', 0, 0, 2, 2), widget('b', 0, 2, 1, 3)]

	it('says what fits', () => {
		expect(fits(widgets, { col: 1, row: 2, w: 1, h: 3 }, DAILY_GRID)).toBe(true)
		expect(fits(widgets, { col: 0, row: 3, w: 1, h: 1 }, DAILY_GRID)).toBe(false)
		expect(fits(widgets, { col: 1, row: 11, w: 1, h: 2 }, DAILY_GRID)).toBe(false)
		// A widget never collides with itself as it moves.
		expect(fits(widgets, { col: 0, row: 3, w: 1, h: 3 }, DAILY_GRID, 'b')).toBe(true)
	})

	it('finds the first gap row by row', () => {
		expect(firstGap(widgets, { w: 1, h: 2 }, DAILY_GRID)).toEqual({ col: 1, row: 2 })
		expect(firstGap(widgets, { w: 2, h: 1 }, DAILY_GRID)).toEqual({ col: 0, row: 5 })
		const full = [widget('all', 0, 0, 2, 12)]
		expect(firstGap(full, { w: 1, h: 1 }, DAILY_GRID)).toBeNull()
		expect(freeCells(full, DAILY_GRID)).toEqual([])
	})

	it('drops a widget as tall as fits from the cell it lands on', () => {
		const below = [...widgets, widget('c', 1, 4, 1, 1)]
		expect(placeAt(below, { col: 1, row: 2 }, { w: 1, h: 3 }, DAILY_GRID)).toEqual({ col: 1, row: 2, w: 1, h: 2 })
		expect(placeAt(below, { col: 0, row: 0 }, { w: 1, h: 1 }, DAILY_GRID)).toBeNull()
		// Two columns wide from the right-hand column is cut to one.
		expect(placeAt([], { col: 1, row: 0 }, { w: 2, h: 1 }, DAILY_GRID)).toEqual({ col: 1, row: 0, w: 1, h: 1 })
	})

	it('changes the layout from a day on, keeping earlier days’', () => {
		const setup = defaultSetup('2026-11-01')
		const changed = withLayout(setup, '2026-11-20', [widget('only', 0, 0, 1, 1)])
		expect(layoutFor(changed, '2026-11-19').length).toBe(setup.layouts[0]!.widgets.length)
		expect(layoutFor(changed, '2026-11-20').map((w) => w.id)).toEqual(['only'])
		expect(layoutFor(changed, '2026-12-01').map((w) => w.id)).toEqual(['only'])
		// A day before the first layout shows the first one.
		expect(layoutFor(changed, '2026-10-01').length).toBe(setup.layouts[0]!.widgets.length)
		// Changing the same day again replaces its layout rather than adding one.
		expect(withLayout(changed, '2026-11-20', []).layouts).toHaveLength(2)
	})
})

describe('saving a page’s changes', () => {
	const setup = defaultSetup('2026-11-01')
	const base = layoutFor(setup, '2026-11-25')
	const morning = base.find((w) => w.id === 'morning')!
	const more = { iconTaskIds: [...setup.templates[0]!.iconTaskIds, 'nap'], items: [] }
	const edited = base.map((w) => (w.id === 'morning' ? { ...w, config: { ...w.config, contents: more } } : w))

	it('changes one block on one page, not its template or any other page', () => {
		const saved = withPageLayout(setup, '2026-11-25', edited)
		expect(blockContents(saved, layoutFor(saved, '2026-11-25').find((w) => w.id === 'morning')!)).toEqual(more)
		expect(blockContents(saved, layoutFor(saved, '2026-11-24').find((w) => w.id === 'morning')!)?.iconTaskIds).toHaveLength(4)
		expect(blockContents(saved, layoutFor(saved, '2026-11-26').find((w) => w.id === 'morning')!)?.iconTaskIds).toHaveLength(4)
		expect(saved.templates).toEqual(setup.templates)
		// A day's progress counts what its own page shows.
		const page = { ...newPage('2026-11-25'), ticks: ['nap'] }
		expect(dayProgress(saved, page, '2026-11-25', '')).toBeGreaterThan(0)
		expect(dayProgress(setup, page, '2026-11-25', '')).toBe(0)
	})

	it('keeps no page of its own when it ends up the same as the days around it', () => {
		const saved = withPageLayout(withPageLayout(setup, '2026-11-25', edited), '2026-11-25', base)
		expect(saved.layouts).toEqual(setup.layouts)
	})

	it('reads a page’s own layout and a block’s own tasks back', () => {
		const saved = withPageLayout(setup, '2026-11-25', edited)
		expect(readSetup(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
	})

	it('carries a change to every page after, keeping what a later page changed for itself', () => {
		// Friday's notes were given a heading of their own.
		const friday = layoutFor(setup, '2026-11-27').map((w) => (w.id === 'notes' ? { ...w, title: 'FRIDAY' } : w))
		const withFriday = withPageLayout(setup, '2026-11-27', friday)
		const saved = withLayoutFrom(withFriday, '2026-11-25', base, edited)
		const fridayMorning = layoutFor(saved, '2026-11-27').find((w) => w.id === 'morning')!
		expect(blockContents(saved, fridayMorning)).toEqual(more)
		expect(layoutFor(saved, '2026-11-27').find((w) => w.id === 'notes')!.title).toBe('FRIDAY')
		expect(blockContents(saved, layoutFor(saved, '2026-12-10').find((w) => w.id === 'morning')!)).toEqual(more)
		// The days before are left alone.
		expect(blockContents(saved, layoutFor(saved, '2026-11-24').find((w) => w.id === 'morning')!)?.iconTaskIds).toHaveLength(4)
		expect(morning.config.contents).toBeUndefined()
	})

	it('takes widgets out, puts new ones in where they fit, and leaves out a move that would collide', () => {
		const before = [widget('a', 0, 0, 1, 1), widget('b', 1, 0, 1, 1)]
		const after = [widget('a', 0, 1, 1, 1), widget('c', 1, 1, 1, 1)]
		const later = [widget('a', 0, 0, 1, 1), widget('b', 1, 0, 1, 1), widget('x', 0, 1, 1, 1)]
		const out = applyChanges(later, before, after)
		expect(out.map((w) => w.id).sort()).toEqual(['a', 'c', 'x'])
		// `a` would land on `x` there, so it stays where that page has it.
		expect(out.find((w) => w.id === 'a')).toMatchObject({ col: 0, row: 0 })
	})
})

describe('templates', () => {
	it('deleting one leaves its blocks showing what they showed', () => {
		const setup = defaultSetup('2026-11-01')
		const out = withoutTemplate(setup, 'morning')
		const block = layoutFor(out, '2026-11-25').find((w) => w.id === 'morning')!
		expect(out.templates.some((t) => t.id === 'morning')).toBe(false)
		expect(block.title).toBe('MORNING')
		expect(blockContents(out, block)).toEqual({ iconTaskIds: setup.templates[0]!.iconTaskIds, items: [] })
	})
})

describe('focus', () => {
	const setup = defaultSetup('2026-11-01')
	const plan = { ...newWeek('2026-11-23'), cycleId: 'w3' }

	it('takes the cycle’s areas in turn through the week', () => {
		expect(focusOf(setup, plan, undefined, '2026-11-23')).toBe('art')
		expect(focusOf(setup, plan, undefined, '2026-11-24')).toBe('music')
		expect(focusOf(setup, plan, undefined, '2026-11-25')).toBe('art')
	})

	it('lets a planned evening and the page itself say otherwise', () => {
		const evenings = ['family', '', '', '', '', '', '']
		expect(focusOf(setup, { ...plan, evenings }, undefined, '2026-11-23')).toBe('family')
		expect(focusOf(setup, { ...plan, evenings }, { ...newPage('2026-11-23'), focusId: 'gamedev' }, '2026-11-23')).toBe('gamedev')
	})

	it('has none without a cycle chosen: cycles are never moved on by themselves', () => {
		expect(focusOf(setup, undefined, undefined, '2026-11-23')).toBe('')
		expect(focusOf(setup, newWeek('2026-11-23'), undefined, '2026-11-23')).toBe('')
	})
})

describe('a day’s page', () => {
	const pages: Record<string, DayPage> = {
		'2026-11-22': { ...newPage('2026-11-22'), lists: { tasks: [{ id: 'x', text: 'Old', done: false, from: '2026-11-20' }] } },
		'2026-11-23': {
			...newPage('2026-11-23'),
			lists: {
				tasks: [
					{ id: 'a', text: 'Buy shampoo', done: false },
					{ id: 'b', text: 'Buy toothpaste', done: true },
					{ id: 'c', text: '  ', done: false },
				],
			},
		},
	}

	it('carries what the latest earlier page left unticked, marked with its first day', () => {
		const page = pageFor(pages, '2026-11-25', true, ['tasks'])
		expect(page.lists.tasks).toEqual([{ id: 'a', text: 'Buy shampoo', done: false, from: '2026-11-23' }])
		// Kept from the day it was first written, across several carries.
		expect(pageFor(pages, '2026-11-23', true, ['tasks']).lists.tasks).toHaveLength(3)
	})

	it('carries nothing with carrying off, or into a list the day already has', () => {
		expect(pageFor(pages, '2026-11-25', false, ['tasks']).lists).toEqual({})
		const own = { ...pages, '2026-11-25': { ...newPage('2026-11-25'), lists: { tasks: [] } } }
		expect(pageFor(own, '2026-11-25', true, ['tasks']).lists.tasks).toEqual([])
	})

	it('edits a saved day with the tasks it carried, rather than losing them', () => {
		// The day was saved for something else (its fasting) before carrying was turned on.
		const saved = { ...pages, '2026-11-25': { ...newPage('2026-11-25'), fasting: 'adf' } }
		const shown = pageFor(saved, '2026-11-25', true, ['tasks'])
		expect(shown.lists.tasks?.map((t) => t.text)).toEqual(['Buy shampoo'])
		const base = editBase(saved['2026-11-25'], shown, '2026-11-25')
		expect(base.fasting).toBe('adf')
		expect(base.lists.tasks?.map((t) => t.text)).toEqual(['Buy shampoo'])
		// A list the day already stores is its own, whatever an older render showed.
		const own = { ...saved['2026-11-25'], lists: { tasks: [] } }
		expect(editBase(own, shown, '2026-11-25').lists.tasks).toEqual([])
		// No stored page: what is shown is where the edit starts.
		expect(editBase(undefined, shown, '2026-11-25')).toBe(shown)
		expect(editBase(undefined, undefined, '2026-11-25')).toEqual(newPage('2026-11-25'))
	})

	it('counts its progress over what its layout shows', () => {
		const setup = defaultSetup('2026-11-01')
		const page = { ...newPage('2026-11-23'), ticks: ['brush-teeth', 'shower'], lists: { tasks: [{ id: 't', text: 'x', done: true }] } }
		const progress = dayProgress(setup, page, '2026-11-23', 'art')!
		// MORNING 4, HABITS 4, EVENING 2, PHYSICAL 3, Art's 2 focus tasks, and 1 task.
		expect(progress).toBeCloseTo(3 / 16)
		expect(dayProgress(setup, undefined, '2026-11-23', 'art')).toBeNull()
	})
})

describe('the week in review', () => {
	const setup = defaultSetup('2026-11-01')
	const days = ['2026-11-23', '2026-11-24', '2026-11-25']
	const pages: (DayPage | undefined)[] = [
		{ ...newPage(days[0]!), ticks: ['swim'], numbers: { weight: 72 }, fasting: 'adf' },
		{ ...newPage(days[1]!), ticks: ['swim'], numbers: { weight: 73, pages: 20 } },
		undefined,
	]

	it('fills a habit row from the pages', () => {
		const swim: TrackRow = { id: 'r', label: 'Swim', ref: { kind: 'tick', id: 'swim' }, target: 5 }
		const cells = pages.map((p) => trackCell(swim, p))
		expect(cells).toEqual([{ kind: 'tick', done: true }, { kind: 'tick', done: true }, { kind: 'empty' }])
		expect(trackTotal(setup, swim, cells).text).toBe('2/5')
		const fasted: TrackRow = { id: 'f', label: 'Fasted', ref: { kind: 'fasting' } }
		expect(trackTotal(setup, fasted, pages.map((p) => trackCell(fasted, p))).text).toBe('1/7')
	})

	it('averages or adds a number, as the number says', () => {
		const weight: TrackRow = { id: 'w', label: '', ref: { kind: 'metric', id: 'weight' } }
		expect(trackTotal(setup, weight, pages.map((p) => trackCell(weight, p))).text).toBe('72.5 avg')
		const read: TrackRow = { id: 'p', label: '', ref: { kind: 'metric', id: 'pages' } }
		expect(trackTotal(setup, read, pages.map((p) => trackCell(read, p))).text).toBe('20 pp')
		expect(metricTotal(setup.metrics[0]!, pages)).toBe(72.5)
		expect(metricTotal(setup.metrics[0]!, [undefined])).toBeNull()
	})

	it('finds the area the evenings left out', () => {
		const counts = eveningCounts([
			{ ...newWeek('2026-11-16'), evenings: ['music', 'gamedev', 'music', 'gamedev', 'family', 'rest', 'family'] },
			{ ...newWeek('2026-11-23'), evenings: ['music', 'gamedev', 'art', 'music', 'gamedev', 'rest', 'family'] },
			undefined,
		])
		expect(counts.get('music')).toBe(4)
		expect(counts.get('art')).toBe(1)
		expect(squeezed(setup.areas, counts).map((a) => a.id)).toEqual(['art'])
		expect(squeezed(setup.areas, new Map())).toEqual([])
	})
})

describe('the daily pick', () => {
	const entries = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, title: id, creator: '', year: '', cover: '', url: '' }))

	it('draws the same on every device, and again differently', () => {
		const first = drawPick(entries, '2026-11-24', 0, new Set())
		expect(drawPick(entries, '2026-11-24', 0, new Set())).toBe(first)
		const draws = new Set([0, 1, 2, 3, 4, 5, 6, 7].map((n) => drawPick(entries, '2026-11-24', n, new Set())?.id))
		expect(draws.size).toBeGreaterThan(1)
	})

	it('passes over what it is told to skip, while anything else is left', () => {
		const skip = new Set(['a', 'b', 'c', 'd'])
		expect(drawPick(entries, '2026-11-24', 0, skip)?.id).toBe('e')
		expect(drawPick(entries, '2026-11-24', 0, new Set(entries.map((e) => e.id)))).not.toBeNull()
		expect(drawPick([], '2026-11-24', 0, new Set())).toBeNull()
	})

	it('remembers recent days’ draws', () => {
		const pick = { source: 's', id: 'a', title: '', creator: '', year: '', cover: '', url: '', draws: 0, stamp: '', impression: '' }
		const pages = { '2026-11-20': { ...newPage('2026-11-20'), picks: { w: pick } }, '2026-10-01': { ...newPage('2026-10-01'), picks: { w: { ...pick, id: 'old' } } } }
		expect([...recentPicks(pages, '2026-11-24', 30)]).toEqual(['a'])
	})
})

describe('drawing a day ahead', () => {
	it('steers clear of the days before and the day after', () => {
		const pick = (id: string) => ({ source: 's', id, title: id, creator: '', year: '', cover: '', url: '', draws: 0, stamp: '', impression: '' })
		const pages = {
			'2026-11-23': { ...newPage('2026-11-23'), picks: { w: pick('mon') } },
			'2026-11-25': { ...newPage('2026-11-25'), picks: { w: pick('wed') } },
			'2026-11-26': { ...newPage('2026-11-26'), picks: { w: pick('thu') } },
		}
		expect([...nearbyPicks(pages, '2026-11-24', 30)].sort()).toEqual(['mon', 'wed'])
	})
})

describe('reading stored data', () => {
	it('reads a setup back whole', () => {
		const setup = defaultSetup('2026-11-01')
		expect(readSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup)
		expect(readSetup({})).toBeNull()
		expect(readSetup(null)).toBeNull()
	})

	it('drops what it can’t read and keeps the rest', () => {
		const setup = readSetup({
			areas: [{ id: 'a', name: 'Art' }, { name: 'no id' }, { id: 'a', name: 'twice' }],
			cycles: 'nonsense',
			layouts: [{ from: 'yesterday', widgets: [] }, { from: '2026-11-01', widgets: [{ id: 'w', type: 'bogus' }, { id: 'n', type: 'notes', col: 1, row: 2 }] }],
			reviewDay: 9,
		})!
		expect(setup.areas).toEqual([{ id: 'a', name: 'Art', color: '#6c8cff', tasks: [] }])
		expect(setup.cycles).toEqual([])
		expect(setup.layouts).toEqual([{ from: '2026-11-01', widgets: [{ id: 'n', type: 'notes', col: 1, row: 2, w: 1, h: 1, config: {} }] }])
		expect(setup.reviewDay).toBe(6)
		expect(setup.carryTasks).toBe(true)
	})

	it('keeps a template’s icon tasks and checklist, dropping the list an old type kept out of sight', () => {
		const setup = readSetup({
			areas: [],
			templates: [
				{ id: 'i', name: 'Icons', kind: 'icons', iconTaskIds: ['a'], items: [{ id: 'x', text: 'hidden' }] },
				{ id: 'c', name: 'List', kind: 'checklist', iconTaskIds: ['b'], items: [{ id: 'y', text: 'shown' }] },
				{ id: 'both', name: 'Both', iconTaskIds: ['a'], items: [{ id: 'z', text: 'kept' }] },
			],
		})!
		expect(setup.templates).toEqual([
			{ id: 'i', name: 'Icons', iconTaskIds: ['a'], items: [] },
			{ id: 'c', name: 'List', iconTaskIds: [], items: [{ id: 'y', text: 'shown' }] },
			{ id: 'both', name: 'Both', iconTaskIds: ['a'], items: [{ id: 'z', text: 'kept' }] },
		])
	})

	it('reads a block’s icon grid within bounds', () => {
		const read = (config: unknown) => readSetup({ areas: [], review: [{ id: 'w', type: 'block', config }] })!.review[0]!.config
		expect(read({ iconRows: 2, iconCols: 4, hideTitle: true })).toEqual({ iconRows: 2, iconCols: 4, hideTitle: true })
		expect(read({ iconRows: 40, iconCols: 0, hideTitle: 'yes' })).toEqual({ iconRows: 8, iconCols: 1 })
	})

	it('reads pages and weeks, and the photos they keep', () => {
		const hash = 'a'.repeat(64)
		const page = readPage({ date: '2026-11-24', ticks: ['x', 'x', 3], food: [{ hash, at: '08:40' }, { hash: 'nope' }], numbers: { weight: 72.4, bad: 'x' } })!
		expect(page.ticks).toEqual(['x'])
		expect(page.food).toEqual([{ hash, at: '08:40' }])
		expect(page.numbers).toEqual({ weight: 72.4 })
		expect(readPage({ date: 'nope' })).toBeNull()
		expect([...pagePhotoHashes([page])]).toEqual([hash])
		const week = readWeek({ week: '2026-11-23', evenings: ['music'], tasks: [{ id: 't', text: 'Call', done: false, day: '2026-11-24' }] })!
		expect(week.evenings).toEqual(['music', '', '', '', '', '', ''])
		expect(week.tasks[0]!.day).toBe('2026-11-24')
	})
})

describe('the icon grid', () => {
	const opts = { gap: 0, min: 10, max: 100 }

	it('takes the arrangement that draws the tiles largest when left to itself', () => {
		// Four tiles in a wide, short box: one row.
		expect(fitTiles(4, { width: 200, height: 50 }, {}, opts)).toEqual({ rows: 1, cols: 4, size: 50 })
		// In a square box: two by two.
		expect(fitTiles(4, { width: 100, height: 100 }, {}, opts)).toEqual({ rows: 2, cols: 2, size: 50 })
	})

	it('follows the rows and columns it is given, and works out the missing one', () => {
		expect(fitTiles(4, { width: 200, height: 100 }, { rows: 2, cols: 4 }, opts)).toEqual({ rows: 2, cols: 4, size: 50 })
		expect(fitTiles(4, { width: 200, height: 100 }, { cols: 2 }, opts)).toEqual({ rows: 2, cols: 2, size: 50 })
		expect(fitTiles(6, { width: 300, height: 100 }, { rows: 2 }, opts)).toEqual({ rows: 2, cols: 3, size: 50 })
		// A grid too small for every tile grows rows rather than hiding one.
		expect(fitTiles(6, { width: 200, height: 300 }, { rows: 1, cols: 2 }, opts)).toEqual({ rows: 3, cols: 2, size: 100 })
	})

	it('keeps the tiles within their bounds and leaves room for the gaps', () => {
		expect(fitTiles(1, { width: 500, height: 500 }, {}, opts).size).toBe(100)
		expect(fitTiles(4, { width: 0, height: 0 }, {}, opts).size).toBe(10)
		expect(fitTiles(4, { width: 218, height: 50 }, { rows: 1 }, { ...opts, gap: 6 }).size).toBe(50)
		expect(fitTiles(0, { width: 100, height: 100 }, {}, opts)).toEqual({ rows: 0, cols: 0, size: 0 })
	})
})
