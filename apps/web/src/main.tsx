import { setAssetBridge, setNetworkBridge } from '@lifeboard/node-kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { createAssetBridge } from './persistence/assetStore'
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
