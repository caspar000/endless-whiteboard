import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import type { TLShape } from '@lifeboard/canvas'
import { coercePropertyValue } from '../properties/format'
import { createProperty } from '../properties/schema'
import { PROPERTY_TYPES, type PropertyDef, type PropertyType } from '../properties/types'
import { layoutFromAuto, readPropertyLayout } from '../properties/layout'
import { setPropertyLayouts } from '../properties/layoutEdit'
import { layoutFromYaml, layoutToYaml } from '../properties/layoutYaml'
import { orderedPropertyIds, readHiddenPropertyIds, updateShapeProperties } from '../properties/values'
import { readPropertyView, setPropertyView, type PropertyView } from '../properties/view'
import {
	BOARD_ID_PARAM,
	propertyDefs,
	reportAgentWork,
	resolveEditor,
	resolveProperty,
	resolveShape,
} from './shared'

function definitionSummary(def: PropertyDef): JsonValue {
	return {
		id: def.id,
		name: def.name,
		type: def.type,
		unit: def.unit ?? null,
		options: def.options ?? null,
	}
}

export const propertyOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'property.list',
		title: 'List properties',
		description:
			'The properties defined on a board — the columns a table can show and node.find can filter by. Any shape may carry any of them.',
		readOnly: true,
		params: { boardId: BOARD_ID_PARAM },
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			return ok(propertyDefs(resolved.editor).map(definitionSummary))
		},
	}),

	defineOperation({
		id: 'property.create',
		title: 'Create property',
		description:
			'Defines a property on a board so shapes can carry it. Returns the existing definition unchanged if one with this name already exists, so it is safe to call before every write.',
		params: {
			name: {
				type: 'string',
				description: 'What it is called, e.g. "Price". The id is derived from this.',
				required: true,
			},
			type: {
				type: 'string',
				description:
					'The kind of value. "financial" is money and needs a unit; "rating" is 1–5; "status" tracks stages.',
				required: true,
				choices: PROPERTY_TYPES,
			},
			unit: {
				type: 'string',
				description:
					'Currency code for financial ("USD", "GEL"), or a display unit for number ("kg").',
			},
			options: {
				type: 'string[]',
				description: 'The choices, for select, status and multiSelect.',
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const name = args.name.trim()
			if (!name) return fail('A property needs a name.')

			const def = createProperty(editor, {
				name,
				// Checked by `choices`, so this narrowing is a formality the type system needs, not a
				// trust boundary — `coerceArgs` already rejected anything outside the list.
				type: args.type as PropertyType,
				...(args.unit ? { unit: args.unit } : {}),
				...(args.options?.length ? { options: args.options } : {}),
			})
			if (!def) return fail(`Could not create a property called "${name}".`)
			return ok(definitionSummary(def))
		},
	}),

	defineOperation({
		id: 'property.set',
		title: 'Set property value',
		description:
			'Writes a property value on a shape, creating nothing — the property must already exist (property.create). Values are given as text and read according to the property’s type: "2399" for a number, "true" for a checkbox, a comma-separated list for multiSelect. An empty string clears the value but keeps the property attached.',
		params: {
			shapeId: { type: 'string', description: 'The shape to write on.', required: true },
			property: { type: 'string', description: 'The property, by name or id.', required: true },
			value: {
				type: 'string',
				description: 'The value, as text. Read according to the property’s type.',
				required: true,
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)

			const defs = propertyDefs(editor)
			const def = resolveProperty(defs, args.property)
			if (!def) {
				const known = defs.map((candidate) => candidate.name).join(', ')
				return fail(
					`No property called "${args.property}" on this board. ${
						known ? `Known: ${known}.` : 'There are none yet — create one with property.create.'
					}`
				)
			}

			const value = coercePropertyValue(def.type, args.value)
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: property.set')
				updateShapeProperties(editor, found.shape, { [def.id]: value })
			})

			reportAgentWork(editor, 'update', 'property.set', `Setting ${def.name}`, [found.shape.id])
			return ok({
				shapeId: args.shapeId,
				property: { id: def.id, name: def.name, type: def.type },
				// Echoed back as stored, not as sent: "2,399" becomes 2399 and an agent should see that
				// its value was understood rather than assume it.
				value: (value ?? null) as JsonValue,
			})
		},
	}),

	defineOperation({
		id: 'property.layout',
		title: 'Read card layout',
		description:
			'How a shape’s property card is laid out, as YAML: rows of left/center/right slots holding properties, tables, separators and text. `layout` is null when the card uses the automatic layout; `automatic` is that layout written out, a good starting point for property.set-layout. `view` is "display" (the layout) or "source" (every property with its name).',
		readOnly: true,
		params: {
			shapeId: { type: 'string', description: 'The shape whose card to read.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor
			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)

			const defs = propertyDefs(editor)
			const layout = readPropertyLayout(found.shape)
			const hidden = readHiddenPropertyIds(found.shape)
			const visible = orderedPropertyIds(found.shape)
				.filter((id) => !hidden.has(id))
				.flatMap((id) => defs.find((def) => def.id === id) ?? [])
			return ok({
				shapeId: args.shapeId,
				view: readPropertyView(found.shape),
				layout: layout ? layoutToYaml(layout, defs) : null,
				automatic: layoutToYaml(layoutFromAuto(visible), defs),
			})
		},
	}),

	defineOperation({
		id: 'property.set-layout',
		title: 'Set card layout',
		description:
			'Lays out the property cards of one or more shapes, from YAML. Each shape gets its own copy. Example:\n\nwidth: 260            # or fit, full\nrows:\n  - center: { property: Price, size: xl, weight: bold }\n    right: { property: Link, as: icon }\n  - separator\n  - left: [{ property: Type, as: badge }, { property: Status, as: badge }]\n  - table: [Weight, Colour]\n\nProperty keys: as (text, badge, chip, icon, bar, stars, checkbox, by type), size (s, m, l, xl), weight (regular, bold), showName, decimals, symbol, date (short, medium, long). Rows take align (top, middle, bottom, baseline). An empty layout goes back to the automatic one. Errors come back with their line numbers and nothing is written.',
		params: {
			shapeIds: { type: 'string[]', description: 'The shapes to lay out.', required: true },
			layout: {
				type: 'string',
				description: 'The layout as YAML, properties by name. Empty for the automatic layout.',
				required: true,
			},
			view: {
				type: 'string',
				description: 'Also switch the cards to "display" or "source". Defaults to display, where a layout shows.',
				choices: ['display', 'source'],
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const shapes: TLShape[] = []
			for (const id of args.shapeIds) {
				const found = resolveShape(editor, id)
				if (!found.ok) return fail(found.error)
				shapes.push(found.shape)
			}
			if (!shapes.length) return fail('Name at least one shape.')

			let layout = null
			if (args.layout.trim()) {
				const result = layoutFromYaml(args.layout, propertyDefs(editor))
				if (!result.ok) {
					return fail(
						`The layout has ${result.errors.length === 1 ? 'an error' : 'errors'}, so nothing was written:\n${result.errors
							.map((e) => `line ${e.line}: ${e.message}`)
							.join('\n')}`
					)
				}
				layout = result.layout
			}

			const view = (args.view ?? 'display') as PropertyView
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: property.set-layout')
				setPropertyLayouts(editor, shapes, layout)
				setPropertyView(
					editor,
					shapes.map((s) => s.id),
					view
				)
			})
			reportAgentWork(
				editor,
				'update',
				'property.set-layout',
				'Laying out cards',
				shapes.map((s) => s.id)
			)
			return ok({ shapeIds: args.shapeIds, view, automatic: layout === null })
		},
	}),
]
