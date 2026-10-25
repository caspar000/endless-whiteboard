/**
 * Vite's `?raw` import, for the tests that read the syllabi in syllabi/ and the fixtures in
 * fixtures/. Declared by hand so this package typechecks without `vite/client` types (the same
 * arrangement as book-reader's font assets).
 */
declare module '*.yaml?raw' {
	const text: string
	export default text
}
