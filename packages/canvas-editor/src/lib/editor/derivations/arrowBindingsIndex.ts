import { Computed, computed } from '@tldraw/state'
import { TLArrowBinding, TLShapeId } from '@tldraw/tlschema'
import { Editor } from '../Editor'

export type TLArrowBindingsIndex = Record<
	TLShapeId,
	undefined | { arrowId: TLShapeId; handleId: 'start' | 'end' }[]
>

/**
 * Which arrows are attached to each shape.
 *
 * In 2023 an arrow kept its connection in its own `start`/`end` props, and this walked every arrow.
 * Boards now store connections as `binding` records of type `arrow` (`fromId` the arrow, `toId` the
 * shape, `props.terminal` the end), so the index is built from those (docs/fork-parity.md D2).
 * Rebuilt whenever a binding changes; there are few enough that this is cheaper than an incremental
 * diff.
 */
export const arrowBindingsIndex = (editor: Editor): Computed<TLArrowBindingsIndex> => {
	const bindingQuery = editor.store.query.records('binding', () => ({ type: { eq: 'arrow' as const } }))
	return computed<TLArrowBindingsIndex>('arrowBindingsIndex', () => {
		const index: TLArrowBindingsIndex = {}
		for (const binding of bindingQuery.get() as TLArrowBinding[]) {
			const entry = { arrowId: binding.fromId, handleId: binding.props.terminal }
			const arrows = index[binding.toId]
			if (arrows) arrows.push(entry)
			else index[binding.toId] = [entry]
		}
		return index
	})
}

export type TLArrowBindingsByArrow = Record<TLShapeId, undefined | { start?: TLArrowBinding; end?: TLArrowBinding }>

/** The binding at each end of each arrow: the other direction of {@link arrowBindingsIndex}. */
export const arrowBindingsByArrow = (editor: Editor): Computed<TLArrowBindingsByArrow> => {
	const bindingQuery = editor.store.query.records('binding', () => ({ type: { eq: 'arrow' as const } }))
	return computed<TLArrowBindingsByArrow>('arrowBindingsByArrow', () => {
		const index: TLArrowBindingsByArrow = {}
		for (const binding of bindingQuery.get() as TLArrowBinding[]) {
			const ends = (index[binding.fromId] ??= {})
			ends[binding.props.terminal] = binding
		}
		return index
	})
}
