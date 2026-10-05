/** upstream's setupTests.js, as ESM: browser APIs jsdom lacks. */
import 'fake-indexeddb/auto'
import { Crypto } from '@peculiar/webcrypto'
import ResizeObserver from 'resize-observer-polyfill'

globalThis.ResizeObserver = ResizeObserver
globalThis.crypto ??= new Crypto() as unknown as globalThis.Crypto
globalThis.FontFace = class FontFace {
	load() {
		return Promise.resolve(this)
	}
} as unknown as typeof globalThis.FontFace
Object.defineProperty(document, 'fonts', {
	configurable: true,
	value: {
		add: () => {},
		delete: () => {},
		forEach: () => {},
		[Symbol.iterator]: () => [][Symbol.iterator](),
	},
})

// Node 26 has a global `localStorage` of its own, `undefined` without --localstorage-file, and it
// shadows jsdom's. Upstream ran on a Node without one.
const dom = (globalThis as unknown as { jsdom?: { window: Window } }).jsdom
if (dom && !globalThis.localStorage) {
	Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
	Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: dom.window.sessionStorage })
}
