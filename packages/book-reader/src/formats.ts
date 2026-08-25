/**
 * Format routing for the book node. Two render paths exist: PDFs go through pdf.js, everything else
 * through foliate-js — so the *format* only needs to be as fine-grained as that split plus what the
 * UI wants to display. Detection is by filename suffix, not MIME type: browsers report book formats
 * inconsistently (`.epub` often arrives with an empty type), while the suffix is dependable.
 *
 * CBR is the one format whose suffix does not settle how it is read — see `isRarArchive`.
 */
export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'fb2' | 'cbz' | 'cbr'

/** Order matters only for `titleFromFileName`: compound suffixes strip before their tails. */
const SUFFIX_FORMATS: readonly (readonly [string, BookFormat])[] = [
	['pdf', 'pdf'],
	['epub', 'epub'],
	['mobi', 'mobi'],
	['azw3', 'mobi'],
	['azw', 'mobi'],
	['fb2.zip', 'fb2'],
	['fbz', 'fb2'],
	['fb2', 'fb2'],
	['cbz', 'cbz'],
	['cbr', 'cbr'],
]

/** What the extension claims from file drops — see `FileImport.extensions` in node-kit. */
export const BOOK_FILE_SUFFIXES: readonly string[] = SUFFIX_FORMATS.map(([suffix]) => suffix)

/**
 * Whether the bytes are a RAR archive, whatever the file is called.
 *
 * The one question a suffix cannot answer. `.cbr` and `.cbz` name the *container* a comic is packed
 * in, and comics get renamed between the two often enough that the name is not evidence — a `.cbr`
 * is as likely to hold a zip as a RAR. `Rar!\x1a\x07` opens both RAR 4 and RAR 5; only the byte
 * after it tells them apart, and unrar reads either.
 */
const RAR_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]

export async function isRarArchive(file: Blob): Promise<boolean> {
	const head = new Uint8Array(await file.slice(0, RAR_MAGIC.length).arrayBuffer())
	return RAR_MAGIC.every((byte, index) => head[index] === byte)
}

export function detectBookFormat(fileName: string): BookFormat | null {
	const name = fileName.toLowerCase()
	for (const [suffix, format] of SUFFIX_FORMATS) {
		if (name.endsWith(`.${suffix}`)) return format
	}
	return null
}

/**
 * The fallback title while metadata is still being parsed — and forever, for files that carry none
 * (scanned PDFs, comics). Underscores read as word separators in practice ("The_Fellowship.epub").
 */
export function titleFromFileName(fileName: string): string {
	let name = fileName
	for (const [suffix] of SUFFIX_FORMATS) {
		if (name.toLowerCase().endsWith(`.${suffix}`)) {
			name = name.slice(0, -(suffix.length + 1))
			break
		}
	}
	return name.replace(/[_]+/g, ' ').trim()
}

/**
 * EPUB metadata fields may be plain strings or language maps (`{ en: 'Dune', fr: 'Dune' }`).
 * Foliate passes them through as-is; the first entry is the book's own primary language.
 */
export function formatLanguageMap(value: unknown): string {
	if (typeof value === 'string') return value.trim()
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		const first = Object.values(value as Record<string, unknown>)[0]
		if (typeof first === 'string') return first.trim()
	}
	return ''
}

/** Authors arrive as a string, `{ name }` object, or an array of either. */
export function formatContributors(value: unknown): string {
	if (Array.isArray(value)) {
		return value
			.map((entry) => formatOneContributor(entry))
			.filter(Boolean)
			.join(', ')
	}
	return formatOneContributor(value)
}

function formatOneContributor(value: unknown): string {
	if (typeof value === 'string') return value.trim()
	if (value && typeof value === 'object') {
		return formatLanguageMap((value as { name?: unknown }).name)
	}
	return ''
}
