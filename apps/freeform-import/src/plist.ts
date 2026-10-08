/**
 * Binary property lists (`bplist00`), and the NSKeyedArchiver archives Freeform keeps link previews
 * in. Only what those files use: no sets, no 128-bit integers.
 */
export type PlistValue =
	| null
	| boolean
	| number
	| string
	| Date
	| Uint8Array
	| { uid: number }
	| PlistValue[]
	| { [key: string]: PlistValue }

export function parseBinaryPlist(bytes: Uint8Array): PlistValue {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
	if (new TextDecoder().decode(bytes.subarray(0, 8)) !== 'bplist00') throw new Error('Not a binary plist')
	const trailer = bytes.length - 32
	const offsetSize = view.getUint8(trailer + 6)
	const refSize = view.getUint8(trailer + 7)
	const count = Number(view.getBigUint64(trailer + 8))
	const top = Number(view.getBigUint64(trailer + 16))
	const tableAt = Number(view.getBigUint64(trailer + 24))

	const uint = (at: number, size: number) => {
		let n = 0
		for (let i = 0; i < size; i++) n = n * 256 + view.getUint8(at + i)
		return n
	}
	const offsets = Array.from({ length: count }, (_, i) => uint(tableAt + i * offsetSize, offsetSize))

	const read = (index: number): PlistValue => {
		const at = offsets[index]!
		const marker = view.getUint8(at)
		const type = marker >> 4
		const info = marker & 0x0f
		/** A length that doesn't fit in the marker follows it as an int object. */
		const sized = (): [number, number] => {
			if (info !== 0x0f) return [info, at + 1]
			const intSize = 1 << (view.getUint8(at + 1) & 0x0f)
			return [uint(at + 2, intSize), at + 2 + intSize]
		}
		switch (type) {
			case 0x0:
				return info === 0x8 ? false : info === 0x9 ? true : null
			case 0x1: {
				const size = 1 << info
				return size === 8 ? Number(view.getBigInt64(at + 1)) : uint(at + 1, size)
			}
			case 0x2:
				return info === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1)
			case 0x3:
				// Seconds since 2001-01-01.
				return new Date((view.getFloat64(at + 1) + 978307200) * 1000)
			case 0x4: {
				const [length, start] = sized()
				return bytes.subarray(start, start + length)
			}
			case 0x5: {
				const [length, start] = sized()
				return new TextDecoder('latin1').decode(bytes.subarray(start, start + length))
			}
			case 0x6: {
				const [length, start] = sized()
				let text = ''
				for (let i = 0; i < length; i++) text += String.fromCharCode(view.getUint16(start + i * 2))
				return text
			}
			case 0x8:
				return { uid: uint(at + 1, info + 1) }
			case 0xa: {
				const [length, start] = sized()
				return Array.from({ length }, (_, i) => read(uint(start + i * refSize, refSize)))
			}
			case 0xd: {
				const [length, start] = sized()
				const dict: { [key: string]: PlistValue } = {}
				for (let i = 0; i < length; i++) {
					const key = read(uint(start + i * refSize, refSize))
					dict[String(key)] = read(uint(start + (length + i) * refSize, refSize))
				}
				return dict
			}
			default:
				throw new Error(`Unsupported plist object 0x${marker.toString(16)}`)
		}
	}
	return read(top)
}

const isUid = (value: PlistValue): value is { uid: number } =>
	!!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date) && !(value instanceof Uint8Array) && 'uid' in value

/**
 * An NSKeyedArchiver archive as plain values: objects become dictionaries of their fields (with
 * `$class` the class name), NSURL its string, NSData its bytes, NSArray an array.
 */
export function unarchive(bytes: Uint8Array): PlistValue {
	const archive = parseBinaryPlist(bytes) as { $objects: PlistValue[]; $top: { root: { uid: number } } }
	const objects = archive.$objects
	const resolve = (value: PlistValue, depth = 0): PlistValue => {
		if (depth > 40) return null
		if (isUid(value)) return resolve(objects[value.uid] ?? null, depth + 1)
		if (value === '$null') return null
		if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Uint8Array || Array.isArray(value)) return value
		const dict = value as { [key: string]: PlistValue }
		const cls = isUid(dict.$class ?? null) ? (objects[(dict.$class as { uid: number }).uid] as { $classname?: string }) : undefined
		const name = cls?.$classname
		if (name === 'NSURL') return resolve(dict['NS.relative'] ?? null, depth + 1)
		if (name === 'NSData' || name === 'NSMutableData') return resolve(dict['NS.data'] ?? null, depth + 1)
		if (name === 'NSArray' || name === 'NSMutableArray') {
			return ((dict['NS.objects'] as PlistValue[]) ?? []).map((item) => resolve(item, depth + 1))
		}
		const out: { [key: string]: PlistValue } = name ? { $class: name } : {}
		for (const [key, field] of Object.entries(dict)) if (key !== '$class') out[key] = resolve(field, depth + 1)
		return out
	}
	return resolve(archive.$top.root)
}
