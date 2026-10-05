import type { Store, UnknownRecord } from '@tldraw/store'
import { useEffect, useState } from 'react'
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
	  }

/**
 * A store kept in sync with the room at `uri`. Loading until the board arrives; a new store and
 * connection whenever `uri` or `createStore` changes, so keep `createStore` stable.
 */
export function useSyncedStore<R extends UnknownRecord, P>({
	uri,
	createStore,
}: {
	uri: string
	createStore: () => Store<R, P>
}): SyncedStore<Store<R, P>> {
	const [state, setState] = useState<SyncedStore<Store<R, P>>>({ status: 'loading' })

	useEffect(() => {
		const store = createStore()
		const client = new SyncClient({ store, socket: new ReconnectingWebSocket(uri) })
		const update = () => {
			const status = client.getStatus()
			if (status.status === 'synced') {
				setState({ status: 'synced-remote', connectionStatus: status.online ? 'online' : 'offline', store })
			} else if (status.status === 'error') {
				setState({ status: 'error', error: status.error })
			}
		}
		const unsubscribe = client.onStatusChange(update)
		return () => {
			unsubscribe()
			client.dispose()
			store.dispose()
			setState({ status: 'loading' })
		}
	}, [uri, createStore])

	return state
}
