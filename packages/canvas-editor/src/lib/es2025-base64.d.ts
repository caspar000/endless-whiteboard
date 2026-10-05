// `Uint8Array.fromBase64` / `toBase64` (ES2025, in every current browser and Node 25+) aren't in
// TypeScript 5.9's library types yet. Today's @tldraw/tlschema uses them to encode stroke paths.
interface Uint8ArrayConstructor {
	fromBase64(base64: string, options?: { alphabet?: 'base64' | 'base64url' }): Uint8Array
}
interface Uint8Array {
	toBase64(options?: { alphabet?: 'base64' | 'base64url'; omitPadding?: boolean }): string
}
