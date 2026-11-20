/**
 * Vite's `?raw` import, for the tests that read the feeds in fixtures/. Declared by hand so this
 * package typechecks without `vite/client` types (the same arrangement as the syllabus's).
 */
declare module '*.xml?raw' {
	const text: string
	export default text
}
