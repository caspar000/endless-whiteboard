import {
	choiceStyle,
	formatCurrency,
	formatNumber,
	summaryLabel,
	type PropertyDef,
	type SummaryOp,
} from '@lifeboard/node-kit'
import { useState } from 'react'
import { EXAMPLE_DOMAINS, type ExampleCard } from '../exampleDomains'
import { Jump, Section, useDemo, type SectionProps } from '../kit'

/* --------------------------------------------------------- a table is a live view */

const TABLE_STEPS = [1500, 800, 1700, 2600] as const

function TableDemo() {
	const { step, ref } = useDemo(TABLE_STEPS)
	const added = step >= 1
	const counted = step >= 2

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="A new priced card appearing on the board, and the table picking it up by itself"
		>
			<div className="lb-demo__scene">
				<div className="lb-demo__minis">
					<div className="lb-demo__mini">
						Desk <span className="lb-demo__minivalue">₾450</span>
					</div>
					<div className="lb-demo__mini">
						Chair <span className="lb-demo__minivalue">₾640</span>
					</div>
					<div
						className={
							added ? 'lb-demo__mini lb-demo__pop lb-demo__pop--in' : 'lb-demo__mini lb-demo__pop'
						}
					>
						Lamp <span className="lb-demo__minivalue">₾85</span>
					</div>
				</div>
				<div className="lb-demo__table">
					<div className="lb-demo__tablehead">Everything priced</div>
					<div className="lb-demo__tablerow">
						<span>Desk</span>
						<span>450</span>
					</div>
					<div className="lb-demo__tablerow">
						<span>Chair</span>
						<span>640</span>
					</div>
					<div
						className={
							counted
								? 'lb-demo__tablerow lb-demo__pop lb-demo__pop--in'
								: 'lb-demo__tablerow lb-demo__pop'
						}
					>
						<span>Lamp</span>
						<span>85</span>
					</div>
					<div className={counted ? 'lb-demo__tablesum lb-demo__bump' : 'lb-demo__tablesum'}>
						<span>Sum</span>
						<span>{counted ? '₾1,175' : '₾1,090'}</span>
					</div>
				</div>
			</div>
			<div className="lb-demo__hint">
				{counted
					? 'no refresh, no import — the table watches the board'
					: 'a table is a saved question, not copied data'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------------ the builder */

const FLAT = EXAMPLE_DOMAINS.find((d) => d.id === 'flat')!
const RENT: PropertyDef = FLAT.properties.find((p) => p.id === 'rent')!
const VERDICT: PropertyDef = FLAT.properties.find((p) => p.id === 'verdict')!

type GroupBy = 'none' | 'verdict' | 'currency'

const GROUPS: { id: GroupBy; label: string }[] = [
	{ id: 'none', label: 'No grouping' },
	{ id: 'verdict', label: 'Group by Verdict' },
	{ id: 'currency', label: 'Group by Rent’s currency' },
]

const SUMMARIES: SummaryOp[] = ['sum', 'avg', 'max', 'count']

function unitOf(card: ExampleCard): string {
	return card.units?.[RENT.id] ?? RENT.unit ?? ''
}

function rentOf(card: ExampleCard): number | null {
	const value = card.values[RENT.id]
	return typeof value === 'number' ? value : null
}

function groupKey(card: ExampleCard, groupBy: GroupBy): string {
	if (groupBy === 'verdict') return String(card.values[VERDICT.id] ?? '—')
	if (groupBy === 'currency') return unitOf(card)
	return ''
}

/**
 * One group's summary of the Rent column.
 *
 * The money rule is the interesting part and it is the app's own: a total across two currencies has no
 * single answer, so it says **(mixed)** rather than adding numbers that mean different things. Grouping
 * by currency is one way out of that with no exchange rate involved at all — which is why it is one of
 * the three options above.
 */
function summariseRent(cards: ExampleCard[], op: SummaryOp): string {
	if (op === 'count') return formatNumber(cards.length)
	const amounts = cards.flatMap((card) => {
		const rent = rentOf(card)
		return rent === null ? [] : [{ rent, unit: unitOf(card) }]
	})
	if (!amounts.length) return '—'
	const units = new Set(amounts.map((a) => a.unit))
	if (units.size > 1) return '(mixed)'
	const unit = [...units][0]!
	const values = amounts.map((a) => a.rent)
	const value =
		op === 'sum'
			? values.reduce((a, b) => a + b, 0)
			: op === 'avg'
				? values.reduce((a, b) => a + b, 0) / values.length
				: Math.max(...values)
	return formatCurrency(value, unit)
}

/** The table node, configurable. Same three questions its own config panel asks first. */
function TableBuilder() {
	const [groupBy, setGroupBy] = useState<GroupBy>('none')
	const [op, setOp] = useState<SummaryOp>('sum')
	const [big, setBig] = useState(false)

	// Buckets in first-seen order, which is what the real grouping does with no sort applied.
	const buckets = new Map<string, ExampleCard[]>()
	for (const card of FLAT.cards) {
		const key = groupKey(card, groupBy)
		const bucket = buckets.get(key)
		if (bucket) bucket.push(card)
		else buckets.set(key, [card])
	}

	return (
		<div className="lb-tb">
			<div className="lb-tb__controls">
				<select value={groupBy} onChange={(e) => setGroupBy(e.currentTarget.value as GroupBy)}>
					{GROUPS.map((g) => (
						<option key={g.id} value={g.id}>
							{g.label}
						</option>
					))}
				</select>
				<select value={op} onChange={(e) => setOp(e.currentTarget.value as SummaryOp)}>
					{SUMMARIES.map((o) => (
						<option key={o} value={o}>
							Rent: {summaryLabel(o)}
						</option>
					))}
				</select>
				<label className="lb-tb__toggle">
					<input type="checkbox" checked={big} onChange={(e) => setBig(e.currentTarget.checked)} />
					One big number
				</label>
			</div>

			{big ? (
				<div className="lb-tb__value">
					<div className="lb-tb__valuenum">{summariseRent(FLAT.cards, op)}</div>
					<div className="lb-tb__valuelabel">Rent — {summaryLabel(op)}</div>
				</div>
			) : (
				<div className="lb-tb__table">
					<div className="lb-tb__head">
						<span>Name</span>
						<span>Verdict</span>
						<span className="lb-tb__num">Rent</span>
					</div>
					{[...buckets].map(([key, cards]) => (
						<div className="lb-tb__group" key={key || 'all'}>
							{key && <div className="lb-tb__grouphead">{key}</div>}
							{cards.map((card) => {
								const verdict = String(card.values[VERDICT.id] ?? '')
								const rent = rentOf(card)
								return (
									<div className="lb-tb__row" key={card.id}>
										<span>{card.name}</span>
										<span>
											{verdict && (
												<span className="lb-chip" style={choiceStyle(VERDICT, verdict)}>
													{verdict}
												</span>
											)}
										</span>
										<span className="lb-tb__num">
											{rent === null ? '—' : formatCurrency(rent, unitOf(card))}
										</span>
									</div>
								)
							})}
							<div className="lb-tb__sum">
								<span>{summaryLabel(op)}</span>
								<span className="lb-tb__num">{summariseRent(cards, op)}</span>
							</div>
						</div>
					))}
					{buckets.size > 1 && (
						<div className="lb-tb__total">
							<span>All {FLAT.cards.length}</span>
							<span className="lb-tb__num">{summariseRent(FLAT.cards, op)}</span>
						</div>
					)}
				</div>
			)}

			<div className="lb-demo__hint">
				{groupBy === 'currency'
					? 'grouped by currency, every subtotal is honest and no exchange rate was needed'
					: summariseRent(FLAT.cards, op) === '(mixed)'
						? 'two currencies in one column — the table refuses to add them rather than guessing'
						: 'the rows are the board; nothing here was typed twice'}
			</div>
		</div>
	)
}

/* ---------------------------------------------------------------------- the page */

export function Tables({ go }: SectionProps) {
	return (
		<>
			<Section title="A table holds no rows">
				<p>
					It holds a <strong>question</strong>, and shows whatever currently answers it. Nothing is
					imported, nothing is copied, and there is nothing to refresh: add a priced sticky anywhere on
					the board and the row appears.
				</p>
				<TableDemo />
				<p>
					Drop one from the dock (<kbd className="lb-kbd">6</kbd>) and double-click it to change the
					question it asks.
				</p>
			</Section>

			<Section title="The question, in four parts">
				<div className="lb-help__facts">
					<div className="lb-help__fact">
						<h3>What's in scope</h3>
						<p>
							Everything on the board, everything parented to one frame, or whatever the arrows reach
							— optionally only the arrows carrying a given label. Plus a shape-type filter, which is
							now the exception rather than the rule.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>Which of those count</h3>
						<p>
							Filters, ANDed, and offered per type: <em>more than</em> for a number,{' '}
							<em>before</em> for a date, <em>contains</em> for a list. A money threshold states its
							own currency, so <em>rent &gt; 1,000</em> means one thing on every row.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>What to show</h3>
						<p>
							Columns are the shape's name, any property, or a property read off the{' '}
							<Jump to="relations" go={go}>
								arrow
							</Jump>{' '}
							that connects it — which is where "200 g of this ingredient" belongs. Widths are
							relative, so they survive resizing.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>What to work out</h3>
						<p>
							A summary per column, from a list that depends on the column's type, plus grouping and
							sorting. Or collapse the whole table to the single number the summary produced.
						</p>
					</div>
				</div>
			</Section>

			<Section title="Try the last two">
				<p>
					Three flats, one of them priced in dollars. Change how the rows are grouped and what the Rent
					column works out, and watch what the table will and will not claim:
				</p>
				<TableBuilder />
				<p className="lb-help__aside">
					Rates for a real conversion are per table, not per board: one board can hold a trip budgeted
					at the rate you actually got and a shopping list at today's. Fetched rates are a cache and
					stay out of the document; a rate you typed is part of the board and travels with a backup.
				</p>
			</Section>

			<Section title="Why it stops at twelve rows">
				<p>
					A table on a whiteboard should <em>show</em> its rows — a scrollbar in a shape you are not
					editing would swallow the drag that moves it. So the rows are capped, the card says how many
					more there are, and the shape sizes itself to what fits. Tighten the filter, or group, if you
					are hitting the cap often.
				</p>
			</Section>
		</>
	)
}
