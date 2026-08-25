/**
 * A minimal RAR 4.x writer, "Storing" method only — test scaffolding, so that `cbr.ts` can be
 * exercised against a real archive rather than a mock.
 *
 * There is no way to *make* a RAR from npm (the compressor is proprietary; only the decompressor is
 * freely licensed), and a checked-in binary fixture would be a blob nobody can read or amend. A
 * stored archive is simple enough to write out by hand, and it is the method comics actually use:
 * JPEGs do not compress, so a comic packer stores them.
 *
 * Exported from the package (`@lifeboard/book-reader/rar-fixture`) rather than kept beside the unit
 * tests, because the app's end-to-end suite needs the same archive — and reaching into another
 * package's `src/` is the thing the export map exists to stop.
 */

const CRC_TABLE = (() => {
	const table = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		table[n] = c >>> 0
	}
	return table
})()

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff
	for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

const u16 = (value: number) => [value & 0xff, (value >>> 8) & 0xff]
const u32 = (value: number) => [
	value & 0xff,
	(value >>> 8) & 0xff,
	(value >>> 16) & 0xff,
	(value >>> 24) & 0xff,
]

/** Every block is prefixed by a CRC of itself, counted from the type byte on, truncated to 16 bits. */
function sealed(body: number[]): number[] {
	return [...u16(crc32(Uint8Array.from(body)) & 0xffff), ...body]
}

export interface RarEntry {
	name: string
	data: Uint8Array
}

export function makeRarArchive(entries: readonly RarEntry[]): Uint8Array<ArrayBuffer> {
	const out = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00] // "Rar!\x1a\x07\0"
	out.push(...sealed([0x73, ...u16(0), ...u16(13), ...u16(0), ...u32(0)])) // archive header
	for (const { name, data } of entries) {
		const nameBytes = [...new TextEncoder().encode(name)]
		out.push(
			...sealed([
				0x74, // file header
				...u16(0x8000), // LONG_BLOCK: file data follows the header
				...u16(32 + nameBytes.length),
				...u32(data.length), // packed size
				...u32(data.length), // unpacked size — equal, because it is stored
				0x03, // host OS: Unix
				...u32(crc32(data)),
				...u32(0x4d8a0000), // modified, MS-DOS packed
				0x14, // needs unrar 2.0
				0x30, // method: storing
				...u16(nameBytes.length),
				...u32(0x20), // attributes
				...nameBytes,
			])
		)
		out.push(...data)
	}
	out.push(...sealed([0x7b, ...u16(0x4000), ...u16(7)])) // end of archive
	return Uint8Array.from(out)
}

/** A one-pixel GIF, so that a "page" in a fixture is a file a browser would really draw. */
export const PIXEL_GIF = Uint8Array.from([
	0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00,
	0xff, 0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00,
	0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
])
