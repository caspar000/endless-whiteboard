/** The UI package's extra browser stubs, from upstream's setupTests.js. */
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: jest.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: jest.fn(),
		removeListener: jest.fn(),
		addEventListener: jest.fn(),
		removeEventListener: jest.fn(),
		dispatchEvent: jest.fn(),
	})),
})

Object.defineProperty(URL, 'createObjectURL', { writable: true, value: jest.fn() })

window.fetch = (async (input: RequestInfo | URL) => {
	if (String(input).endsWith('/translations/en.json')) {
		const json = await import('@lifeboard/canvas-assets/translations/main.json')
		return { ok: true, json: async () => json.default }
	}
	if (input === '/icons/icon/icon-names.json') return { ok: true, json: async () => [] }
	throw new Error(`Unhandled request: ${String(input)}`)
}) as typeof fetch
