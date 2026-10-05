import type { TLBinding, TLBindingId, TLShapeId, TLUnknownBinding } from '@tldraw/tlschema'

/**
 * A binding to create: the type and both ends, the rest optional. Props not given come from the
 * type's util.
 *
 * Shadows the schema package's version, which only accepts binding types registered in its type map;
 * the editor takes any type it has a util for.
 *
 * @public
 */
export type TLBindingCreate<B extends TLUnknownBinding = TLBinding> = B extends B
	? {
			id?: TLBindingId
			type: B['type']
			fromId: TLShapeId
			toId: TLShapeId
			props?: Partial<B['props']>
			meta?: Partial<B['meta']>
		}
	: never

/** A change to a binding: its id and type, and whatever else changes. As above, it shadows the schema's. @public */
export type TLBindingUpdate<B extends TLUnknownBinding = TLBinding> = B extends B
	? {
			id: TLBindingId
			type: B['type']
			fromId?: TLShapeId
			toId?: TLShapeId
			props?: Partial<B['props']>
			meta?: Partial<B['meta']>
		}
	: never
