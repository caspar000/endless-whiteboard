import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { PlatformProvider } from './platform/PlatformContext'
import { createWebPlatformAdapter } from './platform/WebPlatformAdapter'
import { registerServiceWorker } from './pwa/registerServiceWorker'
import './styles.css'

const platform = createWebPlatformAdapter()

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
