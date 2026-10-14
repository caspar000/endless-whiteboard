import {
	AutoDisplay,
	choiceStyle,
	formatPropertyValue,
	isChoiceType,
	numericPropertyValue,
	stripRow,
	type PropertyDef,
	type PropertyValue,
} from '@lifeboard/node-kit'
import { Image as ImageIcon } from 'lucide-react'
import type { ExampleCard } from './exampleDomains'

/**
 * A shape as it looks on the canvas, for the interactive examples, with its property card below.
 *
 * The card is node-kit's own `AutoDisplay`, fed the example's values, because the whole claim of the
 * Properties section is "this is what it looks like on the board", and a hand-drawn approximation
 * would be the one part of the page that could quietly stop being true. `StripValue` is the value as
 * the panel's rows show it.
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

/**
 * The property card under a mock shape, drawn by the real `AutoDisplay` from the example's values,
 * so it can't drift from what the board shows.
 */
export function MockPropertyCard({
	card,
	properties,
}: {
	card: ExampleCard
	properties: readonly PropertyDef[]
}) {
	const rows = properties.map((def) => stripRow(def, card.values[def.id] ?? null, card.units?.[def.id] ?? def.unit))
	if (rows.every((row) => row.empty)) return null
	return (
		<div className="lb-ex__propcard">
			<AutoDisplay rows={rows} />
		</div>
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
		<div className="lb-ex__item">
			<button className={classes.join(' ')} onClick={onSelect} aria-pressed={selected}>
				{card.kind === 'image' && (
					<span className="lb-ex__photo" aria-hidden="true">
						<ImageIcon size={18} />
					</span>
				)}
				<span className="lb-ex__cardname">{card.name}</span>
			</button>
			<MockPropertyCard card={card} properties={properties} />
		</div>
	)
}
