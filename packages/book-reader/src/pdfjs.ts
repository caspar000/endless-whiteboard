/// <reference path="./pdf-worker.d.ts" />
import type * as PdfjsModule from 'pdfjs-dist'

export type Pdfjs = typeof PdfjsModule

let pdfjsPromise: Promise<Pdfjs> | null = null

/**
 * pdf.js, loaded once and lazily — it is by far the heaviest thing this extension touches, and most
 * sessions never open a PDF. Both the library and its worker URL are dynamic imports, so neither
 * lands in the app's entry chunk; Vite emits the worker as its own asset via the `?url` import.
 */
export function loadPdfjs(): Promise<Pdfjs> {
	pdfjsPromise ??= Promise.all([
		import('pdfjs-dist'),
		import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
	]).then(([pdfjs, worker]) => {
		// An `.mjs` workerSrc makes pdf.js spawn the worker as a module worker on its own.
		pdfjs.GlobalWorkerOptions.workerSrc = worker.default
		return pdfjs
	})
	return pdfjsPromise
}
