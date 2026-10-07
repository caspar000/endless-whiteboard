import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Editor, TLClipboardRaw, TLContent } from '@lifeboard/canvas'
import { clearExtensionRegistry, extensionClipboardHooks, registerExtension } from './extensions'
import { clearNodeRegistry, setExtensionEnabled } from './registry'

/** Extensions' say in copy and paste (fork-parity X2). */

const editor = {} as Editor
const content = (...ids: string[]) => ({ shapes: ids.map((id) => ({ id })) }) as unknown as TLContent
const ids = (c: TLContent | null | void) => c?.shapes.map((s) => s.id)
const raw = { types: ['text/plain'], getText: async () => 'x', getFiles: async () => [] } as TLClipboardRaw

beforeEach(() => {
	clearExtensionRegistry()
	clearNodeRegistry()
})

describe('extensionClipboardHooks', () => {
	it('passes content along each enabled extension, and any one can stop it', () => {
		registerExtension({
			id: 'a',
			name: 'A',
			nodes: [],
			clipboard: { onBeforeCopyToClipboard: (_i, c) => ({ ...c, shapes: [...c.shapes, { id: 'from-a' }] } as TLContent) },
		})
		registerExtension({
			id: 'b',
			name: 'B',
			nodes: [],
			clipboard: { onBeforeCopyToClipboard: (_i, c) => (c.shapes.length > 3 ? null : undefined) },
		})
		const copy = (c: TLContent) => extensionClipboardHooks.onBeforeCopyToClipboard({ editor, operation: 'copy' }, c)

		expect(ids(copy(content('x')))).toEqual(['x', 'from-a'])
		expect(copy(content('x', 'y', 'z'))).toBeNull()

		setExtensionEnabled('a', false)
		expect(ids(copy(content('x')))).toEqual(['x'])
	})

	it('gives a raw paste to the first that claims it, past one that throws', async () => {
		const later = vi.fn()
		const log = vi.spyOn(console, 'error').mockImplementation(() => {})
		registerExtension({ id: 'broken', name: 'Broken', nodes: [], clipboard: { onClipboardPasteRaw: () => { throw Error('no') } } })
		registerExtension({ id: 'claims', name: 'Claims', nodes: [], clipboard: { onClipboardPasteRaw: async () => false } })
		registerExtension({ id: 'later', name: 'Later', nodes: [], clipboard: { onClipboardPasteRaw: later } })

		expect(await extensionClipboardHooks.onClipboardPasteRaw({ editor, clipboard: raw })).toBe(false)
		expect(later).not.toHaveBeenCalled()
		expect(log).toHaveBeenCalledTimes(1)

		setExtensionEnabled('claims', false)
		expect(await extensionClipboardHooks.onClipboardPasteRaw({ editor, clipboard: raw })).toBeUndefined()
		expect(later).toHaveBeenCalledTimes(1)
		log.mockRestore()
	})
})
