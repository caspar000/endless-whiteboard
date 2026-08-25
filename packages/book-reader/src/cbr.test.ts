import { beforeAll, describe, expect, it, vi } from 'vitest'
import { makeRarArchive, PIXEL_GIF, type RarEntry } from './rar-fixture'

/**
 * The real unrar build, not a stand-in for it — these tests are worth little if they do not run the
 * decompressor.
 *
 * In the app the wasm arrives over the network, as an asset Vite emitted from the `?url` import.
 * Under vitest there is no server to fetch it from, so the URL is swapped for a data URL built out
 * of the bytes on disk, which `fetch` answers anywhere.
 */
vi.mock('node-unrar-js/esm/js/unrar.wasm?url', () => ({ default: 'about:wasm' }))

beforeAll(async () => {
	// Imported through a variable so that this browser-only package is not given Node's globals just
	// to let its tests read a file.
	const nodeFs = 'node:fs'
	const { readFileSync } = (await import(nodeFs)) as { readFileSync(path: URL): Uint8Array }
	const wasm = readFileSync(
		new URL('../node_modules/node-unrar-js/esm/js/unrar.wasm', import.meta.url)
	)
	const response = () => new Response(wasm as Uint8Array<ArrayBuffer>)
	vi.stubGlobal('fetch', async () => response())
})

function cbr(entries: readonly RarEntry[], name = 'watchmen.cbr'): File {
	return new File([makeRarArchive(entries)], name)
}

const page = (name: string) => ({ name, data: PIXEL_GIF })

describe('readRarComicInfo', () => {
	it('counts the pages and lifts the first one out as the cover', async () => {
		const { readRarComicInfo } = await import('./cbr')
		const info = await readRarComicInfo(cbr([page('p1.jpg'), page('p2.jpg'), page('p3.jpg')]))

		expect(info.pageCount).toBe(3)
		expect(await info.cover?.arrayBuffer()).toEqual(PIXEL_GIF.buffer)
		expect(info.cover?.type).toBe('image/jpeg')
	})

	it('counts only what the reader will show as a page', async () => {
		const { readRarComicInfo } = await import('./cbr')
		const info = await readRarComicInfo(
			cbr([
				{ name: 'ComicInfo.xml', data: new TextEncoder().encode('<ComicInfo/>') },
				page('001.png'),
				page('002.png'),
				{ name: 'readme.txt', data: new TextEncoder().encode('scanned by someone') },
			])
		)

		expect(info.pageCount).toBe(2)
		expect(info.cover?.type).toBe('image/png')
	})

	/** The reason page 10 must not sort between page 1 and page 2 — foliate collates numerically. */
	it('takes the cover from the first page in reading order, not archive order', async () => {
		const { readRarComicInfo } = await import('./cbr')
		const cover = new TextEncoder().encode('THE-COVER')
		const info = await readRarComicInfo(
			cbr([page('page10.jpg'), page('page2.jpg'), { name: 'page1.jpg', data: cover }])
		)

		expect(info.pageCount).toBe(3)
		expect(await info.cover?.text()).toBe('THE-COVER')
	})

	it('reports no pages for an archive that holds none', async () => {
		const { readRarComicInfo } = await import('./cbr')
		const info = await readRarComicInfo(
			cbr([{ name: 'notes.txt', data: new TextEncoder().encode('empty') }])
		)

		expect(info).toEqual({ pageCount: 0, cover: null })
	})

	/** Archives are read one at a time through a shared wasm module — see `withArchive`. */
	it('keeps concurrent archives apart', async () => {
		const { readRarComicInfo } = await import('./cbr')
		const one = readRarComicInfo(cbr([{ name: 'a.jpg', data: new TextEncoder().encode('ONE') }]))
		const two = readRarComicInfo(
			cbr([page('b.jpg'), { name: 'c.jpg', data: new TextEncoder().encode('TWO') }])
		)

		const [first, second] = await Promise.all([one, two])
		expect(await first.cover?.text()).toBe('ONE')
		expect(second.pageCount).toBe(2)
	})

	it('rejects a file that is not a RAR at all', async () => {
		const { readRarComicInfo } = await import('./cbr')
		await expect(readRarComicInfo(new File(['not an archive'], 'x.cbr'))).rejects.toThrow()
	})
})

describe('makeRarComicBook', () => {
	it('hands foliate every page, addressable by name', async () => {
		const { makeRarComicBook } = await import('./cbr')
		const book = await makeRarComicBook(
			cbr([
				page('001.jpg'),
				{ name: 'ComicInfo.xml', data: new TextEncoder().encode('<ComicInfo/>') },
				page('002.jpg'),
			])
		)

		expect(book.rendition?.layout).toBe('pre-paginated')
		expect(book.sections?.map((section) => section.id)).toEqual(['001.jpg', '002.jpg'])
		expect(await (await book.getCover?.())?.arrayBuffer()).toEqual(PIXEL_GIF.buffer)
	})

	/** More than `YIELD_EVERY` pages, so the loop really does give the frame back partway through. */
	it('unpacks an archive longer than one batch', async () => {
		const { makeRarComicBook } = await import('./cbr')
		const pages = Array.from({ length: 21 }, (_, index) => page(`p${index + 1}.jpg`))
		const book = await makeRarComicBook(cbr(pages))

		expect(book.sections).toHaveLength(21)
		expect(book.sections?.[9]?.id).toBe('p10.jpg')
	})
})
