import {
	TLArrowBinding,
	TLArrowShape,
	TLParentId,
	arrowBindingMigrations,
	arrowBindingProps,
} from '@tldraw/tlschema'
import { IndexKey, getIndexAbove, getIndexBetween } from '@tldraw/utils'
import type { Editor } from '../Editor'
import { getArrowTerminalsInArrowSpace } from '../shapes/shared/arrow/shared'
import type { TLShape } from '../types/shape-types'
import {
	BindingOnChangeOptions,
	BindingOnCreateOptions,
	BindingOnDeleteOptions,
	BindingOnShapeChangeOptions,
	BindingOnShapeDeleteOptions,
	BindingUtil,
} from './BindingUtil'

/**
 * Arrow bindings: an arrow end attached to a shape.
 *
 * The behaviour is the 2023 editor's, which ran it on every change to an arrow back when the
 * attachment was part of the arrow. An arrow follows its shapes by itself (its geometry is computed
 * from the bound shapes); what is here keeps the records sensible around it:
 *
 * - a binding to a shape that is gone, or on another page, is dropped and the end stays put;
 * - an arrow sits with the shapes it joins (their closest common parent) and just above them.
 *
 * @public
 */
export class ArrowBindingUtil extends BindingUtil<TLArrowBinding> {
	static override type = 'arrow'
	static override props = arrowBindingProps
	static override migrations = arrowBindingMigrations

	override getDefaultProps(): Partial<TLArrowBinding['props']> {
		return { isPrecise: false, isExact: false, normalizedAnchor: { x: 0.5, y: 0.5 }, snap: 'none' }
	}

	private arrow(binding: TLArrowBinding) {
		const arrow = this.editor.getShape(binding.fromId)
		return arrow && this.editor.isShapeOfType<TLArrowShape>(arrow, 'arrow') ? arrow : undefined
	}

	private update(binding: TLArrowBinding) {
		const arrow = this.arrow(binding)
		if (arrow) arrowDidUpdate(this.editor, arrow)
	}

	override onAfterCreate({ binding }: BindingOnCreateOptions<TLArrowBinding>) {
		this.update(binding)
	}

	override onAfterChange({ bindingAfter }: BindingOnChangeOptions<TLArrowBinding>) {
		this.update(bindingAfter)
	}

	override onAfterDelete({ binding }: BindingOnDeleteOptions<TLArrowBinding>) {
		this.update(binding)
	}

	/** The arrow itself changed: it may have left the bound shape's page. */
	override onAfterChangeFromShape({ binding }: BindingOnShapeChangeOptions<TLArrowBinding>) {
		this.update(binding)
	}

	/** A bound shape, or one of its ancestors, moved to a new parent: the arrow follows. */
	override onAfterChangeToShape({
		binding,
		shapeBefore,
		shapeAfter,
	}: BindingOnShapeChangeOptions<TLArrowBinding>) {
		if (shapeBefore !== shapeAfter && shapeBefore.parentId === shapeAfter.parentId) return
		reparentArrow(this.editor, binding.fromId)
	}

	/**
	 * A binding deleted on its own (through the API) leaves its end where it is drawn, instead of at
	 * whatever point the arrow stored before it was attached. When its shape is deleted, the 2023 rule
	 * below wins.
	 */
	override onBeforeDelete({ binding }: BindingOnDeleteOptions<TLArrowBinding>) {
		const arrow = this.arrow(binding)
		if (!arrow) return
		const { terminal } = binding.props
		const { x, y } = drawnEnd(this.editor, arrow, terminal)
		this.editor.store.put([{ ...arrow, props: { ...arrow.props, [terminal]: { x, y } } }])
	}

	/** The bound shape is going: the end stays where it was, unattached. */
	override onBeforeDeleteToShape({ binding }: BindingOnShapeDeleteOptions<TLArrowBinding>) {
		const arrow = this.arrow(binding)
		if (arrow) unbindArrowTerminal(this.editor, arrow, binding.props.terminal)
	}
}

function reparentArrow(editor: Editor, arrowId: TLArrowShape['id']) {
	const arrow = editor.getShape<TLArrowShape>(arrowId)
	if (!arrow) return
	const startBinding = editor.getArrowBinding(arrow.id, 'start')
	const endBinding = editor.getArrowBinding(arrow.id, 'end')
	const startShape = startBinding ? editor.getShape(startBinding.toId) : undefined
	const endShape = endBinding ? editor.getShape(endBinding.toId) : undefined

	const parentPageId = editor.getAncestorPageId(arrow)
	if (!parentPageId) return

	let nextParentId: TLParentId
	if (startShape && endShape) {
		// if arrow has two bindings, always parent arrow to closest common ancestor of the bindings
		nextParentId = editor.findCommonAncestor([startShape, endShape]) ?? parentPageId
	} else if (startShape || endShape) {
		const bindingParentId = (startShape || endShape)?.parentId
		// If the arrow and the shape that it is bound to have the same parent, then keep that parent
		if (bindingParentId && bindingParentId === arrow.parentId) {
			nextParentId = arrow.parentId
		} else {
			// if arrow has one binding, keep arrow on its own page
			nextParentId = parentPageId
		}
	} else {
		return
	}

	if (nextParentId && nextParentId !== arrow.parentId) {
		editor.reparentShapes([arrowId], nextParentId)
	}

	const reparentedArrow = editor.getShape<TLArrowShape>(arrowId)
	if (!reparentedArrow) throw Error('no reparented arrow')

	const startSibling = editor.getShapeNearestSibling(reparentedArrow, startShape)
	const endSibling = editor.getShapeNearestSibling(reparentedArrow, endShape)

	let highestSibling: TLShape | undefined

	if (startSibling && endSibling) {
		highestSibling = startSibling.index > endSibling.index ? startSibling : endSibling
	} else if (startSibling && !endSibling) {
		highestSibling = startSibling
	} else if (endSibling && !startSibling) {
		highestSibling = endSibling
	} else {
		return
	}

	let finalIndex: IndexKey

	const higherSiblings = editor.getSortedChildIdsForParent(highestSibling.parentId)
		.map((id) => editor.getShape(id)!)
		.filter((sibling) => sibling.index > highestSibling!.index)

	if (higherSiblings.length) {
		// there are siblings above the highest bound sibling, we need to
		// insert between them.

		// if the next sibling is also a bound arrow though, we can end up
		// all fighting for the same indexes. so lets find the next
		// non-arrow sibling...
		const nextHighestNonArrowSibling = higherSiblings.find(
			(sibling) => sibling.type !== 'arrow'
		)

		if (
			// ...then, if we're above the last shape we want to be above...
			reparentedArrow.index > highestSibling.index &&
			// ...but below the next non-arrow sibling...
			(!nextHighestNonArrowSibling || reparentedArrow.index < nextHighestNonArrowSibling.index)
		) {
			// ...then we're already in the right place. no need to update!
			return
		}

		// otherwise, we need to find the index between the highest sibling
		// we want to be above, and the next highest sibling we want to be
		// below:
		finalIndex = getIndexBetween(highestSibling.index, higherSiblings[0].index)
	} else {
		// if there are no siblings above us, we can just get the next index:
		finalIndex = getIndexAbove(highestSibling.index)
	}

	if (finalIndex !== reparentedArrow.index) {
		editor.updateShapes<TLArrowShape>([{ id: arrowId, type: 'arrow', index: finalIndex }])
	}
}

/** Where an end is drawn, in the arrow's space: at the bound shape's edge, not its anchor inside it. */
function drawnEnd(editor: Editor, arrow: TLArrowShape, end: 'start' | 'end') {
	const info = editor.getArrowInfo(arrow)
	return info?.isValid ? info[end].point : getArrowTerminalsInArrowSpace(editor, arrow)[end]
}

/**
 * Detaches an end whose shape is gone or on another page. As in 2023, the end is left at the anchor
 * it was bound to, the point the person aimed at. Straight to the store: this runs inside other
 * changes, not as its own undo step.
 */
function unbindArrowTerminal(editor: Editor, arrow: TLArrowShape, handleId: 'start' | 'end') {
	const { x, y } = getArrowTerminalsInArrowSpace(editor, arrow)[handleId]
	const binding = editor.getArrowBinding(arrow.id, handleId)
	if (binding) editor.store.remove([binding.id])
	editor.store.put([{ ...arrow, props: { ...arrow.props, [handleId]: { x, y } } }])
}

function arrowDidUpdate(editor: Editor, arrow: TLArrowShape) {
	// if the shape is an arrow and its bound shape is on another page
	// or was deleted, unbind it
	for (const handle of ['start', 'end'] as const) {
		const binding = editor.getArrowBinding(arrow.id, handle)
		if (!binding) continue
		const boundShape = editor.getShape(binding.toId)
		const isShapeInSamePageAsArrow =
			editor.getAncestorPageId(arrow) === editor.getAncestorPageId(boundShape)
		if (!boundShape || !isShapeInSamePageAsArrow) {
			unbindArrowTerminal(editor, arrow, handle)
		}
	}

	// always check the arrow parents
	reparentArrow(editor, arrow.id)
}
