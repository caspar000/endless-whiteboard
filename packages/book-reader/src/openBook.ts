/// <reference path="./foliate-js.d.ts" />
import type { FoliateBook } from 'foliate-js/view.js'
import { isRarArchive } from './formats'

/**
 * foliate's `makeBook`, plus the one container it has no reader for.
 *
 * Which path a comic takes is decided by what its bytes *are*, not by what it is called. CBR and
 * CBZ name the archive rather than the content, and renaming one to the other is how a good number
 * of both are made — so a `.cbr` holding a zip and a `.cbz` holding a RAR each land where they can
 * actually be read.
 */
export async function openBook(file: File): Promise<FoliateBook> {
	if (await isRarArchive(file)) {
		const { makeRarComicBook } = await import('./cbr')
		return makeRarComicBook(file)
	}
	const { makeBook } = await import('foliate-js/view.js')
	return makeBook(asComicIfZipped(file))
}

/**
 * A `.cbr` that turns out to be a zip is an ordinary CBZ under the wrong name. foliate decides
 * "comic" from the suffix and nothing else, so it is handed the suffix it understands rather than
 * left to parse a folder of JPEGs as an EPUB and fail.
 */
function asComicIfZipped(file: File): File {
	if (!file.name.toLowerCase().endsWith('.cbr')) return file
	const name = `${file.name.slice(0, -'.cbr'.length)}.cbz`
	return new File([file], name, file.type ? { type: file.type } : undefined)
}
