import type { TLDefaultShape, TLShapeId, TLUnknownShape } from '@tldraw/tlschema'

/**
 * Every shape the editor may hold: the default shapes, or any custom type.
 *
 * This is 2023's definition. Today's `@tldraw/tlschema` narrows `TLShape` to the types registered
 * through `TLGlobalShapePropsMap`, which the 2023 editor was not written for; everything the store holds
 * is still assignable to this one.
 */
export type TLShape = TLDefaultShape | TLUnknownShape

/** A shape with only its id and type required, as used for updates. 2023's definition, as above. */
export type TLShapePartial<T extends TLUnknownShape = TLShape> = T extends T
	? {
			id: TLShapeId
			type: T['type']
			props?: Partial<T['props']>
			meta?: Partial<T['meta']>
		} & Partial<Omit<T, 'type' | 'id' | 'props' | 'meta'>>
	: never
