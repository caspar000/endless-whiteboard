import { atom } from '@tldraw/state'

/**
 * Which renderer draws the shapes (docs/gpu-renderer-plan.md): `dom`, the page, as it always has;
 * `gpu`, the WebGL layer for every shape it can draw; `auto`, the page until there are too many
 * shapes on screen, then the GPU. The parity checks force one or the other to compare them.
 *
 * Read from `?renderer=` first, then `localStorage` (`lifeboard:renderer`); `auto` otherwise. It can
 * be changed at runtime, which is how a test renders one board both ways without reloading.
 */
export type RendererMode = 'dom' | 'gpu' | 'auto'

export const RENDERER_STORAGE_KEY = 'lifeboard:renderer'

const isMode = (v: unknown): v is RendererMode => v === 'dom' || v === 'gpu' || v === 'auto'

function initialMode(): RendererMode {
	try {
		const fromUrl = new URLSearchParams(globalThis.location?.search ?? '').get('renderer')
		if (isMode(fromUrl)) return fromUrl
		const stored = globalThis.localStorage?.getItem(RENDERER_STORAGE_KEY)
		if (isMode(stored)) return stored
	} catch {
		// No location or storage (tests, workers): the default.
	}
	return 'auto'
}

const mode = atom<RendererMode>('rendererMode', initialMode())

/** The renderer asked for, read reactively. */
export const getRendererMode = (): RendererMode => mode.get()

/** Asks for a renderer; `remember` keeps it across reloads. */
export function setRendererMode(next: RendererMode, remember = false): void {
	mode.set(next)
	if (!remember) return
	try {
		globalThis.localStorage?.setItem(RENDERER_STORAGE_KEY, next)
	} catch {
		// Storage unavailable: it lasts for this page only.
	}
}
