import { Tldraw, tipTapDefaultExtensions, type Editor, type TLTextOptions } from '@lifeboard/canvas'
import { getAssetUrlsByImport } from '@lifeboard/canvas-assets/imports'
import '@lifeboard/canvas-editor/editor.css'
import '@lifeboard/canvas/ui.css'
import type { ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { loadFixture } from './fixtures'
import { labMenuExtension } from './labExtension'

/**
 * The canvas fork on its own, persisted to this browser. `?board=<name>` picks a separate board;
 * `?fixture=<name>` shows a reference board instead, in memory only, and `?lifeboard=<name>` shows one
 * with Lifeboard's real node types (see lifeboard.tsx). `window.editor` is the test seam, as in
 * Lifeboard.
 */
const params = new URLSearchParams(location.search)
const board = params.get('board') ?? 'lab'
const fixture = params.get('fixture')
const lifeboard = params.get('lifeboard')
// The fork's icons, fonts and translations from this bundle, never from tldraw's CDN.
const assetUrls = getAssetUrlsByImport()

// An extension of our own on top of the defaults, as an app would add one. Module scope: a new
// object would remount the editor.
const textOptions: TLTextOptions = {
	tipTapConfig: { extensions: [...tipTapDefaultExtensions, labMenuExtension] },
}

type RenderLifeboard = (
	name: string,
	props: { assetUrls: object; onMount(editor: Editor): void }
) => Promise<ReactElement>

const onMount = (editor: Editor) => {
	;(window as unknown as { editor: Editor }).editor = editor
}

const root = createRoot(document.getElementById('root')!)

if (lifeboard) {
	// Through a path the compiler doesn't follow: Lifeboard's packages need the workspace's stricter
	// compiler settings, the fork's own files upstream's looser ones (F5), and one program can't have
	// both. `pnpm typecheck:on-fork` checks those packages against the fork instead.
	const lifeboardModule: string = './lifeboard.tsx'
	import(/* @vite-ignore */ lifeboardModule).then(
		async ({ renderLifeboard }: { renderLifeboard: RenderLifeboard }) =>
			root.render(await renderLifeboard(lifeboard, { assetUrls, onMount }))
	)
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
