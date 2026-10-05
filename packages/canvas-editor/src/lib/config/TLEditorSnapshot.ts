import type { StoreSnapshot } from '@tldraw/store'
import type { TLRecord, TLStore } from '@tldraw/tlschema'
import {
	TLSessionStateSnapshot,
	createSessionStateSnapshotSignal,
	loadSessionStateSnapshotIntoStore,
} from './TLSessionStateSnapshot'

/**
 * A board as it is saved: the document, and this person's view of it (camera, selection, page).
 *
 * @public
 */
export interface TLEditorSnapshot {
	document: StoreSnapshot<TLRecord>
	session: TLSessionStateSnapshot
}

/** A store's document and session, for saving. @public */
export function getSnapshot(store: TLStore): TLEditorSnapshot {
	const session = createSessionStateSnapshotSignal(store).get()
	if (!session) throw Error('The store has no session state to save')
	return { document: store.getStoreSnapshot('document'), session }
}

/**
 * Loads a saved board into a store, migrating it first. Takes an editor snapshot (`getSnapshot`),
 * either half of one, or a plain store snapshot.
 *
 * @public
 */
export function loadSnapshot(
	store: TLStore,
	snapshot: Partial<TLEditorSnapshot> | StoreSnapshot<TLRecord>
): void {
	if ('store' in snapshot) {
		store.loadStoreSnapshot(snapshot)
		return
	}
	if (snapshot.document) store.loadStoreSnapshot(snapshot.document)
	if (snapshot.session) loadSessionStateSnapshotIntoStore(store, snapshot.session)
}
