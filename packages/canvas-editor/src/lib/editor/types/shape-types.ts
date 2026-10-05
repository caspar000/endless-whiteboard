import type {
	TLArrowShape,
	TLHandle as TLSchemaHandle,
	TLShape as TLSchemaShape,
	TLShapeId,
	TLUnknownShape,
	VecModel,
} from '@tldraw/tlschema'
import type { TLArrowShapeTerminal } from '../shapes/shared/arrow/terminals'

/**
 * Every shape type registered in the schema's `TLGlobalShapePropsMap`: the default shapes, and any an
 * app adds by augmenting that map, as tldraw 5 does (Lifeboard registers its nodes so). Checking
 * `shape.type` narrows the props.
 *
 * 2023's `TLShape` also took shapes of any type. Code that handles unregistered types, such as a
 * `ShapeUtil` for a test shape, uses `TLUnknownShape`.
 */
export type TLShape = TLSchemaShape

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
