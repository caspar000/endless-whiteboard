// Ambient declarations for the untyped deps. Referenced explicitly (not just co-located) so that
// consumers compiling this source in *their* program — the app does — pick them up too.
/// <reference path="./foliate-js.d.ts" />
import type { PDFDocumentProxy } from 'pdfjs-dist'
import {
	detectBookFormat,
	formatContributors,
	formatLanguageMap,
	isRarArchive,
	type BookFormat,
} from './formats'
import { openBook } from './openBook'
import { loadPdfjs } from './pdfjs'

/** What a book file yields beyond its bytes. Empty string / 0 / null mean "not present". */
export interface BookInfo {
	title: string
	author: string
	/** Only paginated formats know this up front; reflowable ones have no fixed page count. */
	pageCount: number
	/** Rendered first page (PDF) or embedded cover image (everything else). */
	cover: Blob | null
}

/**
 * Cover renders are capped at this width: big enough to stay sharp as a card on the canvas, small
 * enough that a board of fifty books doesn't hoard megabytes of thumbnails. Embedded EPUB covers are
 * stored as-is — they are already sized as covers.
 */
const COVER_RENDER_WIDTH = 480

export async function extractBookInfo(file: File, format: BookFormat): Promise<BookInfo> {
	if (format === 'pdf') return extractPdfInfo(file)
	// Sniffed rather than taken from the format, because a CBR is not reliably a RAR and a CBZ is not
	// reliably a zip. The cost is six bytes off the front of every book that isn't a PDF.
	if (await isRarArchive(file)) return extractRarInfo(file)
	return extractFoliateInfo(file)
}

/**
 * A comic in a RAR, which is the one case worth keeping off the general path: unpacking a whole
 * archive to put one image on a card is not a trade worth making, and the RAR reader can lift a
 * single page out without touching the rest.
 */
async function extractRarInfo(file: File): Promise<BookInfo> {
	const { readRarComicInfo } = await import('./cbr')
	const { pageCount, cover } = await readRarComicInfo(file)
	// A comic archive carries no metadata of its own, so the card keeps the title the import already
	// derived from the file name — and "Find book details…" is there for the rest.
	return { title: '', author: '', pageCount, cover }
}

async function extractPdfInfo(file: File): Promise<BookInfo> {
	const pdfjs = await loadPdfjs()
	// v6 lifecycle: `destroy` lives on the loading task, not the document proxy.
	const task = pdfjs.getDocument({ data: await file.arrayBuffer() })
	const doc = await task.promise
	try {
		let title = ''
		let author = ''
		try {
			const { info } = await doc.getMetadata()
			const fields = info as { Title?: unknown; Author?: unknown }
			if (typeof fields.Title === 'string') title = fields.Title.trim()
			if (typeof fields.Author === 'string') author = fields.Author.trim()
		} catch {
			// Metadata is optional in the spec; a file without it still gets a cover and page count.
		}

		return { title, author, pageCount: doc.numPages, cover: await renderFirstPage(doc) }
	} finally {
		await task.destroy()
	}
}

/** PDFs have no cover image — the first page, rendered small, is the honest equivalent. */
async function renderFirstPage(doc: PDFDocumentProxy): Promise<Blob | null> {
	try {
		const page = await doc.getPage(1)
		const base = page.getViewport({ scale: 1 })
		const viewport = page.getViewport({ scale: COVER_RENDER_WIDTH / base.width })

		const canvas = document.createElement('canvas')
		canvas.width = Math.ceil(viewport.width)
		canvas.height = Math.ceil(viewport.height)
		const canvasContext = canvas.getContext('2d')
		if (!canvasContext) return null

		await page.render({ canvas, canvasContext, viewport }).promise
		// JPEG, not PNG: page renders are continuous-tone, and the cover is purely cosmetic.
		return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85))
	} catch {
		return null
	}
}

async function extractFoliateInfo(file: File): Promise<BookInfo> {
	const book = await openBook(file)
	const metadata = book.metadata ?? {}
	let cover: Blob | null = null
	try {
		cover = (await book.getCover?.()) ?? null
	} catch {
		// A corrupt cover entry must not sink the import — the jacket placeholder covers for it.
	}
	return {
		title: bookTitle(metadata.title),
		author: formatContributors(metadata.author),
		// A pre-paginated book — a comic, a fixed-layout EPUB — is a stack of pages, one per section,
		// and can be counted before it is opened. A reflowable one genuinely has no page count until
		// it is laid out, which is what the reader's synthetic locations are for.
		pageCount: book.rendition?.layout === 'pre-paginated' ? (book.sections?.length ?? 0) : 0,
		cover,
	}
}

/**
 * foliate names a comic after its file, extension and all, when the archive says nothing. That is
 * not a title — and it is strictly worse than the one the import derived from the same string, so
 * a "title" that is still a file name is read as no title at all.
 */
function bookTitle(value: unknown): string {
	const title = formatLanguageMap(value)
	return detectBookFormat(title) ? '' : title
}
