import {
	BindingOnChangeOptions,
	BindingOnCreateOptions,
	BindingOnDeleteOptions,
	BindingOnShapeChangeOptions,
	BindingOnShapeDeleteOptions,
	BindingUtil,
	TLArrowBinding,
	TLArrowShape,
	TLBaseBinding,
	TLBindingId,
	TLShapeId,
	T,
	createShapeId,
	getArrowBindings,
} from '@lifeboard/canvas-editor'
import { TestEditor } from './TestEditor'

/**
 * Phase 3 of docs/canvas-fork-plan.md: binding records with an API of their own, and utils that
 * decide what a binding type does.
 */

type PinBinding = TLBaseBinding<'pin', { strength: number }>

/** A binding type of our own, which writes down every hook it hears. */
const heard: string[] = []
class PinBindingUtil extends BindingUtil<PinBinding> {
	static override type = 'pin'
	static override props = { strength: T.number }
	override getDefaultProps() {
		return { strength: 1 }
	}
	override onAfterCreate(_: BindingOnCreateOptions<PinBinding>) {
		heard.push('afterCreate')
	}
	override onAfterChange(_: BindingOnChangeOptions<PinBinding>) {
		heard.push('afterChange')
	}
	override onBeforeDelete(_: BindingOnDeleteOptions<PinBinding>) {
		heard.push('beforeDelete')
	}
	override onAfterDelete(_: BindingOnDeleteOptions<PinBinding>) {
		heard.push('afterDelete')
	}
	override onAfterChangeFromShape(_: BindingOnShapeChangeOptions<PinBinding>) {
		heard.push('afterChangeFromShape')
	}
	override onAfterChangeToShape(_: BindingOnShapeChangeOptions<PinBinding>) {
		heard.push('afterChangeToShape')
	}
	override onBeforeDeleteFromShape(_: BindingOnShapeDeleteOptions<PinBinding>) {
		heard.push('beforeDeleteFromShape')
	}
	override onBeforeDeleteToShape(_: BindingOnShapeDeleteOptions<PinBinding>) {
		heard.push('beforeDeleteToShape')
	}
}

let editor: TestEditor
const A = createShapeId('a')
const B = createShapeId('b')

beforeEach(() => {
	heard.length = 0
	editor = new TestEditor({ bindingUtils: [PinBindingUtil] })
	editor.createShapes([
		{ id: A, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } },
		{ id: B, type: 'geo', x: 300, y: 0, props: { w: 100, h: 100 } },
	])
})

afterEach(() => {
	editor?.dispose()
})

const pins = (shape: TLShapeId) => editor.getBindingsInvolvingShape<PinBinding>(shape, 'pin')

describe('the bindings API', () => {
	it('creates a binding with its util’s default props, and finds it from either end', () => {
		editor.createBinding<PinBinding>({ type: 'pin', fromId: A, toId: B })

		const [pin] = editor.getBindingsFromShape<PinBinding>(A, 'pin')
		expect(pin).toMatchObject({ typeName: 'binding', type: 'pin', fromId: A, toId: B, props: { strength: 1 } })
		expect(editor.getBindingsToShape<PinBinding>(B, 'pin')).toEqual([pin])
		expect(editor.getBindingsFromShape<PinBinding>(B, 'pin')).toEqual([])
		expect(editor.getBindingsInvolvingShape(A)).toEqual([pin])
		expect(editor.getBinding(pin!.id)).toEqual(pin)
		expect(heard).toEqual(['afterCreate'])
	})

	it('lists a binding from a shape to itself once', () => {
		editor.createBinding<PinBinding>({ type: 'pin', fromId: A, toId: A })
		expect(pins(A)).toHaveLength(1)
	})

	it('creates, updates and deletes as separate undo steps', () => {
		const id = 'binding:pin' as TLBindingId
		editor.mark('create')
		editor.createBinding<PinBinding>({ id, type: 'pin', fromId: A, toId: B })
		editor.mark('update')
		editor.updateBinding<PinBinding>({ id, type: 'pin', props: { strength: 5 }, meta: { note: 'x' } })
		expect(editor.getBinding<PinBinding>(id)).toMatchObject({ props: { strength: 5 }, meta: { note: 'x' } })
		editor.mark('delete')
		editor.deleteBinding(id)
		expect(editor.getBinding(id)).toBeUndefined()

		editor.undo()
		expect(editor.getBinding<PinBinding>(id)?.props.strength).toBe(5)
		editor.undo()
		expect(editor.getBinding<PinBinding>(id)?.props.strength).toBe(1)
		editor.undo()
		expect(editor.getBinding(id)).toBeUndefined()
		editor.redo().redo().redo()
		expect(editor.getBinding(id)).toBeUndefined()
		expect(heard).toEqual([
			'afterCreate',
			'afterChange',
			'beforeDelete',
			'afterDelete',
			'afterCreate', // undo of the delete
			'afterChange', // undo of the update
			'beforeDelete', // undo of the create
			'afterDelete',
			'afterCreate',
			'afterChange',
			'beforeDelete',
			'afterDelete',
		])
	})

	it('tells the util when the shape at either end changes', () => {
		editor.createBinding<PinBinding>({ type: 'pin', fromId: A, toId: B })
		heard.length = 0
		editor.updateShapes([{ id: A, type: 'geo', x: 10 }])
		editor.updateShapes([{ id: B, type: 'geo', x: 310 }])
		expect(heard).toEqual(['afterChangeFromShape', 'afterChangeToShape'])
	})

	it('deletes a shape’s bindings with it, telling the util first, and undo brings both back', () => {
		editor.createBinding<PinBinding>({ type: 'pin', fromId: A, toId: B })
		heard.length = 0
		editor.mark('delete')
		editor.deleteShapes([B])

		expect(pins(A)).toEqual([])
		expect(heard).toEqual(['beforeDeleteToShape', 'beforeDelete', 'afterDelete'])

		editor.undo()
		expect(editor.getShape(B)).toBeDefined()
		expect(pins(A)).toHaveLength(1)
		editor.redo()
		expect(pins(A)).toEqual([])
	})

	it('runs a binding’s after-delete hooks once the deleted shape is gone', () => {
		// Lifeboard's relations tell "the shape was deleted" from "the end was dragged off" this way.
		editor.createBinding<PinBinding>({ type: 'pin', fromId: A, toId: B })
		const shapeAtDelete: (object | undefined)[] = []
		editor.sideEffects.registerAfterDeleteHandler('binding', (binding) => {
			shapeAtDelete.push(editor.getShape(binding.toId))
		})
		editor.deleteShapes([B])
		expect(shapeAtDelete).toEqual([undefined])
	})
})

describe('arrows joined through the API', () => {
	/** Joins A and B the way Lifeboard's `connectShapes` does: an arrow, then two bindings. */
	function connect() {
		const arrowId = createShapeId('arrow')
		editor.createShapes([{ id: arrowId, type: 'arrow', x: 0, y: 0 }])
		const centre = { normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false, isPrecise: false }
		editor.createBindings<TLArrowBinding>([
			{ type: 'arrow', fromId: arrowId, toId: A, props: { terminal: 'start', ...centre } },
			{ type: 'arrow', fromId: arrowId, toId: B, props: { terminal: 'end', ...centre } },
		])
		return arrowId
	}

	const bounds = (id: TLShapeId) => editor.getShapePageBounds(id)!

	it('draws between the two shapes', () => {
		const arrowId = connect()
		const arrow = editor.getShape<TLArrowShape>(arrowId)!
		expect(getArrowBindings(editor, arrow)).toMatchObject({ start: { toId: A }, end: { toId: B } })
		expect(editor.getBindingsFromShape(arrowId, 'arrow')).toHaveLength(2)
		// From A's right edge to B's left edge, give or take the arrowhead's gap.
		expect(bounds(arrowId).minX).toBeGreaterThanOrEqual(95)
		expect(bounds(arrowId).maxX).toBeLessThanOrEqual(305)
	})

	it('follows either shape when it moves, and undo moves it back', () => {
		const arrowId = connect()
		const before = bounds(arrowId).clone()
		editor.mark('move')
		editor.updateShapes([{ id: B, type: 'geo', x: 300, y: 300 }])
		expect(bounds(arrowId).maxY).toBeGreaterThan(before.maxY + 100)
		editor.updateShapes([{ id: A, type: 'geo', x: -200 }])
		expect(bounds(arrowId).minX).toBeLessThan(before.minX - 100)

		editor.undo()
		expect(bounds(arrowId)).toCloselyMatchObject(before)
		editor.redo()
		expect(bounds(arrowId).maxY).toBeGreaterThan(before.maxY + 100)
	})

	it('keeps an end where it is drawn when its binding is deleted', () => {
		const arrowId = connect()
		const before = bounds(arrowId).clone()
		const end = editor.getArrowBinding(arrowId, 'end')!
		editor.mark('unbind')
		editor.deleteBinding(end)

		expect(editor.getArrowBinding(arrowId, 'end')).toBeUndefined()
		expect(bounds(arrowId)).toCloselyMatchObject(before)
		// No longer attached: moving B leaves the arrow alone.
		editor.updateShapes([{ id: B, type: 'geo', y: 400 }])
		expect(bounds(arrowId)).toCloselyMatchObject(before)

		editor.undo()
		expect(editor.getArrowBinding(arrowId, 'end')?.toId).toBe(B)
	})

	it('loses the binding, not the arrow, when a bound shape is deleted; undo restores both', () => {
		const arrowId = connect()
		editor.mark('delete')
		editor.deleteShapes([B])

		expect(editor.getShape(arrowId)).toBeDefined()
		expect(editor.getArrowBinding(arrowId, 'end')).toBeUndefined()
		// As in 2023, the end stays at the anchor it was bound to: B's centre.
		expect(bounds(arrowId).maxX).toBeCloseTo(350)

		editor.undo()
		expect(editor.getArrowBinding(arrowId, 'end')?.toId).toBe(B)
		editor.redo()
		expect(editor.getArrowBinding(arrowId, 'end')).toBeUndefined()
	})

	it('takes its bindings when the arrow is deleted', () => {
		const arrowId = connect()
		editor.mark('delete')
		editor.deleteShapes([arrowId])
		expect(editor.getBindingsToShape(A, 'arrow')).toEqual([])
		expect(editor.getBindingsToShape(B, 'arrow')).toEqual([])
		editor.undo()
		expect(editor.getBindingsFromShape(arrowId, 'arrow')).toHaveLength(2)
	})

	it('asks the target shape’s util whether it can be bound to', () => {
		const opts = { fromShapeType: 'arrow', toShapeType: 'geo', bindingType: 'arrow' }
		expect(editor.getShapeUtil('geo').canBind(opts)).toBe(true)
		expect(editor.getShapeUtil('arrow').canBind({ ...opts, toShapeType: 'arrow' })).toBe(false)
	})
})
