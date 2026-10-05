import type { MigrationSequence } from '@tldraw/store'
import type { RecordProps, TLPropsMigrations, TLUnknownBinding } from '@tldraw/tlschema'
import type { Editor } from '../Editor'
import type { TLShape } from '../types/shape-types'

/**
 * A binding util class, as passed to the editor and to `createTLStore`.
 *
 * @public
 */
export interface TLBindingUtilConstructor<
	B extends TLUnknownBinding,
	U extends BindingUtil<B> = BindingUtil<B>,
> {
	new (editor: Editor): U
	type: B['type']
	props?: RecordProps<B>
	migrations?: TLPropsMigrations | MigrationSequence
}

/** @public */
export interface BindingOnCreateOptions<B extends TLUnknownBinding> {
	binding: B
}

/** @public */
export interface BindingOnChangeOptions<B extends TLUnknownBinding> {
	bindingBefore: B
	bindingAfter: B
}

/** @public */
export interface BindingOnDeleteOptions<B extends TLUnknownBinding> {
	binding: B
}

/** @public */
export interface BindingOnShapeChangeOptions<B extends TLUnknownBinding> {
	binding: B
	shapeBefore: TLShape
	shapeAfter: TLShape
}

/** @public */
export interface BindingOnShapeDeleteOptions<B extends TLUnknownBinding> {
	binding: B
	shape: TLShape
}

/**
 * What one type of binding means and how it reacts to the shapes at either end.
 *
 * A binding record joins a shape (`fromId`, the arrow for arrow bindings) to another (`toId`). The
 * editor stores and deletes the records; a util decides what happens around them. Every hook runs
 * inside the change that triggered it, so what it writes is part of the same undo step.
 *
 * When a shape is deleted, the editor first calls the `onBeforeDelete…FromShape`/`…ToShape` hooks
 * of every binding involving it, then deletes those bindings. Nothing here is required beyond the
 * default props.
 *
 * @public
 */
export abstract class BindingUtil<Binding extends TLUnknownBinding = TLUnknownBinding> {
	constructor(public editor: Editor) {}
	static props?: RecordProps<TLUnknownBinding>
	static migrations?: TLPropsMigrations | MigrationSequence

	/** The type of binding this util handles; matches the records' `type`. */
	static type: string

	/** The props a new binding of this type starts with. */
	abstract getDefaultProps(): Partial<Binding['props']>

	onAfterCreate?(options: BindingOnCreateOptions<Binding>): void
	onAfterChange?(options: BindingOnChangeOptions<Binding>): void
	onBeforeDelete?(options: BindingOnDeleteOptions<Binding>): void
	onAfterDelete?(options: BindingOnDeleteOptions<Binding>): void

	/** The shape the binding starts from (`fromId`) changed. */
	onAfterChangeFromShape?(options: BindingOnShapeChangeOptions<Binding>): void
	/** The shape the binding points to (`toId`) changed. */
	onAfterChangeToShape?(options: BindingOnShapeChangeOptions<Binding>): void
	/** The shape the binding starts from is about to be deleted; the binding goes next. */
	onBeforeDeleteFromShape?(options: BindingOnShapeDeleteOptions<Binding>): void
	/** The shape the binding points to is about to be deleted; the binding goes next. */
	onBeforeDeleteToShape?(options: BindingOnShapeDeleteOptions<Binding>): void
}
