import { RefreshCw, X } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import { isUpdateReady, reloadToUpdate, subscribeToUpdate } from './registerServiceWorker'

/**
 * A new version is waiting, said where it is seen when the sidebar (which says it too) is shut: on a
 * phone, where it always is, or on a wide screen with it collapsed. Put away, it waits for the sidebar.
 */
export function UpdateToast() {
	const ready = useSyncExternalStore(subscribeToUpdate, isUpdateReady)
	const [dismissed, setDismissed] = useState(false)
	if (!ready || dismissed) return null
	return (
		<div className="lb-update-toast lb-float" role="status" aria-live="polite">
			<button type="button" className="lb-update-toast__go" onClick={reloadToUpdate}>
				<RefreshCw size={15} aria-hidden="true" />
				<span>
					<strong>A new version is ready</strong> · Reload
				</span>
			</button>
			<button type="button" className="lb-update-toast__close" aria-label="Not now" onClick={() => setDismissed(true)}>
				<X size={14} aria-hidden="true" />
			</button>
		</div>
	)
}
