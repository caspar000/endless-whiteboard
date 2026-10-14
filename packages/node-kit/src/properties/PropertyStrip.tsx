import { useValue, type Editor } from '@lifeboard/canvas'
import { formatPropertyValue, numericPropertyValue } from './format'
import { linkHref } from './link'
import { choiceStyle } from './options'
import { findProperty, readPropertyRegistry } from './schema'
import { isChoiceType, isListType, type PropertyDef } from './types'
import {
	orderedPropertyIds,
	readHiddenPropertyIds,
	readShapeProperties,
	readShapePropertyUnits,
	unitForShapeProperty,
	type ShapeWithMeta,
} from './values'
import { autoLayoutGroups, isEmptyPropertyValue } from './view'

/** One property as the card renders it, read once and shared by both views. */
interface StripRow {
	id: string
	def: PropertyDef
	name: string
	list: boolean
	choice: boolean
	text: string
	/** A multiSelect's tags, from the value itself rather than split back out of `text`. */
	tags: readonly string[]
	href: string | null
	percent: number | null
	negative: boolean
	empty: boolean
}

/**
 * The shape's visible properties, in panel order.
 *
 * Display order and per-shape visibility come from the panel (drag to reorder, eye to hide). Hidden
 * values stay attached and keep aggregating; they just don't render. Values with no registry
 * definition are skipped rather than shown raw: on the card there is no room to explain an orphan,
 * and the properties panel is where that gets surfaced and fixed.
 */
function usePropertyRows(shape: ShapeWithMeta, editor: Editor): StripRow[] {
	return useValue(
		'lifeboard:property-strip',
		() => {
			const values = readShapeProperties(shape)
			const hidden = readHiddenPropertyIds(shape)
			const units = readShapePropertyUnits(shape)
			const ids = orderedPropertyIds(shape).filter((id) => !hidden.has(id))
			if (!ids.length) return []
			const registry = readPropertyRegistry(editor)
			return ids.flatMap((id): StripRow[] => {
				const def = findProperty(registry, id)
				if (!def) return []
				const value = values[id]!
				const numeric = numericPropertyValue(def, value)
				return [
					{
						id,
						def,
						name: def.name,
						list: isListType(def.type),
						// A chosen value is a tag, not free text, so it reads as a coloured pill wherever
						// it appears.
						choice: isChoiceType(def.type),
						text: formatPropertyValue(def, value, unitForShapeProperty(def, units)),
						tags: Array.isArray(value) ? value : [],
						// `null` for everything that isn't a link, and for a link with no usable address.
						href: def.type === 'link' ? linkHref(value) : null,
						// A bar reads at a zoom where digits have stopped being legible, which is the one
						// thing a canvas needs from a progress value that a table doesn't.
						percent: def.type === 'progress' && typeof numeric === 'number' ? numeric : null,
						negative: numeric !== null && numeric < 0,
						empty: isEmptyPropertyValue(value),
					},
				]
			})
		},
		[editor, shape]
	)
}

/**
 * Source mode: every visible property as a labelled `name … value` row.
 *
 * The plain view of the data, for when you want to see all of it with names. Display mode
 * (`PropertyDisplay`) is the designed one.
 */
export function PropertyStrip({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	const rows = usePropertyRows(shape, editor)
	if (!rows.length) return null

	return (
		<dl className="lb-strip">
			{rows.map((row) =>
				row.list ? (
					// A multi-select reads as chips rather than a labelled row: it is a set of tags, and
					// "Tags: furniture, decor" wastes the width a card doesn't have.
					<div className="lb-strip__tags" key={row.id}>
						{row.tags.map((tag) => (
							<span className="lb-chip" key={tag} style={choiceStyle(row.def, tag)}>
								{tag}
							</span>
						))}
					</div>
				) : (
					<div className="lb-strip__row" key={row.id}>
						<dt className="lb-strip__name">{row.name}</dt>
						<dd className={row.negative ? 'lb-strip__value lb-strip__value--neg' : 'lb-strip__value'}>
							{row.href ? (
								<PropertyLink href={row.href} text={row.text} />
							) : row.percent !== null ? (
								<span className="lb-bar">
									<span className="lb-bar__track">
										<span className="lb-bar__fill" style={{ width: `${row.percent}%` }} />
									</span>
									{row.text}
								</span>
							) : row.choice && row.text !== '—' ? (
								<span className="lb-chip" style={choiceStyle(row.def, row.text)}>
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

/**
 * Display mode with no layout of its own: the automatic layout.
 *
 * Badges for select and status, one value-only meta line (the name is in the tooltip), chips for
 * multiSelect, a bar for progress. Empty values are left out, so a card with nothing set renders
 * nothing and the host hides it.
 */
export function PropertyDisplay({ shape, editor }: { shape: ShapeWithMeta; editor: Editor }) {
	const rows = usePropertyRows(shape, editor).filter((row) => !row.empty)
	if (!rows.length) return null

	return (
		<div className="lb-strip lb-strip--display">
			{autoLayoutGroups(rows).map(({ role, rows: members }) => {
				switch (role) {
					case 'badge':
						return (
							<div className="lb-strip__badges" key={role}>
								{members.map((row) => (
									<span className="lb-chip" key={row.id} title={row.name} style={choiceStyle(row.def, row.text)}>
										{row.text}
									</span>
								))}
							</div>
						)
					case 'chips':
						return (
							<div className="lb-strip__tags" key={role}>
								{members.flatMap((row) =>
									row.tags.map((tag) => (
										<span className="lb-chip" key={`${row.id}:${tag}`} title={row.name} style={choiceStyle(row.def, tag)}>
											{tag}
										</span>
									))
								)}
							</div>
						)
					case 'bar':
						return members.map((row) => (
							<div className="lb-strip__bar" key={row.id} title={row.name}>
								<span className="lb-bar">
									<span className="lb-bar__track">
										<span className="lb-bar__fill" style={{ width: `${row.percent ?? 0}%` }} />
									</span>
									{row.text}
								</span>
							</div>
						))
					case 'meta':
						return (
							<div className="lb-strip__meta" key={role}>
								{members.map((row) => (
									<span
										key={row.id}
										title={row.name}
										className={row.negative ? 'lb-strip__item lb-strip__value--neg' : 'lb-strip__item'}
									>
										{row.href ? (
											<PropertyLink href={row.href} text={row.text} />
										) : row.def.type === 'checkbox' ? (
											// A tick alone says nothing without its name, so a ticked box shows both.
											`${row.text} ${row.name}`
										) : (
											row.text
										)}
									</span>
								))}
							</div>
						)
				}
			})}
		</div>
	)
}

/**
 * A link property's value, opening in a new tab: navigating away would take the board with it. The
 * card passes pointer events to its node, so this stops them to keep the canvas from starting a drag;
 * it does not prevent the default, so the link still opens.
 */
function PropertyLink({ href, text }: { href: string; text: string }) {
	return (
		<a
			className="lb-strip__link"
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			title={href}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
		>
			{text}
		</a>
	)
}
