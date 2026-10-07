import {
	TLArrowShape,
	TLContent,
	TLEmbedShape,
	TLGeoShape,
	TLShapeId,
	createShapeId,
	richTextToPlainText,
} from '@lifeboard/canvas-editor'
import { registerDefaultExternalContentHandlers } from '../lib/defaultExternalContentHandlers'
import { pasteExcalidrawContent } from '../lib/ui/hooks/clipboard/pasteExcalidrawContent'
import { getPastedIframe, pasteLinkOntoSelection } from '../lib/ui/hooks/clipboard/pasteSmart'
import { pasteTldrawContent } from '../lib/ui/hooks/clipboard/pasteTldrawContent'
import {
	handleNativeOrMenuCopy,
	handlePasteFromEventClipboardData,
} from '../lib/ui/hooks/useClipboardEvents'
import { isMermaidFlowchart, parseFlowchart } from '../lib/utils/mermaid/flowchart'
import { pasteMermaid } from '../lib/utils/mermaid/pasteMermaid'
import { TestEditor } from './TestEditor'

/** Phase 2 of the parity work: clipboard hooks (X2) and what a paste can become (B8). */

let editor: TestEditor
// Pastes read the clipboard asynchronously; these tests wait for them in real time.
beforeAll(() => jest.useRealTimers())
beforeEach(() => {
	editor = new TestEditor()
	registerDefaultExternalContentHandlers(editor, {
		maxImageDimension: 5000,
		maxAssetSize: 10 * 1024 * 1024,
		acceptedImageMimeTypes: [],
		acceptedVideoMimeTypes: [],
	})
})
afterEach(() => editor?.dispose())

/** A paste event's clipboard, with text kinds only. */
function clipboard(data: Record<string, string>): DataTransfer {
	const entries = Object.entries(data)
	const fake = {
		types: entries.map(([type]) => type),
		files: [] as unknown as FileList,
		getData: (type: string) => data[type] ?? '',
		items: entries.map(([type, value]) => ({
			kind: 'string',
			type,
			getAsString: (callback: (value: string) => void) => setTimeout(() => callback(value)),
		})),
	}
	return fake as unknown as DataTransfer
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 20))
const shapesOf = (type: string) => editor.getCurrentPageShapes().filter((shape) => shape.type === type)

describe('Mermaid flowcharts (B8)', () => {
	it('are told from other text', () => {
		expect(isMermaidFlowchart('graph TD\nA-->B')).toBe(true)
		expect(isMermaidFlowchart('```mermaid\nflowchart LR\n  a --> b\n```')).toBe(true)
		expect(isMermaidFlowchart('sequenceDiagram\nA->>B: hi')).toBe(false)
		expect(isMermaidFlowchart('a graph of things')).toBe(false)
	})

	it('read their nodes, shapes, labels and links', () => {
		const chart = parseFlowchart(`flowchart LR
			%% a comment
			start([Start]) --> check{"Is it <br> ready?"}
			check -->|yes| ship[[Ship it]]
			check -- not yet --> fix(Fix it) -.-> check
			ship & fix ==> done((Done))
			done --- note>Flag]; a <--> b
			classDef red fill:#f00
			x ~~~ y
		`)!
		expect(chart.direction).toBe('LR')
		const node = (id: string) => chart.nodes.find((n) => n.id === id)
		expect(node('start')).toEqual({ id: 'start', label: 'Start', shape: 'stadium' })
		expect(node('check')).toEqual({ id: 'check', label: 'Is it \n ready?', shape: 'diamond' })
		expect(node('ship')).toMatchObject({ label: 'Ship it', shape: 'subroutine' })
		expect(node('fix')).toMatchObject({ label: 'Fix it', shape: 'rounded' })
		expect(node('done')).toMatchObject({ label: 'Done', shape: 'circle' })
		expect(node('note')).toMatchObject({ label: 'Flag', shape: 'flag' })
		expect(node('a')).toMatchObject({ label: 'a', shape: 'rectangle' })

		const edge = (from: string, to: string) => chart.edges.find((e) => e.from === from && e.to === to)
		expect(edge('start', 'check')).toMatchObject({ label: '', line: 'solid', head: { start: 'none', end: 'arrow' } })
		expect(edge('check', 'ship')).toMatchObject({ label: 'yes' })
		expect(edge('check', 'fix')).toMatchObject({ label: 'not yet', line: 'solid' })
		expect(edge('fix', 'check')).toMatchObject({ line: 'dotted', head: { end: 'arrow' } })
		expect(edge('ship', 'done')).toMatchObject({ line: 'thick' })
		expect(edge('fix', 'done')).toMatchObject({ line: 'thick' })
		expect(edge('done', 'note')).toMatchObject({ head: { start: 'none', end: 'none' } })
		expect(edge('a', 'b')).toMatchObject({ head: { start: 'arrow', end: 'arrow' } })
		expect(edge('x', 'y')).toMatchObject({ line: 'invisible' })
	})

	it('become shapes in layers, joined by bound arrows', () => {
		const ids = pasteMermaid(editor, 'graph TD\n  A[One] --> B[Two]\n  A --> C[Three]\n  B --> D[Four]\n  C --> D\n  D --> A', { x: 0, y: 0 })!
		const geo = shapesOf('geo') as TLGeoShape[]
		const byLabel = (label: string) => geo.find((s) => richTextToPlainText(s.props.richText) === label)!
		// Where each was put; a label that measures taller in tests grows its shape downwards after.
		const centre = (label: string) => {
			const { x, y, props } = byLabel(label)
			return { x: x + props.w / 2, y: y + props.h / 2 }
		}
		expect(geo).toHaveLength(4)
		// One above two and three, side by side, above four; the way back up doesn't change that.
		expect(centre('One').y).toBeLessThan(centre('Two').y)
		expect(centre('Two').y).toBeCloseTo(centre('Three').y)
		expect(centre('Two').x).not.toBeCloseTo(centre('Three').x)
		expect(centre('Four').y).toBeGreaterThan(centre('Two').y)

		const arrows = shapesOf('arrow') as TLArrowShape[]
		expect(arrows).toHaveLength(5)
		for (const arrow of arrows) expect(editor.getBindingsFromShape(arrow, 'arrow')).toHaveLength(2)
		expect([...editor.getSelectedShapeIds()].sort()).toEqual([...ids].sort())
	})

	it('arrive through a paste, fenced or not', async () => {
		await handlePasteFromEventClipboardData(editor, clipboard({ 'text/plain': '```mermaid\ngraph LR\na-->b\n```' }))
		await settle()
		expect(shapesOf('geo')).toHaveLength(2)
		expect(shapesOf('arrow')).toHaveLength(1)
		expect(shapesOf('text')).toHaveLength(0)
	})
})

describe('embed code (B8)', () => {
	it('is read for its address and size, and nothing else counts', () => {
		expect(
			getPastedIframe('<iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ" allowfullscreen></iframe>')
		).toEqual({ src: 'https://www.youtube.com/embed/dQw4w9WgXcQ', width: 560, height: 315 })
		expect(getPastedIframe('<iframe src="https://example.com" width="100%"></iframe>')).toEqual({
			src: 'https://example.com',
			width: undefined,
			height: undefined,
		})
		expect(getPastedIframe('<iframe src="javascript:alert(1)"></iframe>')).toBeNull()
		expect(getPastedIframe('<iframe src="https://a.b"></iframe><script>x</script>')).toBeNull()
		expect(getPastedIframe('see <iframe src="https://a.b"></iframe>')).toBeNull()
	})

	it('pastes as an embed of the site, at the size it asks for', async () => {
		await handlePasteFromEventClipboardData(
			editor,
			clipboard({
				'text/plain':
					'<iframe width="640" height="360" src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>',
			})
		)
		await settle()
		const [embed] = shapesOf('embed') as TLEmbedShape[]
		expect(embed).toBeDefined()
		expect(embed!.props).toMatchObject({ w: 640, h: 360 })
		expect(embed!.props.url).toContain('dQw4w9WgXcQ')
	})
})

describe('a link pasted onto selected shapes (B8)', () => {
	it('becomes their link', async () => {
		const a = createShapeId('a')
		const b = createShapeId('b')
		editor.createShapes([
			{ id: a, type: 'geo', x: 0, y: 0 },
			{ id: b, type: 'note', x: 300, y: 0 },
		])
		editor.select(a, b)
		await handlePasteFromEventClipboardData(editor, clipboard({ 'text/plain': 'https://lifeboard.example/plan' }))
		await settle()
		expect(editor.getShape(a)!.props).toMatchObject({ url: 'https://lifeboard.example/plan' })
		expect(editor.getShape(b)!.props).toMatchObject({ url: 'https://lifeboard.example/plan' })
		expect(editor.getCurrentPageShapes()).toHaveLength(2)
	})

	it('not when something selected can’t carry one', () => {
		const a = createShapeId('a')
		const f = createShapeId('f')
		editor.createShapes([
			{ id: a, type: 'geo', x: 0, y: 0 },
			{ id: f, type: 'frame', x: 300, y: 0 },
		])
		editor.select(a, f)
		expect(pasteLinkOntoSelection(editor, 'https://x.y')).toBe(false)
		editor.selectNone()
		expect(pasteLinkOntoSelection(editor, 'https://x.y')).toBe(false)
	})
})

describe('Excalidraw content (B8)', () => {
	it('comes in as shapes, its arrows bound and its labels kept', async () => {
		await pasteExcalidrawContent(editor, {
			type: 'excalidraw/clipboard',
			files: {},
			elements: [
				{ id: 'r', type: 'rectangle', x: 0, y: 0, width: 120, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: 'transparent', fillStyle: 'solid', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], boundElements: [{ type: 'text', id: 't' }, { type: 'arrow', id: 'arr' }], locked: false, link: null },
				{ id: 't', type: 'text', x: 10, y: 30, width: 100, height: 20, angle: 0, text: 'Box', fontSize: 20, fontFamily: 1, textAlign: 'center', strokeColor: '#1e1e1e', opacity: 100, groupIds: [], boundElements: null, containerId: 'r', locked: false },
				{ id: 'e', type: 'ellipse', x: 300, y: 0, width: 100, height: 100, angle: 0, strokeColor: '#e03131', backgroundColor: '#ffc9c9', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'dashed', roughness: 0, opacity: 100, groupIds: [], boundElements: [{ type: 'arrow', id: 'arr' }], locked: false, link: null },
				{ id: 'arr', type: 'arrow', x: 120, y: 40, width: 180, height: 10, angle: 0, points: [[0, 0], [180, 10]], strokeColor: '#1e1e1e', strokeWidth: 2, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], boundElements: null, startBinding: { elementId: 'r' }, endBinding: { elementId: 'e' }, startArrowhead: null, endArrowhead: 'arrow', locked: false },
				{ id: 'p', type: 'freedraw', x: 0, y: 200, width: 50, height: 20, angle: 0, points: [[0, 0], [10, 5], [30, 20], [50, 10]], strokeColor: '#1e1e1e', strokeWidth: 2, strokeStyle: 'solid', opacity: 100, groupIds: [], boundElements: null, locked: false },
				{ id: 'l', type: 'line', x: 100, y: 200, width: 60, height: 0, angle: 0, points: [[0, 0], [60, 0]], strokeColor: '#1e1e1e', strokeWidth: 2, strokeStyle: 'dotted', roughness: 1, opacity: 100, groupIds: [], boundElements: null, roundness: null, locked: false },
			],
		})
		const geo = shapesOf('geo') as TLGeoShape[]
		expect(geo.map((s) => s.props.geo).sort()).toEqual(['ellipse', 'rectangle'])
		expect(richTextToPlainText(geo.find((s) => s.props.geo === 'rectangle')!.props.richText)).toBe('Box')
		const [arrow] = shapesOf('arrow') as TLArrowShape[]
		const bound = editor.getBindingsFromShape(arrow!, 'arrow').map((b) => b.toId).sort()
		expect(bound).toEqual(geo.map((s) => s.id).sort())
		expect(shapesOf('draw')).toHaveLength(1)
		expect(shapesOf('line')).toHaveLength(1)
		expect(shapesOf('text')).toHaveLength(0)
	})
})

describe('clipboard hooks (X2)', () => {
	const box = (id: TLShapeId, x = 0) => ({ id, type: 'geo' as const, x, y: 0, props: { w: 100, h: 100 } })

	it('before paste: change what goes on the page, or stop it', async () => {
		const seen: TLContent[] = []
		const hooked = new TestEditor({
			options: {
				onBeforePasteFromClipboard: (_info, content) => {
					seen.push(content)
					return seen.length === 1
						? { ...content, shapes: content.shapes.map((s) => ({ ...s, meta: { pasted: true } })) }
						: null
				},
			},
		})
		hooked.createShapes([box(createShapeId('a'))])
		hooked.selectAll().copy()
		pasteTldrawContent(hooked, hooked.clipboard!)
		expect(hooked.getCurrentPageShapes()).toHaveLength(2)
		expect(hooked.getCurrentPageShapes().filter((s) => s.meta.pasted)).toHaveLength(1)
		pasteTldrawContent(hooked, hooked.clipboard!)
		expect(hooked.getCurrentPageShapes()).toHaveLength(2)
		hooked.dispose()
	})

	it('raw paste: take it before the canvas reads it', async () => {
		const read: string[] = []
		const hooked = new TestEditor({
			options: {
				onClipboardPasteRaw: async ({ clipboard }) => {
					read.push(...clipboard.types, (await clipboard.getText('text/plain')) ?? '')
					return false
				},
			},
		})
		await handlePasteFromEventClipboardData(hooked, clipboard({ 'text/plain': 'graph TD\nA-->B' }))
		await settle()
		expect(read).toEqual(['text/plain', 'graph TD\nA-->B'])
		expect(hooked.getCurrentPageShapes()).toHaveLength(0)
		hooked.dispose()
	})

	it('before copy: write something else, or nothing, and a cut then keeps the shapes', () => {
		const written: string[] = []
		Object.defineProperty(navigator, 'clipboard', {
			configurable: true,
			value: { writeText: async (text: string) => void written.push(text) },
		})
		let allow = true
		const hooked = new TestEditor({
			options: {
				onBeforeCopyToClipboard: (_info, content) => (allow ? { ...content, shapes: content.shapes.slice(0, 1) } : null),
			},
		})
		hooked.createShapes([box(createShapeId('a')), box(createShapeId('b'), 200)])
		hooked.selectAll()
		expect(handleNativeOrMenuCopy(hooked, 'copy')).toBe(true)
		expect(written).toHaveLength(1)

		allow = false
		expect(handleNativeOrMenuCopy(hooked, 'cut')).toBe(false)
		expect(written).toHaveLength(1)
		hooked.dispose()
		Reflect.deleteProperty(navigator, 'clipboard')
	})
})
