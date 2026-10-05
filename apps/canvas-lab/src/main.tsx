import { Tldraw, type Editor } from '@lifeboard/canvas'
import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import '@lifeboard/canvas-editor/editor.css'
import '@lifeboard/canvas/ui.css'
import { createRoot } from 'react-dom/client'

/**
 * The canvas fork on its own, persisted to this browser. `?board=<name>` picks a separate board;
 * `window.editor` is the test seam, as in Lifeboard.
 */
const board = new URLSearchParams(location.search).get('board') ?? 'lab'
// The fork's icons, fonts and translations from this bundle, never from tldraw's CDN.
const assetUrls = getAssetUrlsByImport()

createRoot(document.getElementById('root')!).render(
	<Tldraw
		persistenceKey={`canvas-lab-${board}`}
		assetUrls={assetUrls}
		onMount={(editor: Editor) => {
			;(window as unknown as { editor: Editor }).editor = editor
		}}
	/>
)
