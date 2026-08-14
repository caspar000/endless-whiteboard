/**
 * Vite's `?url` import, declared by hand so this package typechecks without depending on
 * `vite/client` types. The app's Vite build resolves it to the emitted worker asset's URL.
 */
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?url' {
	const url: string
	export default url
}
