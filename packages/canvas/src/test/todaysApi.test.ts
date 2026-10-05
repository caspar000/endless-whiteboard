import {
	BaseBoxShapeUtil,
	TLAsset,
	TLAssetId,
	TLAssetStore,
	TLBaseBoxShape,
	TLShape,
	TLShapeId,
	DEFAULT_THEME,
	Edge2d,
	Vec2d,
	createShapeId,
	createTLStore,
	getColorValue,
	getSnapshot,
	loadSnapshot,
} from '@lifeboard/canvas-editor'
import { defaultShapeUtils } from '../lib/defaultShapeUtils'
import { GeoShapeUtil } from '../lib/shapes/geo/GeoShapeUtil'
import { TestEditor } from './TestEditor'

/**
 * Phase 5 of docs/canvas-fork-plan.md: the parts of today's editor API that Lifeboard's packages call,
 * on top of the 2023 editor.
 */

let editor: TestEditor
const box = createShapeId('box')

beforeEach(() => {
	editor = new TestEditor()
	editor.createShapes([{ id: box, type: 'geo', x: 0, y: 0, props: { w: 100, h: 100 } }])
})
afterEach(() => {
	editor?.dispose()
})

const x = () => editor.getShape(box)!.x

describe('run and history stopping points (E3)', () => {
	it('records a run as one undo step', () => {
		editor.markHistoryStoppingPoint('move twice')
		editor.run(() => {
			editor.updateShapes([{ id: box, type: 'geo', x: 10 }])
			editor.updateShapes([{ id: box, type: 'geo', x: 20 }])
		})
		editor.undo()
		expect(x()).toBe(0)
	})

	it('leaves a run with history ignored out of the undo stack', () => {
		// As Lifeboard uses it: a view setting changes while you edit, and undo takes back the edit.
		editor.markHistoryStoppingPoint('real edit')
		editor.updateShapes([{ id: box, type: 'geo', x: 10 }])
		editor.run(() => editor.updateDocumentSettings({ meta: { view: 'hidden' } }), { history: 'ignore' })
		editor.undo()
		expect(x()).toBe(0)
		expect(editor.getDocumentSettings().meta.view).toBe('hidden')
	})

	it('keeps the redo stack when asked to', () => {
		editor.markHistoryStoppingPoint('edit')
		editor.updateShapes([{ id: box, type: 'geo', x: 10 }])
		editor.undo()
		editor.run(() => editor.updateShapes([{ id: box, type: 'geo', y: 5 }]), {
			history: 'record-preserveRedoStack',
		})
		expect(editor.history.getNumRedos()).toBeGreaterThan(0)
	})

	it('returns a stopping point id that bailToMark goes back to', () => {
		const id = editor.markHistoryStoppingPoint('try something')
		editor.updateShapes([{ id: box, type: 'geo', x: 99 }])
		editor.bailToMark(id)
		expect(x()).toBe(0)
	})
})

describe('events, focus and coordinates (E8, E14)', () => {
	it('remembers which events were handled', () => {
		const event = new KeyboardEvent('keydown', { key: 'Escape' })
		expect(editor.wasEventAlreadyHandled(event)).toBe(false)
		editor.markEventAsHandled(event)
		expect(editor.wasEventAlreadyHandled(event)).toBe(true)
	})

	it('reports and changes focus', () => {
		editor.blur()
		expect(editor.getIsFocused()).toBe(false)
		editor.focus()
		expect(editor.getIsFocused()).toBe(true)
	})

	it('asks the shape util whether a shape can be edited', () => {
		const text = createShapeId('text')
		editor.createShapes([{ id: text, type: 'text' }])
		expect(editor.canEditShape(text)).toBe(true)
		expect(editor.canEditShape(createShapeId('nothing'))).toBe(false)
	})

	it('reads inputs through getters, with screen points relative to the container', () => {
		editor.setScreenBounds({ x: 100, y: 50, w: 800, h: 600 })
		editor.pointerMove(300, 250)
		expect(editor.inputs.getCurrentScreenPoint()).toMatchObject({ x: 200, y: 200 })
		expect(editor.inputs.getCurrentPagePoint()).toEqual(editor.inputs.currentPagePoint)
		expect(editor.inputs.getIsDragging()).toBe(false)
	})

	it('converts page points to the container’s space', () => {
		editor.setScreenBounds({ x: 100, y: 50, w: 800, h: 600 })
		editor.setCamera({ x: 10, y: 20, z: 2 })
		expect(editor.pageToViewport({ x: 0, y: 0 })).toMatchObject({ x: 20, y: 40 })
		expect(editor.pageToScreen({ x: 0, y: 0 })).toMatchObject({ x: 120, y: 90 })
	})

	it('zooms to bounds with today’s options object', () => {
		editor.zoomToBounds(editor.getShapePageBounds(box)!, { targetZoom: 1 })
		expect(editor.getZoomLevel()).toBe(1)
	})
})

describe('the asset store (E10)', () => {
	it('uploads and resolves through the store the app gives', async () => {
		const stored = new Map<string, File>()
		const assets: TLAssetStore = {
			upload: async (asset, file) => {
				stored.set(asset.id, file)
				return { src: `asset:${asset.id}`, meta: { stored: true } }
			},
			resolve: (asset, ctx) => `https://cdn.test/${asset.props.src}?scale=${ctx.screenScale}`,
		}
		const app = new TestEditor({ store: createTLStore({ shapeUtils: defaultShapeUtils, assets }) })
		const asset = {
			id: 'asset:photo' as TLAssetId,
			typeName: 'asset',
			type: 'image',
			props: { name: 'p.png', src: null, w: 10, h: 10, mimeType: 'image/png', isAnimated: false },
			meta: {},
		} as TLAsset

		const uploaded = await app.uploadAsset(asset, new File(['x'], 'p.png'))
		expect(uploaded).toEqual({ src: 'asset:asset:photo', meta: { stored: true } })
		expect(stored.has('asset:photo')).toBe(true)

		app.createAssets([{ ...asset, props: { ...asset.props, src: uploaded.src } } as TLAsset])
		expect(await app.resolveAssetUrl(asset.id, { screenScale: 2 })).toBe(
			'https://cdn.test/asset:asset:photo?scale=2'
		)
		app.dispose()
	})
})

describe('drop targets (E19)', () => {
	const heard: string[] = []
	type Tray = TLBaseBoxShape & { type: 'tray' }

	/** A shape that takes geo shapes dropped on it, and writes down what it hears. */
	class TrayUtil extends BaseBoxShapeUtil<Tray> {
		static override type = 'tray'
		override getDefaultProps() {
			return { w: 300, h: 300 }
		}
		override component() {
			return null
		}
		override canReceiveNewChildrenOfType(_shape: Tray, type: string) {
			return type === 'geo'
		}
		override onDragShapesIn() {
			heard.push('in')
		}
		override onDragShapesOver() {
			heard.push('over')
		}
		override onDragShapesOut() {
			heard.push('out')
		}
		override onDropShapesOver(_shape: Tray, shapes: TLShape[]) {
			heard.push(`drop:${shapes.map((s) => s.type).join(',')}`)
		}
	}

	const tray = createShapeId('tray')
	beforeEach(() => {
		heard.length = 0
		editor.dispose()
		editor = new TestEditor({ shapeUtils: [TrayUtil] })
		editor.createShapes([
			{ id: tray, type: 'tray', x: 0, y: 0 },
			{ id: box, type: 'geo', x: 500, y: 500, props: { w: 50, h: 50 } },
			{ id: createShapeId('note'), type: 'note', x: 700, y: 500 },
		] as never)
	})

	function drag(id: TLShapeId, to: { x: number; y: number }) {
		const bounds = editor.getShapePageBounds(id)!
		editor.select(id)
		editor.pointerDown(bounds.midX, bounds.midY, { target: 'shape', shape: editor.getShape(id)! })
		editor.pointerMove(to.x, to.y)
		jest.advanceTimersByTime(1100)
	}

	it('calls in on arrival, over on later moves, and drops what it can take', () => {
		drag(box, { x: 150, y: 150 })
		editor.pointerMove(160, 160)
		editor.pointerUp()
		expect(heard).toEqual(['in', 'over', 'drop:geo'])
	})

	it('calls out when the shapes leave', () => {
		drag(box, { x: 150, y: 150 })
		editor.pointerMove(900, 900)
		jest.advanceTimersByTime(1100)
		editor.pointerUp()
		expect(heard).toContain('out')
		expect(heard.some((h) => h.startsWith('drop'))).toBe(false)
	})

	it('does not drop shapes it cannot take', () => {
		const note = editor.getCurrentPageShapes().find((s) => s.type === 'note')!
		drag(note.id, { x: 150, y: 150 })
		editor.pointerUp()
		expect(heard).toContain('in')
		expect(heard.some((h) => h.startsWith('drop'))).toBe(false)
	})
})

describe('shape visibility (E4)', () => {
	it('hides shapes from hit-testing and rendering, and children with their parent', () => {
		const frame = createShapeId('frame')
		const child = createShapeId('child')
		const hidden = new Set<string>([frame])
		const viewer = new TestEditor({ getShapeVisibility: (shape) => (hidden.has(shape.id) ? 'hidden' : 'inherit') })
		viewer.createShapes([
			{ id: frame, type: 'frame', x: 0, y: 0, props: { w: 200, h: 200 } },
			{ id: child, type: 'geo', parentId: frame, x: 10, y: 10, props: { w: 50, h: 50, fill: 'solid' } },
		])
		expect(viewer.isShapeHidden(frame)).toBe(true)
		expect(viewer.isShapeHidden(child)).toBe(true)
		expect(viewer.getShapeAtPoint({ x: 30, y: 30 }, { hitInside: true })).toBeUndefined()
		expect(viewer.getCurrentPageRenderingShapesSorted().map((s) => s.id)).not.toContain(child)
		viewer.dispose()
	})
})

describe('camera options (E5)', () => {
	it('locks the camera against the person, not against a forced move', () => {
		editor.setCameraOptions({ isLocked: true })
		expect(editor.getCameraOptions().isLocked).toBe(true)
		const before = editor.getCamera()
		editor.zoomIn()
		expect(editor.getCamera()).toEqual(before)
		editor.zoomToBounds(editor.getShapePageBounds(box)!, { targetZoom: 1, force: true })
		expect(editor.getCamera()).not.toEqual(before)
		editor.setCameraOptions({ isLocked: false })
		expect(editor.getCanMoveCamera()).toBe(true)
	})

	it('zooms through the zoom steps it is given', () => {
		editor.setCameraOptions({ zoomSteps: [0.5, 1, 3] })
		editor.resetZoom()
		editor.zoomIn()
		expect(editor.getZoomLevel()).toBe(3)
		expect(editor.getBaseZoom()).toBe(1)
	})
})

describe('theme and colour scheme (E7)', () => {
	it('follows the colour scheme preference, and the 2023 dark-mode toggle still works', () => {
		editor.user.updateUserPreferences({ colorScheme: 'dark' })
		expect(editor.getColorMode()).toBe('dark')
		editor.user.updateUserPreferences({ isDarkMode: false })
		expect(editor.getColorMode()).toBe('light')
		const colors = editor.getCurrentTheme().colors[editor.getColorMode()]
		expect(getColorValue(colors, 'blue', 'solid')).toBe(colors.blue.solid)
		expect(getColorValue(colors, 'blue', 'fill')).toBe(colors.blue.semi)
	})
})

describe('configured shape utils (E6)', () => {
	it('carries its options into a new util class of the same type', () => {
		const Configured = GeoShapeUtil.configure({ getCustomDisplayValues: () => ({ fillColor: 'red' }) })
		expect(Configured.type).toBe('geo')
		const util = new Configured(editor)
		expect(util.options.getCustomDisplayValues?.(editor, editor.getShape(box)!, DEFAULT_THEME, 'light')).toEqual({
			fillColor: 'red',
		})
		expect(new GeoShapeUtil(editor).options).toEqual({})
	})
})

describe('snapshots (E13)', () => {
	it('saves a document and session, and loads them into a new store', () => {
		const saved = getSnapshot(editor.store)
		const other = new TestEditor()
		loadSnapshot(other.store, { document: saved.document })
		expect(other.getShape(box)).toEqual(editor.getShape(box))
		other.dispose()
	})
})

describe('geometry (E14 neighbours)', () => {
	it('finds points along an edge, wrapping outside 0 to 1', () => {
		const edge = new Edge2d({ start: new Vec2d(0, 0), end: new Vec2d(200, 0) })
		expect(edge.interpolateAlongEdge(0.25).x).toBeCloseTo(50)
		expect(edge.interpolateAlongEdge(1).x).toBeCloseTo(200)
		expect(edge.interpolateAlongEdge(1.25).x).toBeCloseTo(50)
	})
})
