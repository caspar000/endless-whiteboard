import { Tldraw, tipTapDefaultExtensions, type Editor, type TLTextOptions } from '@lifeboard/canvas'
import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import '@lifeboard/canvas-editor/editor.css'
import '@lifeboard/canvas/ui.css'
import { createRoot } from 'react-dom/client'
import { loadFixture } from './fixtures'
import { labMenuExtension } from './labExtension'

/**
 * The canvas fork on its own, persisted to this browser. `?board=<name>` picks a separate board;
 * `?fixture=<name>` shows a reference board instead, in memory only. `window.editor` is the test
 * seam, as in Lifeboard.
 */
const params = new URLSearchParams(location.search)
const board = params.get('board') ?? 'lab'
const fixture = params.get('fixture')
// The fork's icons, fonts and translations from this bundle, never from tldraw's CDN.
const assetUrls = getAssetUrlsByImport()

// An extension of our own on top of the defaults, as an app would add one. Module scope: a new
// object would remount the editor.
const textOptions: TLTextOptions = {
	tipTapConfig: { extensions: [...tipTapDefaultExtensions, labMenuExtension] },
}

const onMount = (editor: Editor) => {
	;(window as unknown as { editor: Editor }).editor = editor
}

const root = createRoot(document.getElementById('root')!)

if (fixture) {
	loadFixture(fixture).then(({ store, shapeUtils }) =>
		root.render(
			<Tldraw
				store={store}
				shapeUtils={shapeUtils}
				assetUrls={assetUrls}
				textOptions={textOptions}
				onMount={onMount}
			/>
		)
	)
} else {
	root.render(
		<Tldraw
			persistenceKey={`canvas-lab-${board}`}
			assetUrls={assetUrls}
			textOptions={textOptions}
			onMount={onMount}
		/>
	)
}
