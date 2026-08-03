import { useValue, type Editor } from 'tldraw'
import { formatPropertyValue } from './format'
import { findProperty, readPropertyRegistry } from './schema'
import { isListType } from './types'
import { readShapeProperties, type ShapeWithMeta } from './values'

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
			const ids = Object.keys(values)
			if (!ids.length) return []
			const registry = readPropertyRegistry(editor)
			return ids.flatMap((id) => {
				const def = findProperty(registry, id)
				if (!def) return []
				return [
					{
						id,
						name: def.name,
						list: isListType(def.type),
						text: formatPropertyValue(def, values[id]!),
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
									<span className="lb-strip__tag" key={tag}>
										{tag}
									</span>
								))}
					</div>
				) : (
					<div className="lb-strip__row" key={row.id}>
						<dt className="lb-strip__name">{row.name}</dt>
						<dd className="lb-strip__value">{row.text}</dd>
					</div>
				)
			)}
		</dl>
	)
}
