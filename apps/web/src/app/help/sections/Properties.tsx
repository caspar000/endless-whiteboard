import { DomainExample } from '../DomainExample'
import { PropertyGallery } from '../PropertyGallery'
import { Cursor, Jump, Keys, Section, useDemo, type SectionProps } from '../kit'

/* ------------------------------------------------------- opening the panel */

const PROPS_STEPS = [1100, 700, 1100, 1100, 900, 2400] as const

function PropertiesDemo() {
	const { step, ref } = useDemo(PROPS_STEPS)
	const panelOpen = step >= 2 && step <= 3

	return (
		<div
			className="lb-demo"
			ref={ref}
			role="img"
			aria-label="Opening the properties panel on a sticky note and giving it a price"
		>
			<div className="lb-demo__scene">
				<div className="lb-demo__stickywrap">
					<div className="lb-demo__sticky">Standing desk</div>
					<div className={step >= 4 ? 'lb-demo__strip lb-demo__pop--in' : 'lb-demo__strip'}>
						<span className="lb-demo__stripname">Price</span>
						<span className="lb-demo__stripvalue">₾450</span>
					</div>
				</div>
				<div className={panelOpen ? 'lb-demo__panel lb-demo__panel--open' : 'lb-demo__panel'}>
					<div className="lb-demo__panelhead">
						Properties <Keys keys={['⌥P']} />
					</div>
					<div className="lb-demo__panelrow">
						<span>Price</span>
						<span className="lb-demo__panelvalue">
							{step >= 3 ? '₾450' : ''}
							{step === 2 && <span className="lb-demo__caret" />}
						</span>
					</div>
					<div className="lb-demo__panelrow lb-demo__panelrow--faint">+ Add property</div>
				</div>
				<Cursor x={step >= 1 ? 252 : 430} y={step >= 1 ? 82 : 190} />
			</div>
			<div className="lb-demo__hint">
				{step >= 4
					? 'the value now lives on the sticky itself'
					: 'right-click any shape → Properties, or press ⌥P'}
			</div>
		</div>
	)
}

/* ---------------------------------------------------------------- the page */

export function Properties({ go }: SectionProps) {
	return (
		<>
			<Section title="A property is defined once, for the whole board">
				<p>
					Adding <em>Price</em> to a sticky does not give that sticky a private field — it defines Price
					on this board, and then <strong>every shape may carry a value for it</strong>. A note, a
					sticky, a dragged-in photo, a rectangle, an arrow. There is no kind of object you have to
					convert something into first, and no database to add a row to.
				</p>
				<p>
					Right-click a shape and choose Properties, or press <kbd className="lb-kbd">⌥P</kbd> with one
					shape selected. Double-click is left alone — it always means "edit the content", which is
					what lets a note be prose and a row of data at the same time.
				</p>
				<PropertiesDemo />
				<p className="lb-help__aside">
					Renaming a property is free: values are keyed by an id derived once when you create it, so
					<em> Price</em> becoming <em>Asking price</em> touches no shapes and breaks no table.
				</p>
			</Section>

			<Section title="Eleven types, and the two lists that matter">
				<p>
					Choosing a type is not about how the value looks. It decides what the board can{' '}
					<strong>ask</strong> of it — which filters it offers and which summaries it can produce — and
					those are the two lists shown for each type below. That is why a price should be money rather
					than text even though both render fine on a card.
				</p>
				<PropertyGallery />
			</Section>

			<Section title="Two boards from two different lives">
				<p>
					The system has no opinion about your subject, which is a claim worth seeing twice. Below are
					two boards that share nothing: one is money, a deadline and a decision; the other has no money
					in it at all. Both are described with the same eleven types and answered by the same four
					verbs.
				</p>
				<p>
					Switch the board, click a card to see its panel, then ask the board a question. Every answer
					is computed from the cards on screen.
				</p>
				<DomainExample />
			</Section>

			<Section title="What shows up on the card">
				<p>
					Values render on the shape itself, so a priced sticky <em>looks</em> priced from across a
					zoomed-out board. Because that space is finite, the panel lets each shape choose for itself:
					drag a row to reorder it, or click the eye to hide it. Hidden values stay attached and keep
					counting towards every total — they simply stop taking up room.
				</p>
				<div className="lb-help__facts">
					<div className="lb-help__fact">
						<h3>Tags are not special</h3>
						<p>
							A multi-select is a list of options, drawn as chips. Each option's colour comes from
							its own text, so the same tag is the same colour on every board with nothing to set up.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>A status is not a select</h3>
						<p>
							Its colour comes from the stage — To-do, In progress, Done — not from the label. Two
							boards spelling "finished" differently still agree about what finished means.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>Money belongs to the card</h3>
						<p>
							Currency is per shape, not per property: one board can hold ₾ and $ on the same Price.
							A total then reports each currency separately unless you give a table a rate.
						</p>
					</div>
					<div className="lb-help__fact">
						<h3>Progress is a number</h3>
						<p>
							Drawn as a bar because a bar survives zooming out, but it averages and filters exactly
							like the plain number it is.
						</p>
					</div>
				</div>
			</Section>

			<Section title="Then what?">
				<p>
					Properties on their own are a tidy board. The three sections after this one are the three
					ways of getting something back out of them:{' '}
					<Jump to="relations" go={go}>
						arrows
					</Jump>{' '}
					relate shapes to each other,{' '}
					<Jump to="asking" go={go}>
						expressions and collections
					</Jump>{' '}
					put a live number inside a sentence or on any shape, and a{' '}
					<Jump to="tables" go={go}>
						table
					</Jump>{' '}
					is a saved question with rows.
				</p>
			</Section>
		</>
	)
}
