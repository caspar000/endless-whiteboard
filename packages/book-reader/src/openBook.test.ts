import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openBook } from './openBook'

/** Importing the real module registers a custom element, which needs a DOM this suite has not got. */
const makeBook = vi.hoisted(() => vi.fn(async (file: File) => ({ metadata: { title: file.name } })))
vi.mock('foliate-js/view.js', () => ({ makeBook }))

const makeRarComicBook = vi.hoisted(() => vi.fn(async () => ({ metadata: { title: 'comic' } })))
vi.mock('./cbr', () => ({ makeRarComicBook }))

const RAR = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00]
const ZIP = [0x50, 0x4b, 0x03, 0x04]

const file = (name: string, head: number[]) => new File([Uint8Array.from(head)], name)

beforeEach(() => {
	makeBook.mockClear()
	makeRarComicBook.mockClear()
})

describe('openBook', () => {
	it('unpacks a real CBR itself, since foliate cannot', async () => {
		await openBook(file('watchmen.cbr', RAR))

		expect(makeRarComicBook).toHaveBeenCalledOnce()
		expect(makeBook).not.toHaveBeenCalled()
	})

	/** Renaming a CBZ is how a good share of `.cbr` files are made. There is no RAR in them. */
	it('reads a .cbr that is really a zip as the comic it is', async () => {
		await openBook(file('watchmen.cbr', ZIP))

		expect(makeRarComicBook).not.toHaveBeenCalled()
		// foliate decides "comic" from the suffix and nothing else.
		expect(makeBook.mock.calls[0]?.[0]?.name).toBe('watchmen.cbz')
	})

	it('reads a .cbz that is really a RAR through the RAR path', async () => {
		await openBook(file('watchmen.cbz', RAR))

		expect(makeRarComicBook).toHaveBeenCalledOnce()
		expect(makeBook).not.toHaveBeenCalled()
	})

	it('leaves every other book exactly as it found it', async () => {
		const dune = file('dune.epub', ZIP)
		await openBook(dune)

		expect(makeBook).toHaveBeenCalledWith(dune)
	})
})
