import {
	createTLStore,
	defaultBindingUtils,
	defaultShapeUtils,
	Tldraw,
	tipTapDefaultExtensions,
	type Editor,
	type TLTextOptions,
} from '@lifeboard/canvas'
import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import '@lifeboard/canvas-editor/editor.css'
import '@lifeboard/canvas/ui.css'
import { useSyncedStore } from '@lifeboard/canvas-sync/react'
import { createRoot } from 'react-dom/client'
import { loadFixture } from './fixtures'
import { labMenuExtension } from './labExtension'

/**
 * The canvas fork on its own, persisted to this browser. `?board=<name>` picks a separate board;
 * `?fixture=<name>` shows a reference board instead, in memory only, and `?lifeboard=<name>` shows one
 * with Lifeboard's real node types (see lifeboard.tsx). `?sync=<room>` keeps a board in sync with the
 * lab's sync server instead (`pnpm sync-server`; `&syncPort=` if it isn't on 5192). `window.editor` is
 * the test seam, as in Lifeboard.
 */
const params = new URLSearchParams(location.search)
const board = params.get('board') ?? 'lab'
const fixture = params.get('fixture')
const lifeboard = params.get('lifeboard')
const syncRoom = params.get('sync')
const syncPort = params.get('syncPort') ?? '5192'
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

const createSyncedStore = () => createTLStore({ shapeUtils: defaultShapeUtils, bindingUtils: defaultBindingUtils })

function SyncedLab({ room }: { room: string }) {
	const store = useSyncedStore({
		uri: `ws://${location.hostname}:${syncPort}/sync/${room}`,
		createStore: createSyncedStore,
	})
	return <Tldraw store={store} assetUrls={assetUrls} textOptions={textOptions} onMount={onMount} />
}

const root = createRoot(document.getElementById('root')!)

if (lifeboard) {
	// Loaded only when asked for, so the plain lab doesn't load Lifeboard's packages.
	import('./lifeboard.tsx').then(async ({ renderLifeboard }) =>
		root.render(await renderLifeboard(lifeboard, { assetUrls, onMount }))
	)
} else if (syncRoom) {
	root.render(<SyncedLab room={syncRoom} />)
} else if (fixture) {
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
