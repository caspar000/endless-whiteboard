/// <reference path="./foliate-js.d.ts" />
/// <reference path="./unrar-wasm.d.ts" />
import type { Extractor, FileHeader } from 'node-unrar-js'
import type { FoliateBook } from 'foliate-js/view.js'

/**
 * CBR — a comic book in a RAR archive, and the one format foliate-js cannot open for itself.
 *
 * Every other book this extension reads arrives in a container foliate already understands: EPUB,
 * FBZ and CBZ are zips, which it has vendored a reader for. RAR is proprietary, has no browser
 * support, and shares nothing with zip, so the archive is unpacked here — through the official
 * unrar sources compiled to wasm — and handed to foliate's *comic* reader as an already-opened
 * book. From that point a CBR and a CBZ are the same thing: same fixed-layout renderer, same page
 * turns, same position CFIs, same quotes.
 */

/**
 * The image types foliate's `comic-book.js` will page through, mapped to what to label the blob.
 * Kept in step with its list deliberately: a page it will not show is not a page, and counting one
 * here would put a cover on the card that the reader never opens to.
 */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
	jpg: 'image/jpeg',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	bmp: 'image/bmp',
	webp: 'image/webp',
	svg: 'image/svg+xml',
	jxl: 'image/jxl',
	avif: 'image/avif',
}

/** Reading order. Numeric collation, so page 10 follows page 9 rather than page 1 — as foliate sorts. */
const byName = new Intl.Collator([], { numeric: true }).compare

/**
 * A page, as something the rest of the app can hold on to.
 *
 * The cast is to `Uint8Array`'s buffer parameter, not away from a type: unrar declares its output as
 * a bare `Uint8Array`, which since TypeScript 5.7 means "over any buffer, shared included", and
 * `Blob` will not take a shared one. Nothing here is shared — the module writes into buffers it
 * allocated itself. Constructing the blob also copies, which is the point: the bytes handed back
 * belong to the extractor, and the extractor is finished with before these are read.
 */
function pageBlob(bytes: Uint8Array, type: string): Blob {
	return new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
}

function imageType(name: string): string | null {
	const dot = name.lastIndexOf('.')
	return dot < 0 ? null : (IMAGE_TYPES[name.slice(dot + 1).toLowerCase()] ?? null)
}

/** The archive's pages, in reading order — a `ComicInfo.xml` or a stray thumbnail is not one. */
function imagePages(headers: Iterable<FileHeader>): string[] {
	const names: string[] = []
	for (const header of headers) {
		if (!header.flags.directory && imageType(header.name)) names.push(header.name)
	}
	return names.sort(byName)
}

let wasm: Promise<ArrayBuffer> | null = null

/**
 * The unrar module's wasm, fetched once and only when a RAR is actually opened.
 *
 * The bytes are handed over explicitly rather than left to the module to find: an emscripten build
 * locating its own `.wasm` looks beside the *script*, which after bundling is not where Vite puts
 * the asset. `?url` is the same lever `pdfjs.ts` pulls for the pdf.js worker.
 */
function unrarWasm(): Promise<ArrayBuffer> {
	wasm ??= import('node-unrar-js/esm/js/unrar.wasm?url')
		.then(({ default: url }) => fetch(url))
		.then((response) => response.arrayBuffer())
	return wasm
}

/**
 * One archive at a time.
 *
 * `node-unrar-js` compiles to a single wasm instance and reaches back into JS through one global
 * slot naming the extractor being read — whichever was created last. Two archives open at once
 * would read each other's bytes, and dropping three comics on a board opens three. So every use of
 * the module is queued: opened, read to the end, and done with before the next one starts.
 */
let queue: Promise<unknown> = Promise.resolve()

function withArchive<T>(
	file: File,
	work: (extractor: Extractor<Uint8Array>) => T | Promise<T>
): Promise<T> {
	const run = async () => {
		const [{ createExtractorFromData }, wasmBinary] = await Promise.all([
			import('node-unrar-js'),
			unrarWasm(),
		])
		const data = await file.arrayBuffer()
		return work(await createExtractorFromData({ wasmBinary, data }))
	}
	const next = queue.then(run, run)
	// The queue is a baton, not a result: one unreadable archive must not fail the next.
	queue = next.catch(() => {})
	return next
}

/** What a CBR can say about itself on import. */
export interface RarComicInfo {
	pageCount: number
	/** The first page, or null for an archive with no pages in it. */
	cover: Blob | null
}

/**
 * Reads the cover and the page count without unpacking the comic.
 *
 * The file listing costs no decompression at all, and a card needs exactly one page rendered on it
 * — so dropping a 200 MB comic on the board unpacks one image, not two hundred. The reader pays
 * the full cost later, and only if the comic is opened.
 */
export function readRarComicInfo(file: File): Promise<RarComicInfo> {
	return withArchive(file, (extractor) => {
		const pages = imagePages(extractor.getFileList().fileHeaders)
		const first = pages[0]
		if (!first) return { pageCount: 0, cover: null }

		let cover: Blob | null = null
		// Read to the generator's own end rather than breaking out of it: closing the archive — and
		// freeing the C++ handle behind it — is the last thing the generator does.
		for (const { fileHeader, extraction } of extractor.extract({ files: [first] }).files) {
			if (extraction && fileHeader.name === first) {
				cover = pageBlob(extraction, imageType(first) ?? '')
			}
		}
		return { pageCount: pages.length, cover }
	})
}

/**
 * How many pages to unpack before handing the frame back. Unpacking runs synchronously inside the
 * wasm module, so a long comic would otherwise hold the main thread for the whole archive.
 */
const YIELD_EVERY = 8

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * A CBR as a foliate book.
 *
 * Unpacked whole, up front, rather than a page at a time: the module can only hold one archive open
 * at once (see `withArchive`), and reading pages lazily would mean holding that lock for as long as
 * the comic is on screen — blocking every other book on the board behind it. The cost is the
 * unpacked comic in memory, as blobs, which the browser is free to spill to disk.
 */
export async function makeRarComicBook(file: File): Promise<FoliateBook> {
	const pages = await withArchive(file, async (extractor) => {
		const found = new Map<string, Blob>()
		let sinceYield = 0
		for (const { fileHeader, extraction } of extractor.extract().files) {
			const type = imageType(fileHeader.name)
			if (extraction && type && !fileHeader.flags.directory) {
				found.set(fileHeader.name, pageBlob(extraction, type))
			}
			if (++sinceYield >= YIELD_EVERY) {
				sinceYield = 0
				await frame()
			}
		}
		return found
	})

	const { makeComicBook } = await import('foliate-js/comic-book.js')
	// `makeComicBook` does its own filtering and sorting; what it cannot do is get at the bytes.
	return makeComicBook(
		{
			entries: [...pages.keys()].map((filename) => ({ filename })),
			loadBlob: async (name) => pages.get(name) ?? null,
			getSize: (name) => pages.get(name)?.size ?? 0,
		},
		file
	)
}
