import { react, type Signal } from '@tldraw/state'
import type { Store, UnknownRecord } from '@tldraw/store'
import { useEffect, useState } from 'react'
import type { SyncCache } from './cache.ts'
import { ReconnectingWebSocket } from './ReconnectingWebSocket.ts'
import { SyncClient } from './SyncClient.ts'

/** The same shape as the editor's `TLStoreWithStatus`, so it can be handed to `<Tldraw store>`. */
export type SyncedStore<S> =
	| { readonly status: 'loading'; readonly store?: undefined; readonly error?: undefined }
	| { readonly status: 'error'; readonly error: Error; readonly store?: undefined }
	| {
			readonly status: 'synced-remote'
			readonly connectionStatus: 'online' | 'offline'
			readonly store: S
			readonly error?: undefined
			/** Records with edits the server hasn't confirmed: kept on this device until it does. */
			readonly unsent: number
			/** Edits the server refused this session (and which were taken back). */
			readonly refused: number
	  }

/**
 * A store kept in sync with the room at `uri`. Loading until the board arrives, from the server or
 * from `createCache`'s copy on this device; a new store and connection whenever `uri`, `createStore`
 * or `createCache` changes, so keep them stable.
 */
export function useSyncedStore<R extends UnknownRecord, P>({
	uri,
	createStore,
	createCache,
	getPresence,
}: {
	uri: string
	createStore: () => Store<R, P>
	createCache?: () => SyncCache<R>
	/** This tab's presence on the board (cursor, selection, name), sent to the others as it changes. */
	getPresence?: (store: Store<R, P>) => Signal<R | null>
}): SyncedStore<Store<R, P>> {
	const [state, setState] = useState<SyncedStore<Store<R, P>>>({ status: 'loading' })

	useEffect(() => {
		const store = createStore()
		const client = new SyncClient({ store, socket: new ReconnectingWebSocket(uri), cache: createCache?.() })
		const update = () => {
			const status = client.getStatus()
			if (status.status === 'synced') {
				setState({
					status: 'synced-remote',
					connectionStatus: status.online ? 'online' : 'offline',
					store,
					unsent: status.unsent,
					refused: status.refused,
				})
			} else if (status.status === 'error') {
				setState({ status: 'error', error: status.error })
			}
		}
		const unsubscribe = client.onStatusChange(update)
		const $presence = getPresence?.(store)
		const stopPresence = $presence ? react('send presence', () => client.setPresence($presence.get())) : () => {}
		// The last edits are still waiting to be written when the tab closes or goes to the background.
		const flush = () => client.flush()
		const onHidden = () => {
			if (document.visibilityState === 'hidden') flush()
		}
		window.addEventListener('pagehide', flush)
		document.addEventListener('visibilitychange', onHidden)
		return () => {
			window.removeEventListener('pagehide', flush)
			document.removeEventListener('visibilitychange', onHidden)
			unsubscribe()
			stopPresence()
			client.dispose()
			store.dispose()
			setState({ status: 'loading' })
		}
	}, [uri, createStore, createCache, getPresence])

	return state
}
