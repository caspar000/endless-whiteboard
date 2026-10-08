/** One field of a protobuf message read without its schema. */
export interface Field {
	field: number
	/** 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32. */
	wire: number
	/** A number for varints; the raw bytes for everything else. */
	value: number | Uint8Array
}

/**
 * Reads `bytes` as a protobuf message, or returns `null` if they aren't one: an unknown wire type, a
 * field number of 0, or a length running past the end. Freeform's records carry no schema, so whether
 * some bytes are a nested message or a string is decided by whether they read cleanly as one.
 */
export function parseMessage(bytes: Uint8Array): Field[] | null {
	const fields: Field[] = []
	let i = 0
	const varint = (): number | null => {
		let result = 0
		let scale = 1
		for (;;) {
			if (i >= bytes.length) return null
			const byte = bytes[i++]!
			result += (byte & 0x7f) * scale
			if (byte < 0x80) return result
			scale *= 128
			if (scale > 2 ** 63) return null
		}
	}
	while (i < bytes.length) {
		const key = varint()
		if (key === null) return null
		const field = Math.floor(key / 8)
		const wire = key % 8
		if (field === 0) return null
		if (wire === 0) {
			const value = varint()
			if (value === null) return null
			fields.push({ field, wire, value })
		} else if (wire === 1 || wire === 5) {
			const size = wire === 1 ? 8 : 4
			if (i + size > bytes.length) return null
			fields.push({ field, wire, value: bytes.subarray(i, i + size) })
			i += size
		} else if (wire === 2) {
			const length = varint()
			if (length === null || i + length > bytes.length) return null
			fields.push({ field, wire, value: bytes.subarray(i, i + length) })
			i += length
		} else {
			return null
		}
	}
	return fields
}

export const float32 = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true)

export const isBytes = (value: number | Uint8Array): value is Uint8Array => typeof value !== 'number'
