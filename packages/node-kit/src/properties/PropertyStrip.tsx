import { useValue, type Editor } from 'tldraw'
import { formatPropertyValue, numericPropertyValue } from './format'
import { linkHref } from './link'
import { optionStyle } from './options'
import { findProperty, readPropertyRegistry } from './schema'
import { isChoiceType, isListType } from './types'
import {
	orderedPropertyIds,
	readHiddenPropertyIds,
	readShapeProperties,
	readShapePropertyUnits,
	unitForShapeProperty,
	type ShapeWithMeta,
} from './values'

/**
 * A shape's properties, rendered on the shape itself.
 *
 * Without this, properties would be data you can only see by opening a panel — which for a whiteboard
 * is the wrong way round. A note carrying a price should read as a priced thing at a glance, the way
 * the old item card did; the difference is that now *any* shape can look like that.
 *
 * Values with no registry definition are skipped rather than shown raw: on the card there is no room to
 * explain an orphan, and the properties panel is where that gets surfaced and fixed.
 */
export function PropertyStrip({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	const rows = useValue(
		'lifeboard:property-strip',
		() => {
			const values = readShapeProperties(shape)
			// Display order and per-shape visibility come from the panel (drag to reorder, eye to
			// hide). Hidden values stay attached and keep aggregating — they just don't render here.
			const hidden = readHiddenPropertyIds(shape)
			const units = readShapePropertyUnits(shape)
			const ids = orderedPropertyIds(shape).filter((id) => !hidden.has(id))
			if (!ids.length) return []
			const registry = readPropertyRegistry(editor)
			return ids.flatMap((id) => {
				const def = findProperty(registry, id)
				if (!def) return []
				const numeric = numericPropertyValue(def, values[id]!)
				return [
					{
						id,
						name: def.name,
						list: isListType(def.type),
						// A chosen value is a tag, not free text, so it reads as a coloured pill wherever
						// it appears. `select` keeps its label — "Status: DOING" is worth the width.
						choice: isChoiceType(def.type),
						text: formatPropertyValue(def, values[id]!, unitForShapeProperty(def, units)),
						// `null` for everything that isn't a link, and for a link with no usable address.
						href: def.type === 'link' ? linkHref(values[id]!) : null,
						negative: numeric !== null && numeric < 0,
					},
				]
			})
		},
		[editor, shape]
	)

	if (!rows.length) return null

	return (
		<dl className="lb-strip">
			{rows.map((row) =>
				row.list ? (
					// A multi-select reads as chips rather than a labelled row: it is a set of tags, and
					// "Tags: furniture, decor" wastes the width a card doesn't have.
					<div className="lb-strip__tags" key={row.id}>
						{row.text === '—'
							? null
							: row.text.split(', ').map((tag) => (
									<span className="lb-chip" key={tag} style={optionStyle(tag)}>
										{tag}
									</span>
								))}
					</div>
				) : (
					<div className="lb-strip__row" key={row.id}>
						<dt className="lb-strip__name">{row.name}</dt>
						<dd className={row.negative ? 'lb-strip__value lb-strip__value--neg' : 'lb-strip__value'}>
							{row.href ? (
								/*
								 * A new tab, deliberately: navigating away would take the board with it. The
								 * shape has `pointer-events: none` in display mode so it still behaves like a
								 * shape, and a child turning them back on is the documented escape hatch — the
								 * same one the note's checkboxes use. Stopping the pointer-down keeps the canvas
								 * from starting a drag; it does not prevent the default, so the link still opens.
								 */
								<a
									className="lb-strip__link"
									href={row.href}
									target="_blank"
									rel="noreferrer noopener"
									title={row.href}
									onPointerDown={(e) => e.stopPropagation()}
									onClick={(e) => e.stopPropagation()}
								>
									{row.text}
								</a>
							) : row.choice && row.text !== '—' ? (
								<span className="lb-chip" style={optionStyle(row.text)}>
									{row.text}
								</span>
							) : (
								row.text
							)}
						</dd>
					</div>
				)
			)}
		</dl>
	)
}
