/**
 * Vite's `?url` import, declared by hand so this package typechecks without depending on
 * `vite/client` types — the same arrangement as `pdf-worker.d.ts`, for the same reason.
 */
declare module 'node-unrar-js/esm/js/unrar.wasm?url' {
	const url: string
	export default url
}
