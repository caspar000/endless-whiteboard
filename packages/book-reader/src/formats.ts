/**
 * Format routing for the book node. Two render paths exist: PDFs go through pdf.js, everything else
 * through foliate-js — so the *format* only needs to be as fine-grained as that split plus what the
 * UI wants to display. Detection is by filename suffix, not MIME type: browsers report book formats
 * inconsistently (`.epub` often arrives with an empty type), while the suffix is dependable.
 */
export type BookFormat = 'pdf' | 'epub' | 'mobi' | 'fb2' | 'cbz'

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
]

/** What the extension claims from file drops — see `FileImport.extensions` in node-kit. */
export const BOOK_FILE_SUFFIXES: readonly string[] = SUFFIX_FORMATS.map(([suffix]) => suffix)

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
