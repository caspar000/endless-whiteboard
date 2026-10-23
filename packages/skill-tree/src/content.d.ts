/**
 * Vite's `?raw` import for the syllabus documents in content/, declared by hand so this package
 * typechecks without `vite/client` types (the same arrangement as book-reader's font assets). The
 * app's and the server's Vite builds inline the file as a string.
 */
declare module '*.yaml?raw' {
	const text: string
	export default text
}
