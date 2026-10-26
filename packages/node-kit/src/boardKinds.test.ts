import type { Editor, TLShape } from '@lifeboard/canvas'
import { afterEach, describe, expect, it } from 'vitest'
import { boardKindOf, getAllBoardKinds, holdBoardToKind, type BoardKind } from './boardKinds'
import { registerExtension } from './extensions'
import { setDisabledExtensionIds } from './registry'

const MARK = 'test:box'

const kind: BoardKind = {
	id: 'test.box',
	name: 'Box',
	label: 'New box',
	newName: 'Untitled box',
	icon: () => null,
	isKind: (editor) => editor.getDocumentSettings().meta[MARK] === true,
	create: () => {},
	Dock: () => null,
	allowedShapes: ['node.card'],
}

registerExtension({ id: 'test.boxes', name: 'Boxes', nodes: [], boardKinds: [kind] })

type AfterCreate = (shape: TLShape, source: 'user' | 'remote') => void

/** Just enough editor for the rules: a document mark, a tool, and the after-create side effect. */
function fakeEditor({ isBox }: { isBox: boolean }) {
	let tool = 'select'
	let afterCreate: AfterCreate | null = null
	const deleted: string[] = []
	const editor = {
		getDocumentSettings: () => ({ meta: isBox ? { [MARK]: true } : {} }),
		getCurrentToolId: () => tool,
		setCurrentTool: (id: string) => {
			tool = id
		},
		deleteShapes: (ids: string[]) => deleted.push(...ids),
		sideEffects: {
			registerAfterCreateHandler: (_type: string, handler: AfterCreate) => {
				afterCreate = handler
				return () => {
					afterCreate = null
				}
			},
		},
	} as unknown as Editor
	const create = (type: string, source: 'user' | 'remote' = 'user') =>
		afterCreate?.({ id: `shape:${type}`, type } as unknown as TLShape, source)
	return { editor, deleted, create, tool: () => tool }
}

afterEach(() => setDisabledExtensionIds([]))

describe('board kinds', () => {
	it('lists each kind with the extension it came from', () => {
		expect(getAllBoardKinds().find((entry) => entry.kind === kind)?.owner).toBe('test.boxes')
	})

	it('knows a board of the kind by what is written in it, and only while its extension is on', () => {
		expect(boardKindOf(fakeEditor({ isBox: true }).editor)).toBe(kind)
		expect(boardKindOf(fakeEditor({ isBox: false }).editor)).toBeNull()
		setDisabledExtensionIds(['test.boxes'])
		expect(boardKindOf(fakeEditor({ isBox: true }).editor)).toBeNull()
	})

	it('takes a shape the kind does not allow back off as this device makes it', () => {
		const box = fakeEditor({ isBox: true })
		const stop = holdBoardToKind(box.editor)
		box.create('note')
		box.create('node.card')
		expect(box.deleted).toEqual(['shape:note'])
		stop()
	})

	it('leaves other devices’ shapes, ordinary boards, and a switched-off kind alone', () => {
		const box = fakeEditor({ isBox: true })
		const stopBox = holdBoardToKind(box.editor)
		box.create('note', 'remote')
		expect(box.deleted).toEqual([])
		stopBox()

		const plain = fakeEditor({ isBox: false })
		const stopPlain = holdBoardToKind(plain.editor)
		plain.create('note')
		expect(plain.deleted).toEqual([])
		stopPlain()

		setDisabledExtensionIds(['test.boxes'])
		const off = fakeEditor({ isBox: true })
		const stopOff = holdBoardToKind(off.editor)
		off.create('note')
		expect(off.deleted).toEqual([])
		stopOff()
	})

	it('puts a drawing tool back to Select on a board of a kind', async () => {
		const box = fakeEditor({ isBox: true })
		box.editor.setCurrentTool('geo')
		const stop = holdBoardToKind(box.editor)
		await Promise.resolve()
		expect(box.tool()).toBe('select')
		stop()
	})
})
