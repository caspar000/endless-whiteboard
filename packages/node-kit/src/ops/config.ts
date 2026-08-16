import type { T, TLShape } from 'tldraw'
import { collectionPatch, collectionValidator, readCollection, type Collection } from '../collections/spec'
import { defineOperation, fail, ok, type JsonValue, type RegisteredOperation } from '../operations'
import { getNodeDefinition } from '../registry'
import { BOARD_ID_PARAM, resolveEditor, resolveShape } from './shared'

/**
 * Configuring a node — the settings that are neither its text nor its geometry.
 *
 * A table is the case that forced this: what it *shows* is its source, columns, grouping, sorts and
 * layout, none of which fit `node.update`'s flat text/x/y/w/h. An agent could create a table and then
 * had no way to make it show anything, which is the least useful half of the feature.
 *
 * **Generic, not table-shaped.** Every `NodeDefinition` already declares tldraw validators for its own
 * props (`registry.tsx`), so this reads that registry rather than knowing anything about tables: a
 * node type is configurable because it declared props, and a third-party extension's node becomes
 * agent-configurable the moment it is registered. Same rule as operations becoming MCP tools.
 *
 * Config travels as a **JSON string** because the operation parameter space is deliberately flat
 * scalars (`ParamType`), and a table's source is three levels deep. That is a real trade — the model
 * writes JSON by hand — so `node.config` exists to be read first: the agent sees the exact shape it
 * has to send back, rather than inferring it from prose.
 */

/**
 * Props that are geometry rather than configuration.
 *
 * `w`/`h` are injected into every node's props by the registry, and are already `node.update`'s job.
 * Letting them through here would give two operations that resize a shape and disagree about whether
 * that is a configuration change.
 */
const GEOMETRY_PROPS = new Set(['w', 'h'])

function parseJsonObject(raw: string, label: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		return {
			ok: false,
			error: `${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse failed'}. Send a JSON object, e.g. {"groupBy":"status"}.`,
		}
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return { ok: false, error: `${label} must be a JSON object, not ${Array.isArray(parsed) ? 'an array' : typeof parsed}.` }
	}
	return { ok: true, value: parsed as Record<string, unknown> }
}

/** The prop names an agent may set on this shape type, or `null` when the type is not ours. */
function configurableKeys(shapeType: string): string[] | null {
	const def = getNodeDefinition(shapeType)
	if (!def) return null
	return Object.keys(def.props).filter((key) => !GEOMETRY_PROPS.has(key))
}

/** The shape's current configuration — its own props, minus geometry. */
function currentConfig(shape: TLShape, keys: readonly string[]): Record<string, JsonValue> {
	const props = shape.props as Record<string, unknown>
	const config: Record<string, JsonValue> = {}
	for (const key of keys) config[key] = (props[key] ?? null) as JsonValue
	return config
}

export const configOperations: RegisteredOperation[] = [
	defineOperation({
		id: 'node.config',
		title: 'Read node configuration',
		description:
			'The settings a node carries beyond its text and position — for a table that is its source, columns, groupBy, sorts and layout. Read this before node.configure: the JSON it returns is exactly the shape node.configure expects back, so there is no need to guess the structure. Also returns the shape’s collection, if it gathers.',
		readOnly: true,
		params: {
			shapeId: { type: 'string', description: 'The shape to read.', required: true },
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)
			const shape = found.shape

			const keys = configurableKeys(shape.type)
			return ok({
				id: shape.id,
				type: shape.type,
				// `null` rather than `{}` for a tldraw shape: "this type has no configuration" and "its
				// configuration happens to be empty" are different answers and the agent acts on them
				// differently.
				configurable: keys !== null,
				config: keys ? currentConfig(shape, keys) : null,
				collection: (readCollection(shape) ?? null) as JsonValue,
			})
		},
	}),

	defineOperation({
		id: 'node.configure',
		title: 'Configure node',
		description:
			'Changes a node’s settings — a table’s source, columns, groupBy, sorts or layout, for example. Pass config as a JSON object of only the keys you want to change; the rest are left alone. Read node.config first to see the exact structure. Every value is validated against the node type’s own schema, so a wrong shape is refused with the reason rather than written.',
		params: {
			shapeId: { type: 'string', description: 'The shape to configure.', required: true },
			config: {
				type: 'string',
				description:
					'JSON object of settings to change, merged over the current ones. Only top-level keys are merged — send a whole object for a nested key such as "source" or "layout".',
			},
			collection: {
				type: 'string',
				description:
					'JSON object making this shape gather others: {source, view, op, property}. Send "null" to stop it gathering. Any shape can carry one, not just a table.',
			},
			boardId: BOARD_ID_PARAM,
		},
		run: async (ctx, args) => {
			if (args.config === undefined && args.collection === undefined) {
				return fail('Nothing to change: pass config, collection, or both.')
			}

			const resolved = await resolveEditor(ctx, args.boardId)
			if (!resolved.ok) return fail(resolved.error)
			const editor = resolved.editor

			const found = resolveShape(editor, args.shapeId)
			if (!found.ok) return fail(found.error)
			const shape = found.shape

			// --- the node's own props -------------------------------------------------
			let nextProps: Record<string, unknown> | null = null
			if (args.config !== undefined) {
				const def = getNodeDefinition(shape.type)
				const keys = configurableKeys(shape.type)
				if (!def || !keys) {
					return fail(
						`A "${shape.type}" shape has no configurable settings — it is not one of this app's node types. node.config says which shapes do.`
					)
				}

				const parsed = parseJsonObject(args.config, 'config')
				if (!parsed.ok) return fail(parsed.error)

				const patch: Record<string, unknown> = {}
				for (const [key, value] of Object.entries(parsed.value)) {
					if (GEOMETRY_PROPS.has(key)) {
						return fail(`"${key}" is the shape's size — change it with node.update, not node.configure.`)
					}
					// `def.props` is keyed by the definition's own `Props`, which is erased to `object` on a
					// registered definition — so it indexes as `never`. One cast at the boundary, where the
					// key came off a JSON payload and is a string by construction anyway.
					const validators = def.props as Record<string, T.Validatable<unknown> | undefined>
					const validator = validators[key]
					if (!validator) {
						return fail(
							`"${shape.type}" has no setting called "${key}". It accepts: ${keys.join(', ')}.`
						)
					}
					// The type's own validator, so the error names the field that is wrong rather than
					// reporting that the shape failed to update after the fact.
					try {
						patch[key] = validator.validate(value)
					} catch (error) {
						return fail(
							`"${key}" is not valid for a ${shape.type}: ${error instanceof Error ? error.message : 'invalid value'}`
						)
					}
				}
				if (Object.keys(patch).length) nextProps = patch
			}

			// --- the collection, which any shape may carry -----------------------------
			let nextCollection: Collection | null | undefined
			if (args.collection !== undefined) {
				const trimmed = args.collection.trim()
				if (trimmed === 'null' || trimmed === '') {
					nextCollection = null
				} else {
					const parsed = parseJsonObject(args.collection, 'collection')
					if (!parsed.ok) return fail(parsed.error)
					try {
						nextCollection = collectionValidator.validate(parsed.value)
					} catch (error) {
						return fail(
							`collection is not valid: ${error instanceof Error ? error.message : 'invalid value'}. It needs {source, view, op, property} — read one off an existing shape with node.config.`
						)
					}
				}
			}

			// One `run`, so props and collection are a single undo step even when both change.
			editor.run(() => {
				editor.markHistoryStoppingPoint('agent: node.configure')
				if (nextProps) {
					editor.updateShape({ id: shape.id, type: shape.type, props: nextProps as never })
				}
				// `collectionPatch` rather than `setCollection`: that marks its own stopping point, which
				// would make configuring props and a collection together two undo steps.
				if (nextCollection !== undefined) editor.updateShape(collectionPatch(shape, nextCollection))
			})

			const updated = editor.getShape(shape.id)
			if (!updated) return fail('The shape disappeared while being configured.')

			const keys = configurableKeys(updated.type)
			return ok({
				id: updated.id,
				type: updated.type,
				config: keys ? currentConfig(updated, keys) : null,
				collection: (readCollection(updated) ?? null) as JsonValue,
			})
		},
	}),
]
