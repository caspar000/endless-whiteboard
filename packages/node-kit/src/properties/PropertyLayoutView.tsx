import { Link } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { useValue, type Editor } from '@lifeboard/canvas'
import { formatPropertyValue, numericPropertyValue } from './format'
import {
	SLOTS,
	defaultDisplay,
	formatLayoutValue,
	visibleLayoutRows,
	type LayoutElement,
	type LayoutRow,
	type PropertyElement,
	type PropertyLayout,
	type Slot,
} from './layout'
import { linkHref } from './link'
import { choiceStyle } from './options'
import { PropertyLink } from './PropertyStrip'
import { propertyMap, readPropertyRegistry } from './schema'
import { RATING_MAX, type PropertyDef, type PropertyValue } from './types'
import {
	readShapeProperties,
	readShapePropertyUnits,
	unitForShapeProperty,
	type ShapeProperties,
	type ShapePropertyUnits,
	type ShapeWithMeta,
} from './values'
import { isEmptyPropertyValue } from './view'

/** What every element needs to draw itself, read once per render of the card. */
interface Data {
	values: ShapeProperties
	units: ShapePropertyUnits
	registry: ReadonlyMap<string, PropertyDef>
}

/**
 * Display mode for a node that has a layout of its own (docs/property-display-plan.md): rows of
 * left/centre/right slots, each row as tall as what is in it.
 *
 * The panel's hide eye doesn't apply here; the layout already says what shows.
 */
export function PropertyLayoutView({
	shape,
	editor,
	layout,
}: {
	shape: ShapeWithMeta
	editor: Editor
	layout: PropertyLayout
}) {
	const data = useValue(
		'lifeboard:property-layout',
		(): Data => ({
			values: readShapeProperties(shape),
			units: readShapePropertyUnits(shape),
			registry: propertyMap(readPropertyRegistry(editor)),
		}),
		[editor, shape]
	)
	const rows = visibleLayoutRows(
		layout,
		(id) => data.registry.has(id) && !isEmptyPropertyValue(data.values[id])
	)
	if (!rows) return null

	return (
		<div className="lb-layout">
			{rows.map((row, i) => (
				<LayoutRowView key={i} row={row} data={data} />
			))}
		</div>
	)
}

/**
 * Three columns when there is a centre, so it stays centred whatever the sides hold; otherwise the
 * left slot takes the room and the right one hugs its content.
 */
function LayoutRowView({ row, data }: { row: LayoutRow; data: Data }) {
	const centred = Boolean(row.center?.length)
	const style: CSSProperties = {
		gridTemplateColumns: centred ? 'minmax(0, 1fr) auto minmax(0, 1fr)' : 'minmax(0, 1fr) auto',
	}
	return (
		<div className={`lb-layout__row lb-layout__row--${row.align ?? 'middle'}`} style={style}>
			{SLOTS.map((slot) => {
				if (!centred && slot === 'center') return null
				const column = centred ? SLOTS.indexOf(slot) + 1 : slot === 'left' ? 1 : 2
				return (
					<SlotView key={slot} slot={slot} column={column} elements={row[slot] ?? []} data={data} />
				)
			})}
		</div>
	)
}

function SlotView({
	slot,
	column,
	elements,
	data,
}: {
	slot: Slot
	column: number
	elements: readonly LayoutElement[]
	data: Data
}) {
	return (
		<div className={`lb-layout__slot lb-layout__slot--${slot}`} style={{ gridColumn: column }}>
			{elements.map((element, i) => (
				<ElementView key={i} element={element} data={data} />
			))}
		</div>
	)
}

function sizeClass(element: { size?: string; weight?: string }): string {
	return `lb-el lb-el--${element.size ?? 'm'}${element.weight === 'bold' ? ' lb-el--bold' : ''}`
}

function ElementView({ element, data }: { element: LayoutElement; data: Data }) {
	switch (element.kind) {
		case 'separator':
			return <hr className="lb-layout__rule" />
		case 'text':
			return <span className={sizeClass(element)}>{element.text}</span>
		case 'table':
			return (
				<table className={`lb-layout__table lb-el--${element.size ?? 's'}`}>
					<tbody>
						{element.properties.map((id) => {
							const def = data.registry.get(id)!
							const value = data.values[id]!
							return (
								<tr key={id}>
									<th>{def.name}</th>
									<td>{formatPropertyValue(def, value, unitForShapeProperty(def, data.units))}</td>
								</tr>
							)
						})}
					</tbody>
				</table>
			)
		case 'property': {
			const def = data.registry.get(element.property)!
			return <PropertyElementView element={element} def={def} value={data.values[def.id]!} data={data} />
		}
	}
}

function PropertyElementView({
	element,
	def,
	value,
	data,
}: {
	element: PropertyElement
	def: PropertyDef
	value: PropertyValue
	data: Data
}) {
	const as = element.as ?? defaultDisplay(def.type)
	const text = formatLayoutValue(def, value, unitForShapeProperty(def, data.units), element.format)
	const name = element.showName ? <span className="lb-el__name">{def.name}</span> : null
	const tags = Array.isArray(value) ? value : [text]

	const body = (() => {
		switch (as) {
			case 'badge':
			case 'chip':
				return tags.map((tag) => (
					<span
						key={tag}
						className={as === 'badge' ? 'lb-chip lb-el__badge' : 'lb-chip lb-el__chip'}
						style={choiceStyle(def, tag)}
					>
						{tag}
					</span>
				))
			case 'icon': {
				const href = linkHref(value)
				return href ? <LinkIcon href={href} title={text} /> : text
			}
			case 'bar': {
				const numeric = numericPropertyValue(def, value) ?? 0
				const percent = def.type === 'rating' ? (numeric / RATING_MAX) * 100 : numeric
				return (
					<span className="lb-bar">
						<span className="lb-bar__track">
							<span className="lb-bar__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
						</span>
						{text}
					</span>
				)
			}
			case 'stars':
				return <span className="lb-el__stars">{text}</span>
			case 'checkbox':
				// A tick says nothing without what was ticked, so the box always carries its name.
				return (
					<>
						<span className="lb-el__box" aria-hidden>
							✓
						</span>
						{element.showName ? null : def.name}
					</>
				)
			default: {
				const href = def.type === 'link' ? linkHref(value) : null
				if (href) return <PropertyLink href={href} text={text} />
				const negative = (numericPropertyValue(def, value) ?? 0) < 0
				return negative ? <span className="lb-strip__value--neg">{text}</span> : text
			}
		}
	})()

	return (
		<span className={sizeClass(element)} title={def.name}>
			{name}
			{body}
		</span>
	)
}

/**
 * A link as its site's icon. The favicon is asked of the linked site itself, the way a browser tab
 * would, and falls back to a link glyph when it has none or can't be reached.
 */
function LinkIcon({ href, title }: { href: string; title: string }) {
	const [failed, setFailed] = useState(false)
	let favicon: string | null = null
	try {
		const url = new URL(href)
		if (url.protocol === 'http:' || url.protocol === 'https:') favicon = `${url.origin}/favicon.ico`
	} catch {
		favicon = null
	}
	return (
		<a
			className="lb-el__icon"
			href={href}
			target="_blank"
			rel="noreferrer noopener"
			title={title}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => e.stopPropagation()}
		>
			{favicon && !failed ? (
				<img src={favicon} alt="" width={16} height={16} onError={() => setFailed(true)} />
			) : (
				<Link size={14} aria-hidden />
			)}
		</a>
	)
}
