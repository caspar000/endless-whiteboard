import { setAssetBridge, setNetworkBridge } from '@lifeboard/node-kit'
import { refreshHealth, setHealthHost } from '@lifeboard/health'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { createAssetBridge } from './persistence/assetStore'
import { createHealthHost } from './persistence/healthCache'
import { PlatformProvider } from './platform/PlatformContext'
import { createWebPlatformAdapter } from './platform/WebPlatformAdapter'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import './styles.css'

const platform = createWebPlatformAdapter()
// Before the first render: extensions resolve `asset:` srcs from their components' first paint.
setAssetBridge(createAssetBridge(platform.blobs))
// Outbound requests stay behind the adapter, so the Tauri port swaps one implementation (§4.5).
setNetworkBridge({
	getJson: (url) => platform.fetchExternalJson(url),
	getBlob: (url) => platform.fetchExternalBlob(url),
})

// One lifecycle for the whole app, rather than a fetch loop in each card or each open board.
void setHealthHost(createHealthHost(platform)).then(() => refreshHealth())
const healthTimer = window.setInterval(() => { if (!document.hidden) void refreshHealth() }, 60_000)
const refreshHealthOnFocus = () => { void refreshHealth() }
window.addEventListener('focus', refreshHealthOnFocus)
window.addEventListener('online', refreshHealthOnFocus)
if (import.meta.hot) import.meta.hot.dispose(() => {
	window.clearInterval(healthTimer)
	window.removeEventListener('focus', refreshHealthOnFocus)
	window.removeEventListener('online', refreshHealthOnFocus)
})

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
	<StrictMode>
		<PlatformProvider platform={platform}>
			<App />
		</PlatformProvider>
	</StrictMode>
)

registerServiceWorker()
