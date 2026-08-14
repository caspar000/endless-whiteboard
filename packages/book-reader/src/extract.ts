// Ambient declarations for the untyped deps. Referenced explicitly (not just co-located) so that
// consumers compiling this source in *their* program — the app does — pick them up too.
/// <reference path="./foliate-js.d.ts" />
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { formatContributors, formatLanguageMap, type BookFormat } from './formats'
import { loadPdfjs } from './pdfjs'

/** What a book file yields beyond its bytes. Empty string / 0 / null mean "not present". */
export interface BookInfo {
	title: string
	author: string
	/** Only PDFs know this up front; reflowable formats have no fixed page count. */
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
	return format === 'pdf' ? extractPdfInfo(file) : extractFoliateInfo(file)
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
	const { makeBook } = await import('foliate-js/view.js')
	const book = await makeBook(file)
	const metadata = book.metadata ?? {}
	let cover: Blob | null = null
	try {
		cover = (await book.getCover?.()) ?? null
	} catch {
		// A corrupt cover entry must not sink the import — the jacket placeholder covers for it.
	}
	return {
		title: formatLanguageMap(metadata.title),
		author: formatContributors(metadata.author),
		pageCount: 0,
		cover,
	}
}
