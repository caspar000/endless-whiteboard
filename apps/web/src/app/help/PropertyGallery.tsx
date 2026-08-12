import {
	PROPERTY_TYPES,
	filterOpsForType,
	summaryLabel,
	summaryOpsForType,
	type FilterOp,
	type PropertyDef,
	type PropertyType,
	type PropertyValue,
	type SummaryOp,
} from '@lifeboard/node-kit'
import { useState } from 'react'
import { StripValue } from './MockCard'

/**
 * The eleven property types, one at a time.
 *
 * Built by walking `PROPERTY_TYPES`, so a twelfth type appears here the day it is added rather than the
 * day someone remembers this file. The two lists at the bottom of the panel — which filters a type
 * offers, which summaries it offers — are likewise asked of `filterOpsForType` and `summaryOpsForType`
 * rather than written out: those two answers are the entire practical difference between picking `number`
 * and picking `text` for the same value, and they are exactly what a reader is here to find out.
 *
 * Only the prose and the sample values live here, because nothing in the app can supply those.
 */

interface TypeNote {
	/** What the type holds, in one line. */
	holds: string
	/** The example value, formatted by the real formatter in the panel. */
	def: PropertyDef
	value: PropertyValue
	/** Why you'd reach for this one — the part a type list never tells you. */
	note: string
}

const NOTES: Record<PropertyType, TypeNote> = {
	text: {
		holds: 'Any words at all.',
		def: { id: 'sample', name: 'Landlord', type: 'text' },
		value: 'Nino, calls after 6pm',
		note: 'The escape hatch, and the one type that never adds up: a text property holding "12" is deliberately not summed, because a total that depended on typos would be worse than no total.',
	},
	number: {
		holds: 'A number, with a unit you choose.',
		def: { id: 'sample', name: 'Size', type: 'number', unit: 'm²' },
		value: 62,
		note: 'The unit is display only — it travels with the value through a summary, so metres in means metres out, and nothing tries to convert between two of them.',
	},
	financial: {
		holds: 'An amount and a currency.',
		def: { id: 'sample', name: 'Rent', type: 'financial', unit: 'GEL' },
		value: 1450,
		note: 'The currency belongs to the card, not to the column: two cards can hold the same Rent property in ₾ and $. Totals then either group by currency or convert at a rate you set, and never silently mix.',
	},
	date: {
		holds: 'A day.',
		def: { id: 'sample', name: 'Sow by', type: 'date' },
		value: '2026-03-02',
		note: 'Compared as a day rather than a moment, so before/after mean what you expect. Dates summarise to earliest, latest and the span between them.',
	},
	checkbox: {
		holds: 'Yes or no.',
		def: { id: 'sample', name: 'Deposit paid', type: 'checkbox' },
		value: true,
		note: 'The one type with no empty state — unticked *is* the answer — which is why it offers `is` and nothing else.',
	},
	link: {
		holds: 'A title and the address behind it.',
		def: { id: 'sample', name: 'Listing', type: 'link' },
		value: '[On myhome.ge](https://example.com)',
		note: 'You read the title, the card links to the address, and grouping buckets by address — so two rows pointing at the same page land together whatever each is called.',
	},
	select: {
		holds: 'One of a list you build as you go.',
		def: { id: 'sample', name: 'Bed', type: 'select', options: ['Bed A', 'Bed B', 'Greenhouse'] },
		value: 'Bed A',
		note: 'Each option takes a colour from its own text, so "Bed A" is the same colour on every board and in every table, with nothing to configure and nothing to keep in sync.',
	},
	status: {
		holds: 'One option, sitting in one of three stages.',
		def: {
			id: 'sample',
			name: 'Verdict',
			type: 'status',
			options: ['Shortlisted', 'Viewing booked', 'Ruled out'],
			stages: { Shortlisted: 'todo', 'Viewing booked': 'active', 'Ruled out': 'done' },
		},
		value: 'Viewing booked',
		note: 'The difference from a select is the stage behind the word: To-do, In progress, Done. That is what lets the board answer "how much of this is finished" without being told which of your words means finished — and why a status is grey, blue or green rather than a colour from its label.',
	},
	multiSelect: {
		holds: 'Several options at once.',
		def: {
			id: 'sample',
			name: 'Family',
			type: 'multiSelect',
			options: ['Legume', 'Brassica', 'Root'],
		},
		value: ['Legume', 'Root'],
		note: 'This is what tags are here — not a separate concept, just a property that holds a list. Group a table by one and a shape appears in every bucket it is tagged with.',
	},
	rating: {
		holds: 'One to five stars.',
		def: { id: 'sample', name: 'Gut feel', type: 'rating' },
		value: 4,
		note: 'Numeric underneath, so it averages and sorts like any other number — which is the point of recording a feeling as a property instead of as a sentence. Five stars always, so two boards’ ratings stay comparable.',
	},
	progress: {
		holds: 'Nought to a hundred.',
		def: { id: 'sample', name: 'Germinated', type: 'progress' },
		value: 55,
		note: 'The one type that still reads from across a zoomed-out board, because a part-filled bar has a shape and a number does not. Also just a number, so it averages.',
	},
}

/** Human names for the filter operators, which are identifiers everywhere else. */
const FILTER_LABELS: Record<FilterOp, string> = {
	isNotEmpty: 'is not empty',
	isEmpty: 'is empty',
	is: 'is',
	isNot: 'is not',
	contains: 'contains',
	doesNotContain: 'does not contain',
	gt: 'more than',
	gte: 'at least',
	lt: 'less than',
	lte: 'at most',
	before: 'before',
	after: 'after',
}

/** `summaryLabel` is written for a menu ("the total"); a list wants the bare noun. */
function summaryWord(op: SummaryOp): string {
	return summaryLabel(op).replace(/^the /, '')
}

export function PropertyGallery() {
	const [type, setType] = useState<PropertyType>('financial')
	const note = NOTES[type]

	return (
		<div className="lb-gallery">
			<div className="lb-gallery__chips" role="group" aria-label="Property types">
				{PROPERTY_TYPES.map((t) => (
					<button
						key={t}
						className={t === type ? 'lb-gallery__chip lb-gallery__chip--on' : 'lb-gallery__chip'}
						aria-pressed={t === type}
						onClick={() => setType(t)}
					>
						{t}
					</button>
				))}
			</div>

			<div className="lb-gallery__body">
				<div className="lb-gallery__lead">
					<h3>{note.holds}</h3>
					<p>{note.note}</p>
				</div>

				<div className="lb-gallery__sample">
					<div className="lb-gallery__samplehead">On the card</div>
					{/* The same two elements a real strip draws, so this is the actual rendering. */}
					<dl className="lb-strip">
						<div className="lb-strip__row">
							<dt className="lb-strip__name">{note.def.name}</dt>
							<dd className="lb-strip__value">
								<StripValue def={note.def} value={note.value} unit={note.def.unit} />
							</dd>
						</div>
					</dl>
				</div>

				<dl className="lb-gallery__answers">
					<div>
						<dt>Filters by</dt>
						<dd>{filterOpsForType(type).map((op) => FILTER_LABELS[op]).join(' · ')}</dd>
					</div>
					<div>
						<dt>Summarises to</dt>
						<dd>{summaryOpsForType(type).map(summaryWord).join(' · ')}</dd>
					</div>
				</dl>
			</div>
		</div>
	)
}
