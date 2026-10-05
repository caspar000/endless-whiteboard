import { TLRecord, TLStore } from '@tldraw/tlschema'

/** @public */
export type TLBeforeCreateHandler<R extends TLRecord> = (record: R, source: 'remote' | 'user') => R
/** @public */
export type TLAfterCreateHandler<R extends TLRecord> = (
	record: R,
	source: 'remote' | 'user'
) => void
/** @public */
export type TLBeforeChangeHandler<R extends TLRecord> = (
	prev: R,
	next: R,
	source: 'remote' | 'user'
) => R
/** @public */
export type TLAfterChangeHandler<R extends TLRecord> = (
	prev: R,
	next: R,
	source: 'remote' | 'user'
) => void
/** @public */
export type TLBeforeDeleteHandler<R extends TLRecord> = (
	record: R,
	source: 'remote' | 'user'
) => void | false
/** @public */
export type TLAfterDeleteHandler<R extends TLRecord> = (
	record: R,
	source: 'remote' | 'user'
) => void
/** @public */
export type TLBatchCompleteHandler = () => void

/**
 * The side effect manager (aka a "correct state enforcer") is responsible
 * for making sure that the editor's state is always correct. This includes
 * things like: deleting a shape if its parent is deleted; unbinding
 * arrows when their binding target is deleted; etc.
 *
 * @public
 */
/**
 * Per-record-type reactions to store changes.
 *
 * In 2023 the store exposed one `onBeforeCreate`-style callback per kind of change, and this class fanned
 * them out by record type. Today's MIT store has that registry itself (`store.sideEffects`), so this
 * delegates to it and keeps only what the store doesn't do: the history's batch-complete callbacks.
 */
export class SideEffectManager<
	CTX extends {
		store: TLStore
		history: { onBatchComplete: () => void }
	}
> {
	constructor(public editor: CTX) {
		editor.history.onBatchComplete = () => {
			this._batchCompleteHandlers.forEach((fn) => fn())
		}
	}

	private _batchCompleteHandlers: TLBatchCompleteHandler[] = []

	registerBeforeCreateHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLBeforeCreateHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerBeforeCreateHandler(typeName, handler as never)
	}

	registerAfterCreateHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLAfterCreateHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerAfterCreateHandler(typeName, handler as never)
	}

	registerBeforeChangeHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLBeforeChangeHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerBeforeChangeHandler(typeName, handler as never)
	}

	registerAfterChangeHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLAfterChangeHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerAfterChangeHandler(typeName, handler as never)
	}

	registerBeforeDeleteHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLBeforeDeleteHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerBeforeDeleteHandler(typeName, handler as never)
	}

	registerAfterDeleteHandler<T extends TLRecord['typeName']>(
		typeName: T,
		handler: TLAfterDeleteHandler<TLRecord & { typeName: T }>
	) {
		return this.editor.store.sideEffects.registerAfterDeleteHandler(typeName, handler as never)
	}

	/** Called when the history finishes a batch of changes (an undoable step). */
	registerBatchCompleteHandler(handler: TLBatchCompleteHandler) {
		this._batchCompleteHandlers.push(handler)
		return () => {
			const i = this._batchCompleteHandlers.indexOf(handler)
			if (i >= 0) this._batchCompleteHandlers.splice(i, 1)
		}
	}
}

