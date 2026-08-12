import {
	formatCurrency,
	formatNumber,
	formatPropertyValue,
	stageForOption,
	type PropertyDef,
	type PropertyValue,
} from '@lifeboard/node-kit'

/**
 * Two small boards from two unrelated corners of life, for the Properties section to be played with.
 *
 * The point they exist to make is the one sentence about properties people don't believe until they see
 * it twice: the system has no opinion about your subject. One board here is about money, deadlines and
 * a decision; the other has no money in it at all and is about dates, beds and how much has come up.
 * They are described with the *same* eleven types, shown by the same widget, and answered by the same
 * four verbs — and nothing in this file is specific to either.
 *
 * The answers are **computed**, not written out. A help page that hardcodes "₾ 3,350" is a help page
 * that lies the first time someone edits the mock data above it; and running the numbers through
 * `formatCurrency`/`formatPropertyValue` means the example is formatted by exactly what formats a real
 * card, down to the mixed-currency behaviour.
 */

/** A mock shape on a mock board. */
export interface ExampleCard {
	id: string
	name: string
	/**
	 * Which kind of shape carries these values — a note, a sticky, a dragged-in photo.
	 *
	 * Varied on purpose in both examples: "any shape can carry any property" is the claim, and an
	 * example where every card is a note quietly fails to demonstrate it.
	 */
	kind: 'note' | 'sticky' | 'image'
	values: Record<string, PropertyValue>
	/** Per-shape unit overrides, i.e. the currency of a money value. Absent = the definition's default. */
	units?: Record<string, string>
}

export interface ExampleAnswer {
	value: string
	/** What the number means, or what it refuses to do and why. */
	note: string
}

export interface ExampleQuestion {
	id: string
	label: string
	/** The same question as an inline expression, where it is expressible as one. */
	expression?: string
	run: (cards: readonly ExampleCard[]) => ExampleAnswer
}

export interface ExampleDomain {
	id: string
	/** The tab label. */
	label: string
	/** The line under the tabs: what this board is for. */
	blurb: string
	properties: PropertyDef[]
	cards: ExampleCard[]
	questions: ExampleQuestion[]
}

// ---------------------------------------------------------------------------
// Reading values out of the mock cards
// ---------------------------------------------------------------------------

function numbersOf(cards: readonly ExampleCard[], id: string): number[] {
	return cards.flatMap((card) => {
		const value = card.values[id]
		return typeof value === 'number' ? [value] : []
	})
}

function stringsOf(cards: readonly ExampleCard[], id: string): string[] {
	return cards.flatMap((card) => {
		const value = card.values[id]
		return typeof value === 'string' && value ? [value] : []
	})
}

function average(values: number[]): number | null {
	if (!values.length) return null
	return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * A money total, split by the currency each card is actually in.
 *
 * Splitting rather than adding is the honest thing, and it is what the app does: a column of two
 * currencies has no single total until someone says what to convert at, so the example reports both
 * subtotals and says so. Getting this "wrong" in a friendlier way here would teach the opposite of what
 * a table then does.
 */
function totalByCurrency(
	cards: readonly ExampleCard[],
	def: PropertyDef
): { unit: string; total: number }[] {
	const totals = new Map<string, number>()
	for (const card of cards) {
		const value = card.values[def.id]
		if (typeof value !== 'number') continue
		const unit = card.units?.[def.id] ?? def.unit ?? ''
		totals.set(unit, (totals.get(unit) ?? 0) + value)
	}
	return [...totals].map(([unit, total]) => ({ unit, total }))
}

function plural(n: number, one: string, many = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`
}

// ---------------------------------------------------------------------------
// Domain one: money, a deadline, and a decision to make
// ---------------------------------------------------------------------------

const FLAT_PROPERTIES: PropertyDef[] = [
	{ id: 'rent', name: 'Rent', type: 'financial', unit: 'GEL' },
	{ id: 'size', name: 'Size', type: 'number', unit: 'm²' },
	{
		id: 'verdict',
		name: 'Verdict',
		type: 'status',
		options: ['Shortlisted', 'Viewing booked', 'Ruled out'],
		// Which stage each option sits in is what lets the board answer "how many are still open" without
		// being told which of *these* words means finished.
		stages: { Shortlisted: 'todo', 'Viewing booked': 'active', 'Ruled out': 'done' },
	},
	{ id: 'gut', name: 'Gut feel', type: 'rating' },
	{ id: 'listing', name: 'Listing', type: 'link' },
]

const FLAT_CARDS: ExampleCard[] = [
	{
		id: 'vera',
		name: 'Vera, 2 rooms',
		kind: 'sticky',
		values: {
			rent: 1450,
			size: 62,
			verdict: 'Viewing booked',
			gut: 4,
			listing: '[On myhome.ge](https://example.com/vera)',
		},
	},
	{
		id: 'loft',
		name: 'Saburtalo loft',
		kind: 'note',
		values: { rent: 1900, size: 78, verdict: 'Shortlisted', gut: 5 },
	},
	{
		// A photo of the place, carrying the same five properties as the note above it.
		id: 'oldtown',
		name: 'Old town, top floor',
		kind: 'image',
		values: { rent: 700, size: 45, verdict: 'Ruled out', gut: 2 },
		units: { rent: 'USD' },
	},
]

const FLAT_QUESTIONS: ExampleQuestion[] = [
	{
		id: 'rent',
		label: 'What would they cost?',
		expression: '{sum rent page}',
		run: (cards) => {
			const totals = totalByCurrency(cards, FLAT_PROPERTIES[0]!)
			return {
				value: totals.map(({ unit, total }) => formatCurrency(total, unit)).join('  +  '),
				note:
					totals.length > 1
						? 'Two currencies, so two subtotals — currency lives on the card, not on the column. A table converts once you give it a rate.'
						: `Summed across ${plural(cards.length, 'card')}.`,
			}
		},
	},
	{
		id: 'open',
		label: 'How many are still live?',
		run: (cards) => {
			const def = FLAT_PROPERTIES[2]!
			const open = cards.filter((card) => {
				const value = card.values.verdict
				return typeof value === 'string' && stageForOption(def, value) !== 'done'
			})
			return {
				value: plural(open.length, 'flat'),
				note: 'Counted by the stage behind each option, so renaming "Ruled out" changes nothing.',
			}
		},
	},
	{
		id: 'gut',
		label: 'Do I even like them?',
		expression: '{avg gut feel page}',
		run: (cards) => {
			const avg = average(numbersOf(cards, 'gut'))
			return {
				value: avg === null ? '—' : `${formatNumber(avg)} of 5`,
				note: 'Stars are numbers underneath, so they average like any other number.',
			}
		},
	},
	{
		id: 'size',
		label: 'How big is the biggest?',
		expression: '{max size page}',
		run: (cards) => {
			const sizes = numbersOf(cards, 'size')
			return {
				value: sizes.length ? `${formatNumber(Math.max(...sizes))} m²` : '—',
				note: 'A number keeps its unit through a summary — m² in, m² out.',
			}
		},
	},
]

// ---------------------------------------------------------------------------
// Domain two: same system, no money anywhere in it
// ---------------------------------------------------------------------------

const SOWING_PROPERTIES: PropertyDef[] = [
	{ id: 'sow', name: 'Sow by', type: 'date' },
	{ id: 'bed', name: 'Bed', type: 'select', options: ['Bed A', 'Bed B', 'Greenhouse'] },
	{
		id: 'family',
		name: 'Family',
		type: 'multiSelect',
		options: ['Legume', 'Brassica', 'Root', 'Allium'],
	},
	{ id: 'up', name: 'Germinated', type: 'progress' },
	{ id: 'spacing', name: 'Spacing', type: 'number', unit: 'cm' },
]

const SOWING_CARDS: ExampleCard[] = [
	{
		id: 'beans',
		name: 'Broad beans',
		kind: 'sticky',
		values: { sow: '2026-03-02', bed: 'Bed A', family: ['Legume'], up: 80, spacing: 20 },
	},
	{
		id: 'broccoli',
		name: 'Sprouting broccoli',
		kind: 'note',
		values: { sow: '2026-04-15', bed: 'Bed B', family: ['Brassica'], up: 35, spacing: 45 },
	},
	{
		id: 'beetroot',
		name: 'Beetroot “Boltardy”',
		kind: 'note',
		values: { sow: '2026-03-20', bed: 'Bed A', family: ['Root'], up: 55, spacing: 10 },
	},
	{
		id: 'garlic',
		name: 'Garlic “Solent Wight”',
		kind: 'image',
		values: { sow: '2026-10-01', bed: 'Greenhouse', family: ['Allium'], up: 0, spacing: 12 },
	},
]

/** The cut-off the "before April" question filters on — a `date` filter is a string comparison. */
const APRIL = '2026-04-01'

const SOWING_QUESTIONS: ExampleQuestion[] = [
	{
		id: 'soon',
		label: 'What must go in before April?',
		run: (cards) => {
			const due = cards.filter((card) => {
				const value = card.values.sow
				return typeof value === 'string' && value < APRIL
			})
			return {
				value: `${due.length} of ${cards.length}`,
				note: `A date filter — "Sow by is before ${APRIL}". The same filter drives a table's rows.`,
			}
		},
	},
	{
		id: 'up',
		label: 'How much has come up?',
		expression: '{avg germinated page}',
		run: (cards) => {
			const avg = average(numbersOf(cards, 'up'))
			return {
				value: avg === null ? '—' : `${Math.round(avg)}%`,
				note: 'Progress is a 0–100 number, which is why it can be averaged and drawn as a bar.',
			}
		},
	},
	{
		id: 'earliest',
		label: 'What goes in first?',
		run: (cards) => {
			const dates = stringsOf(cards, 'sow').sort()
			const first = dates[0]
			return {
				value: first ? formatPropertyValue(SOWING_PROPERTIES[0]!, first) : '—',
				note: 'Earliest and latest are date summaries — the same menu a money column fills with sum and average.',
			}
		},
	},
	{
		id: 'beds',
		label: 'How many beds am I using?',
		run: (cards) => {
			const beds = new Set(stringsOf(cards, 'bed'))
			return {
				value: plural(beds.size, 'bed'),
				note: 'Unique values, over a select. Group a table by the same property and you get those three buckets.',
			}
		},
	},
]

export const EXAMPLE_DOMAINS: ExampleDomain[] = [
	{
		id: 'flat',
		label: 'Finding a flat',
		blurb:
			'Three places, three prices, one decision. Money, a status you move through, and a gut feeling that is worth recording precisely because it is not a number anyone else would keep.',
		properties: FLAT_PROPERTIES,
		cards: FLAT_CARDS,
		questions: FLAT_QUESTIONS,
	},
	{
		id: 'sowing',
		label: 'A sowing plan',
		blurb:
			'Not a penny anywhere. Dates that decide the order of the year, a bed each thing belongs to, and how much of it actually came up.',
		properties: SOWING_PROPERTIES,
		cards: SOWING_CARDS,
		questions: SOWING_QUESTIONS,
	},
]
