/**
 * Vite's `?url` import for the bundled reading fonts, declared by hand for the same reason as the
 * pdf.js worker: so this package typechecks without depending on `vite/client` types. The app's
 * Vite build resolves each to the emitted, content-hashed font asset's URL.
 */
declare module '*.woff2?url' {
	const url: string
	export default url
}
