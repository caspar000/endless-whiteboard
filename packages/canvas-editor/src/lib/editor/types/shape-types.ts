import type {
	TLArrowShape,
	TLDefaultShape,
	TLHandle as TLSchemaHandle,
	TLShapeId,
	TLUnknownShape,
	VecModel,
} from '@tldraw/tlschema'
import type { TLArrowShapeTerminal } from '../shapes/shared/arrow/terminals'

/**
 * Every shape the editor may hold: the default shapes, or any custom type.
 *
 * This is 2023's definition. Today's `@tldraw/tlschema` narrows `TLShape` to the types registered
 * through `TLGlobalShapePropsMap`, which the 2023 editor was not written for; everything the store holds
 * is still assignable to this one.
 */
export type TLShape = TLDefaultShape | TLUnknownShape

/**
 * What an arrow's props may hold when written: either end can be a 2023-style terminal, which
 * `createShapes` and `updateShapes` turn into a point and a binding record (docs/fork-parity.md D2).
 */
type TLArrowShapePropsOnWrite = Omit<TLArrowShape['props'], 'start' | 'end'> & {
	start: VecModel | TLArrowShapeTerminal
	end: VecModel | TLArrowShapeTerminal
}

/** A shape with only its id and type required, as used for updates. 2023's definition, as above. */
export type TLShapePartial<T extends TLUnknownShape = TLShape> = T extends T
	? {
			id: TLShapeId
			type: T['type']
			props?: Partial<T extends TLArrowShape ? TLArrowShapePropsOnWrite : T['props']>
			meta?: Partial<T['meta']>
		} & Partial<Omit<T, 'type' | 'id' | 'props' | 'meta'>>
	: never

/**
 * A shape's handle. Today's schema dropped `canBind`; the 2023 editor still reads it to decide whether
 * dragging a handle may attach it to another shape (only arrow ends can).
 */
export type TLHandle = TLSchemaHandle & { canBind?: boolean }
