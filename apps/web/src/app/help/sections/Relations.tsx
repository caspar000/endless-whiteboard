import { EDGE_DIRECTION_LABELS, formatCurrency, type EdgeDirection } from '@lifeboard/node-kit'
import { useState } from 'react'
import { Cursor, Jump, Section, useDemo, type SectionProps } from '../kit'

/* --------------------------------------------------- an arrow becoming a relation */

const ARROW_STEPS = [1200, 700, 900, 1500, 2400] as const

function ArrowsDemo() {
	const { step, ref } = useDemo(ARROW_STEPS)
	const drawn = step >= 2
	const bound = step >= 3

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="Drawing an arrow from a priced sticky into a collector, which adds it to the total"
		>
			<div className="lb-demo__scene">
				<div className="lb-demo__stickywrap lb-demo__stickywrap--left">
					<div className="lb-demo__sticky">Desk</div>
					<div className="lb-demo__strip lb-demo__pop--in">
						<span className="lb-demo__stripname">Price</span>
						<span className="lb-demo__stripvalue">₾450</span>
					</div>
				</div>
				<svg
					className="lb-demo__wire"
					viewBox="0 0 640 240"
					preserveAspectRatio="none"
					aria-hidden="true"
				>
					<path
						className={
							bound
								? 'lb-demo__wirepath lb-demo__wirepath--bound'
								: drawn
									? 'lb-demo__wirepath lb-demo__wirepath--drawn'
									: 'lb-demo__wirepath'
						}
						d="M 218 104 C 290 66, 350 66, 416 98"
						pathLength={1}
					/>
					<path
						className={bound ? 'lb-demo__wirehead lb-demo__wirehead--on' : 'lb-demo__wirehead'}
						d="M 416 98 l -14 -8 m 14 8 l -16 4"
					/>
					<circle
						className={bound ? 'lb-demo__bindring lb-demo__bindring--on' : 'lb-demo__bindring'}
						cx="419"
						cy="99"
						r="9"
					/>
				</svg>
				<div className="lb-demo__collector">
					<div className="lb-demo__collectortitle">Spending</div>
					<div className={bound ? 'lb-demo__collect lb-demo__bump' : 'lb-demo__collect'}>
						<span className="lb-demo__collectvalue">{bound ? '₾1,540' : '₾1,090'}</span>
						<span className="lb-demo__collectcount">{bound ? '3 items' : '2 items'}</span>
					</div>
				</div>
				<Cursor x={drawn ? 408 : step >= 1 ? 214 : 320} y={drawn ? 92 : step >= 1 ? 98 : 200} />
			</div>
			<div className="lb-demo__hint">
				{bound
					? 'both ends bound — the arrow is a relation, and the total already knows'
					: 'an arrow across empty space is just a drawing'}
			</div>
		</div>
	)
}

/* ------------------------------------------------------------- which way it points */

/** One side of the little money graph below. Amounts in one currency, so the sums stay the point. */
const FEEDS = [
	{ name: 'Salary', amount: 3200 },
	{ name: 'Refund', amount: 140 },
]
const DRAINS = [
	{ name: 'Rent', amount: 1450 },
	{ name: 'Groceries', amount: 310 },
]

const IN_TOTAL = FEEDS.reduce((sum, f) => sum + f.amount, 0)
const OUT_TOTAL = DRAINS.reduce((sum, d) => sum + d.amount, 0)

const DIRECTION_NOTES: Record<EdgeDirection, string> = {
	in: 'The default, because "what feeds this?" is the question people actually draw. Only arrows landing on the shape count.',
	out: 'The same graph read backwards — what this shape points at. Useful when the hub is the source rather than the destination.',
	either:
		'Both, with the arrow read as a sign: what points in adds, what it points at subtracts. This is what makes a running balance a thing you can draw rather than a column of negative numbers you have to remember to type.',
}

function directionTotal(direction: EdgeDirection): number {
	if (direction === 'in') return IN_TOTAL
	if (direction === 'out') return OUT_TOTAL
	return IN_TOTAL - OUT_TOTAL
}

/**
 * The three directions, over one graph.
 *
 * Interactive rather than three static pictures because the number is the whole lesson: the shapes never
 * move and the arrows never change, and the answer still triples. Each total is computed from the two
 * lists above and formatted by the app's own money formatter.
 */
function DirectionDemo() {
	const [direction, setDirection] = useState<EdgeDirection>('in')
	const counts = (side: 'in' | 'out') =>
		direction === 'either' || direction === side ? '' : ' lb-rel__side--off'

	return (
		<div className="lb-rel">
			<div className="lb-rel__pick" role="group" aria-label="Which arrows count">
				{(['in', 'out', 'either'] as const).map((d) => (
					<button
						key={d}
						className={d === direction ? 'lb-rel__btn lb-rel__btn--on' : 'lb-rel__btn'}
						aria-pressed={d === direction}
						onClick={() => setDirection(d)}
					>
						{EDGE_DIRECTION_LABELS[d]}
					</button>
				))}
			</div>

			<div className="lb-rel__graph">
				<div className={`lb-rel__side${counts('in')}`}>
					{FEEDS.map((f) => (
						<div className="lb-rel__node" key={f.name}>
							<span>{f.name}</span>
							<span className="lb-rel__amount">{formatCurrency(f.amount, 'GEL')}</span>
						</div>
					))}
				</div>
				<div className={`lb-rel__arrows${counts('in')}`} aria-hidden="true">
					→<br />→
				</div>

				<div className="lb-rel__hub">
					<div className="lb-rel__hubtitle">This month</div>
					<div className="lb-rel__hubvalue">{formatCurrency(directionTotal(direction), 'GEL')}</div>
					<div className="lb-rel__hubop">
						{direction === 'either' ? 'sum, signed' : 'sum'}
					</div>
				</div>

				<div className={`lb-rel__arrows${counts('out')}`} aria-hidden="true">
					→<br />→
				</div>
				<div className={`lb-rel__side${counts('out')}`}>
					{DRAINS.map((d) => (
						<div className="lb-rel__node" key={d.name}>
							<span>{d.name}</span>
							<span className="lb-rel__amount">{formatCurrency(d.amount, 'GEL')}</span>
						</div>
					))}
				</div>
			</div>

			<div className="lb-demo__hint">{DIRECTION_NOTES[direction]}</div>
		</div>
	)
}

/* ---------------------------------------------------------------------- the page */

export function Relations({ go }: SectionProps) {
	return (
		<>
			<Section title="There is no linking mode">
				<p>
					Sketch an arrow across empty space and it stays a drawing. Snap <strong>both ends</strong> to
					shapes and the same arrow becomes a relation the board can follow — because that is already
					what an arrow between two things looks like it means. Nothing to switch on, and a loose end is
					never mistaken for a claim.
				</p>
				<ArrowsDemo />
			</Section>

			<Section title="Which arrows count">
				<p>
					Anything that gathers — a table, a collection on any shape, an inline expression — reads the
					arrows around it, and says which ones it wants. Three answers, one graph:
				</p>
				<DirectionDemo />
			</Section>

			<Section title="One board, several kinds of relation">
				<p>
					An arrow can be labelled, and a query can follow only the arrows carrying a given label. That
					is what keeps two relations from becoming one mush on a busy board: <em>pays for</em> and{' '}
					<em>blocks</em> can cross the same page, and a total that follows one will ignore the other.
				</p>
				<p>
					An arrow is also just a shape, which means <strong>it carries properties too</strong>. That is
					where a fact belonging to the pairing goes rather than to either end: <em>this recipe uses
					200 g of that ingredient</em> is true of neither the recipe nor the ingredient on its own. A
					table can then show a column read off the arrow instead of off the row —{' '}
					<Jump to="tables" go={go}>
						see Tables
					</Jump>
					. A database needs a join table for this; here the arrow was already an object.
				</p>
			</Section>
		</>
	)
}
