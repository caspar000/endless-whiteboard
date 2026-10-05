import {
	createBindingId,
	TLArrowBinding,
	TLArrowShape,
	TLBindingId,
	TLShapeId,
	VecModel,
} from '@tldraw/tlschema'

/**
 * One end of an arrow, the way the 2023 editor thinks of it: either a free point, or attached to a
 * shape at a normalised anchor.
 *
 * Boards no longer store it like this. An arrow's `start` and `end` are always plain points now, and
 * an attachment is a separate `binding` record of type `arrow` carrying the same anchor fields
 * (docs/fork-parity.md D2). This type is rebuilt from those records on read, and translated back into
 * them on write, so the 2023 arrow code can keep reasoning in its own terms.
 */
export type TLArrowShapeTerminal =
	| { type: 'point'; x: number; y: number }
	| {
			type: 'binding'
			boundShapeId: TLShapeId
			normalizedAnchor: VecModel
			isExact: boolean
			isPrecise: boolean
	  }

export type TLArrowEnd = 'start' | 'end'

/** What these helpers need from the editor: the binding at one end of an arrow, if any. */
export interface TLArrowBindingLookup {
	getArrowBinding(arrowId: TLShapeId, end: TLArrowEnd): TLArrowBinding | undefined
}

export function getArrowTerminal(
	editor: TLArrowBindingLookup,
	arrow: TLArrowShape,
	end: TLArrowEnd
): TLArrowShapeTerminal {
	// A copy that already holds terminals keeps them. 2023 code passes such copies around and expects
	// what they hold, not what the store holds now.
	const held: unknown = arrow.props[end]
	if (isArrowTerminal(held)) return held
	const binding = editor.getArrowBinding(arrow.id, end)
	if (binding) {
		const { normalizedAnchor, isExact, isPrecise } = binding.props
		return { type: 'binding', boundShapeId: binding.toId, normalizedAnchor, isExact, isPrecise }
	}
	const { x, y } = arrow.props[end]
	return { type: 'point', x, y }
}

export function getArrowTerminals(editor: TLArrowBindingLookup, arrow: TLArrowShape) {
	return { start: getArrowTerminal(editor, arrow, 'start'), end: getArrowTerminal(editor, arrow, 'end') }
}

/** Whether a value written to an arrow's `start` or `end` is a 2023-style terminal, not a plain point. */
export function isArrowTerminal(value: unknown): value is TLArrowShapeTerminal {
	if (!value || typeof value !== 'object') return false
	const type = (value as { type?: unknown }).type
	return type === 'point' || type === 'binding'
}

export interface ArrowTerminalWrite {
	/** The props to store: every terminal replaced by a plain point. */
	props: Record<string, unknown>
	/** Binding records to create or overwrite. */
	put: TLArrowBinding[]
	/** Binding records to delete. */
	remove: TLBindingId[]
}

/**
 * Translates a write to an arrow's props that may hold 2023-style terminals into what today's records
 * hold: plain points on the arrow, and binding records beside it.
 *
 * A bound end keeps the arrow's previous point for that end. Nothing reads it while the binding
 * exists, and it is where the end stays if the binding goes away without a new point being written.
 */
export function resolveArrowTerminalWrite(
	editor: TLArrowBindingLookup,
	arrowId: TLShapeId,
	previous: Pick<TLArrowShape['props'], 'start' | 'end'> | undefined,
	props: Record<string, unknown>
): ArrowTerminalWrite {
	const next: Record<string, unknown> = { ...props }
	const put: TLArrowBinding[] = []
	const remove: TLBindingId[] = []

	for (const end of ['start', 'end'] as const) {
		const value = props[end]
		if (!isArrowTerminal(value)) continue
		const existing = editor.getArrowBinding(arrowId, end)

		if (value.type === 'point') {
			next[end] = { x: value.x, y: value.y }
			if (existing) remove.push(existing.id)
			continue
		}

		next[end] = previous ? { x: previous[end].x, y: previous[end].y } : { x: 0, y: 0 }
		put.push({
			id: existing?.id ?? createBindingId(),
			typeName: 'binding',
			type: 'arrow',
			fromId: arrowId,
			toId: value.boundShapeId,
			meta: existing?.meta ?? {},
			props: {
				terminal: end,
				normalizedAnchor: value.normalizedAnchor,
				isExact: value.isExact,
				isPrecise: value.isPrecise,
				// Elbow arrows (2023 had none) snap their ends; a new binding doesn't.
				snap: existing?.props.snap ?? 'none',
			},
		})
	}

	return { props: next, put, remove }
}
