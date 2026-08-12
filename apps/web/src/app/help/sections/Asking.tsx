import {
	formatCurrency,
	formatNumber,
	summaryIsCount,
	summaryIsPercent,
	summaryKeepsUnit,
	summaryLabel,
	summaryOpsForType,
	type PropertyType,
	type SummaryOp,
} from '@lifeboard/node-kit'
import { useState } from 'react'
import { Section, useDemo } from '../kit'

/* ------------------------------------------------------- typing an expression */

const EXPR_STEPS = [1300, 1100, 1100, 1000, 2800] as const

const EXPR_TEXT = [
	'Office total: ',
	'Office total: {',
	'Office total: {sum ',
	'Office total: {sum price}',
] as const

function ExpressionsDemo() {
	const { step, ref } = useDemo(EXPR_STEPS)
	const rendered = step >= 4
	const menu =
		step === 1
			? ([
					['sum', 'add them up'],
					['count', 'how many'],
					['avg', 'the average'],
				] as const)
			: step === 2
				? ([
						['price', 'financial'],
						['rating', 'rating'],
					] as const)
				: null

	return (
		<div
			className="lb-demo lb-demo--short"
			ref={ref}
			role="img"
			aria-label="Typing the expression sum price into a note, which renders as the live total"
		>
			<div className="lb-demo__scene">
				<div
					className={
						rendered
							? 'lb-demo__note lb-demo__note--wide'
							: 'lb-demo__note lb-demo__note--wide lb-demo__note--editing'
					}
				>
					{rendered ? (
						<div>
							Office total: <strong className="lb-demo__money">₾1,540</strong>
						</div>
					) : (
						<div className="lb-demo__source">
							{EXPR_TEXT[step] ?? EXPR_TEXT[0]}
							<span className="lb-demo__caret" />
						</div>
					)}
				</div>
				{menu && (
					<div className="lb-demo__suggest">
						{menu.map(([label, detail], i) => (
							<div
								key={label}
								className={i === 0 ? 'lb-demo__row lb-demo__row--on' : 'lb-demo__row'}
							>
								<span>{label}</span>
								<span className="lb-demo__rowdetail">{detail}</span>
							</div>
						))}
					</div>
				)}
			</div>
			<div className="lb-demo__hint">
				{rendered
					? 'you edit {sum price}, you read ₾1,540 — the source keeps the expression'
					: 'type { and the menu builds the expression with you'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------- the ask builder */

/**
 * A mock board for the builder below: five shapes, some reachable by arrow, some inside a frame.
 *
 * `undefined` where a shape does not carry a property, because half the summaries exist precisely to
 * talk about the gaps — "filled in", "percent empty" — and a dataset with no holes in it can't show them.
 */
const SHAPES: {
	name: string
	price?: number
	rating?: number
	where: 'in' | 'out' | 'none'
	frame: boolean
}[] = [
	{ name: 'Standing desk', price: 450, rating: 4, where: 'in', frame: true },
	{ name: 'Office chair', price: 640, rating: 5, where: 'in', frame: true },
	{ name: 'Desk lamp', price: 85, where: 'in', frame: false },
	{ name: 'Sold: old desk', price: 200, where: 'out', frame: false },
	{ name: 'Rug (elsewhere)', price: 300, rating: 3, where: 'none', frame: false },
]

/** The five sources the collection editor offers, in its own words. */
const SOURCES = [
	{ id: 'in', label: 'arrows pointing in', keyword: 'in' },
	{ id: 'out', label: 'arrows pointing out', keyword: 'out' },
	{ id: 'either', label: 'arrows either way (in − out)', keyword: 'either' },
	{ id: 'frame', label: 'shapes in this frame', keyword: 'frame' },
	{ id: 'page', label: 'everything on this board', keyword: 'page' },
] as const
type SourceId = (typeof SOURCES)[number]['id']

const PROPERTIES = [
	{ id: '', name: '— nothing, just the rows —', type: null },
	{ id: 'price', name: 'Price', type: 'financial' as PropertyType },
	{ id: 'rating', name: 'Rating', type: 'rating' as PropertyType },
] as const
type PropertyId = (typeof PROPERTIES)[number]['id']

/** Ops an inline expression can name. The panel's list is longer — see `EXPRESSION_OPS`. */
const EXPRESSION_OPS = new Set<SummaryOp>(['sum', 'count', 'avg', 'median', 'min', 'max'])

interface Row {
	label: string
	/** `undefined` = the shape carries the property but has no value, or carries nothing at all. */
	value: number | undefined
}

/** Which shapes are in scope, with outgoing values negated when the source is signed. */
function rowsFor(source: SourceId, property: PropertyId): Row[] {
	const inScope = SHAPES.filter((shape) => {
		if (source === 'frame') return shape.frame
		if (source === 'page') return true
		if (source === 'either') return shape.where !== 'none'
		return shape.where === source
	})

	return inScope.flatMap((shape): Row[] => {
		if (!property) return [{ label: shape.name, value: undefined }]
		const raw = property === 'price' ? shape.price : shape.rating
		// A row has to *carry* one of the columns' properties — a board is full of shapes that have
		// nothing to do with the question, and a row of "—" for each buries the ones that do.
		if (raw === undefined) return []
		// Signed: what this shape points at is money leaving, so it counts against the total.
		const signed = source === 'either' && shape.where === 'out'
		return [{ label: shape.name, value: signed ? -raw : raw }]
	})
}

/** Every summary the app defines, over the rows above. Nothing here is specific to the mock data. */
function summarise(op: SummaryOp, rows: Row[]): number | null {
	const values = rows.flatMap((row) => (row.value === undefined ? [] : [row.value]))
	const filled = values.length
	const total = rows.length
	switch (op) {
		case 'count':
			return total
		case 'countValues':
		case 'countNotEmpty':
			return filled
		case 'countUnique':
			return new Set(values).size
		case 'countEmpty':
			return total - filled
		case 'percentEmpty':
			return total ? ((total - filled) / total) * 100 : null
		case 'percentNotEmpty':
			return total ? (filled / total) * 100 : null
		case 'sum':
			return filled ? values.reduce((a, b) => a + b, 0) : null
		case 'avg':
			return filled ? values.reduce((a, b) => a + b, 0) / filled : null
		case 'median': {
			if (!filled) return null
			const sorted = [...values].sort((a, b) => a - b)
			const mid = Math.floor(filled / 2)
			return filled % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
		}
		case 'min':
			return filled ? Math.min(...values) : null
		case 'max':
			return filled ? Math.max(...values) : null
		case 'range':
			return filled ? Math.max(...values) - Math.min(...values) : null
		// Date-only summaries, unreachable for the two numeric properties this builder offers.
		case 'earliest':
		case 'latest':
			return null
	}
}

function formatSummary(op: SummaryOp, property: PropertyId, value: number | null): string {
	if (value === null) return '—'
	if (summaryIsPercent(op)) return `${Math.round(value)}%`
	if (summaryIsCount(op)) return formatNumber(value)
	if (property === 'price' && summaryKeepsUnit(op, 'financial')) return formatCurrency(value, 'GEL')
	return formatNumber(value)
}

/**
 * The collection editor, live.
 *
 * Same three questions in the same order as the real panel — from, of, show — because that order is
 * load-bearing: which summaries exist depends on the property's type, so choosing the summary first
 * would leave "the total" unreachable. The number below is computed over `SHAPES`, and the line under it
 * is the same question written as an inline expression, so the two surfaces are visibly one feature.
 */
function AskBuilder() {
	const [source, setSource] = useState<SourceId>('in')
	const [property, setProperty] = useState<PropertyId>('price')
	const [show, setShow] = useState<'list' | SummaryOp>('sum')

	const type = PROPERTIES.find((p) => p.id === property)?.type ?? null
	const ops = summaryOpsForType(type)
	// Changing the property can retire the chosen summary — a total of nothing is not on offer.
	const op: SummaryOp = show !== 'list' && ops.includes(show) ? show : ops[0]!
	const rows = rowsFor(source, property)
	const keyword = SOURCES.find((s) => s.id === source)!.keyword

	const expression =
		show !== 'list' && EXPRESSION_OPS.has(op)
			? `{${op}${property ? ` ${property}` : ''}${source === 'in' ? '' : ` ${keyword}`}}`
			: null

	return (
		<div className="lb-ask">
			<div className="lb-ask__form">
				<label className="lb-ask__row">
					<span>From</span>
					<select value={source} onChange={(e) => setSource(e.currentTarget.value as SourceId)}>
						{SOURCES.map((s) => (
							<option key={s.id} value={s.id}>
								{s.label}
							</option>
						))}
					</select>
				</label>
				<label className="lb-ask__row">
					<span>Of</span>
					<select
						value={property}
						onChange={(e) => setProperty(e.currentTarget.value as PropertyId)}
					>
						{PROPERTIES.map((p) => (
							<option key={p.id} value={p.id}>
								{p.name}
							</option>
						))}
					</select>
				</label>
				<label className="lb-ask__row">
					<span>Show</span>
					<select
						value={show === 'list' ? 'list' : op}
						onChange={(e) => {
							const next = e.currentTarget.value
							setShow(next === 'list' ? 'list' : (next as SummaryOp))
						}}
					>
						<option value="list">the list</option>
						{ops.map((o) => (
							<option key={o} value={o}>
								{summaryLabel(o)}
							</option>
						))}
					</select>
				</label>
			</div>

			{/* What the shape carrying this collection would show. */}
			<div className="lb-ask__out">
				<div className="lb-ask__outhead">On the shape</div>
				{show === 'list' ? (
					rows.length ? (
						<dl className="lb-ask__list">
							{rows.map((row) => (
								<div className="lb-ask__line" key={row.label}>
									<dt>{row.label}</dt>
									<dd>
										{row.value === undefined
											? '—'
											: formatSummary('sum', property, row.value)}
									</dd>
								</div>
							))}
						</dl>
					) : (
						<div className="lb-ask__empty">Nothing yet</div>
					)
				) : (
					<>
						<div className="lb-ask__value">{formatSummary(op, property, summarise(op, rows))}</div>
						<div className="lb-ask__count">
							{rows.length} {rows.length === 1 ? 'shape' : 'shapes'} matched
						</div>
					</>
				)}
			</div>

			<div className="lb-ask__expr">
				{expression ? (
					<>
						The same question, typed into any text: <code>{expression}</code>
						{source === 'in' && (
							<span className="lb-ask__exprnote">
								{' '}
								— arrows pointing in are the default, so the keyword can be left off.
							</span>
						)}
					</>
				) : (
					<span className="lb-ask__exprnote">
						No inline form for this one: expressions name six summaries and always produce a number,
						so a list — or a percentage — stays in the panel.
					</span>
				)}
			</div>
		</div>
	)
}

/* ---------------------------------------------------------------------- the page */

export function Asking() {
	return (
		<>
			<Section title="A number belongs in the sentence that explains it">
				<p>
					Inside any text on the board — a note, a sticky, a shape's label, even an arrow's label —
					type <code>{'{'}</code> and a menu builds an expression with you. What you keep is the
					expression; what you read is the answer.
				</p>
				<ExpressionsDemo />
				<p>
					<code>{'{sum price}'}</code> totals the shapes pointing at this one.{' '}
					<code>{'{count}'}</code> counts them. <code>{'{avg rating page}'}</code> averages the whole
					board. <code>{'{price}'}</code> with no summary is this shape's own value, formatted by its
					type — which is how a note can say "asking ₾ 1,450.00" without you retyping the number you
					already entered in the panel.
				</p>
				<p className="lb-help__aside">
					Anything it does not recognise is left exactly as you typed it, and fenced or inline code is
					exempt. Braces are ordinary punctuation in prose and everywhere in code; a feature that
					swallowed them would damage notes written before it existed.
				</p>
			</Section>

			<Section title="Or hang the number on any shape at all">
				<p>
					The properties panel has a second half: not what this shape <em>is</em>, but what it{' '}
					<strong>gathers</strong>. Tick <em>Collects</em> and a sticky, a frame, a photo or a heading
					starts reporting a number about the board — a count of what points at it, the total of what
					sits inside it, or the list of rows themselves.
				</p>
				<p>
					It asks the same three questions an expression answers positionally, and — being the same
					engine underneath — gives the same answer. Try it:
				</p>
				<AskBuilder />
				<p className="lb-help__aside">
					A fresh collection counts the arrows pointing in, which is deliberately the most boring
					default available: it says nothing until you draw an arrow, and then says something obviously
					right. A sum of nothing, by contrast, is a zero that looks like an answer.
				</p>
			</Section>
		</>
	)
}
