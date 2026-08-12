import {
	choiceStyle,
	formatPropertyValue,
	isChoiceType,
	isListType,
	numericPropertyValue,
	type PropertyDef,
	type PropertyValue,
} from '@lifeboard/node-kit'
import { Image as ImageIcon } from 'lucide-react'
import type { ExampleCard } from './exampleDomains'

/**
 * A shape as it looks on the canvas, for the interactive examples.
 *
 * The strip below the name is a deliberate copy of `PropertyStrip` — same classes, same branches, same
 * formatter — because the whole claim of the Properties section is "this is what it looks like on the
 * board", and a hand-drawn approximation would be the one part of the page that could quietly stop
 * being true. What is *not* copied is the reactive plumbing: these cards read a plain object.
 */

export function StripValue({
	def,
	value,
	unit,
}: {
	def: PropertyDef
	value: PropertyValue
	unit: string | undefined
}) {
	const text = formatPropertyValue(def, value, unit ?? def.unit)
	const numeric = numericPropertyValue(def, value)

	if (def.type === 'progress' && typeof numeric === 'number') {
		return (
			<span className="lb-bar">
				<span className="lb-bar__track">
					<span className="lb-bar__fill" style={{ width: `${numeric}%` }} />
				</span>
				{text}
			</span>
		)
	}
	// A link's title is shown in the app's accent as a real anchor; here it is inert on purpose — the
	// example is a picture of a card, and a help page should not open tabs when you click a picture.
	if (def.type === 'link') return <span className="lb-strip__link">{text}</span>
	if (isChoiceType(def.type) && text !== '—') {
		return (
			<span className="lb-chip" style={choiceStyle(def, text)}>
				{text}
			</span>
		)
	}
	return <>{text}</>
}

export function MockStrip({
	card,
	properties,
}: {
	card: ExampleCard
	properties: readonly PropertyDef[]
}) {
	// Empty values are skipped rather than shown as "—": on a real card the strip only draws what has
	// been filled in, which is what keeps a board of half-described things readable.
	const rows = properties.filter((def) => {
		const value = card.values[def.id]
		return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length)
	})
	if (!rows.length) return null

	return (
		<dl className="lb-strip">
			{rows.map((def) =>
				isListType(def.type) ? (
					<div className="lb-strip__tags" key={def.id}>
						{(card.values[def.id] as readonly string[]).map((tag) => (
							<span className="lb-chip" key={tag} style={choiceStyle(def, tag)}>
								{tag}
							</span>
						))}
					</div>
				) : (
					<div className="lb-strip__row" key={def.id}>
						<dt className="lb-strip__name">{def.name}</dt>
						<dd className="lb-strip__value">
							<StripValue
								def={def}
								value={card.values[def.id] ?? null}
								unit={card.units?.[def.id]}
							/>
						</dd>
					</div>
				)
			)}
		</dl>
	)
}

/**
 * One card on the mock board. Clickable, because the example's point is made by comparing two of them
 * and the reader needs a way to say which one they are asking about.
 */
export function MockCard({
	card,
	properties,
	selected,
	onSelect,
}: {
	card: ExampleCard
	properties: readonly PropertyDef[]
	selected: boolean
	onSelect: () => void
}) {
	const classes = ['lb-ex__card', `lb-ex__card--${card.kind}`]
	if (selected) classes.push('lb-ex__card--on')

	return (
		<button className={classes.join(' ')} onClick={onSelect} aria-pressed={selected}>
			{card.kind === 'image' && (
				<span className="lb-ex__photo" aria-hidden="true">
					<ImageIcon size={18} />
				</span>
			)}
			<span className="lb-ex__cardname">{card.name}</span>
			<MockStrip card={card} properties={properties} />
		</button>
	)
}
