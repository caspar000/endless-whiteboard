import { getNodeDefinition, type QuickLookPreset } from '@lifeboard/node-kit'
import {
	atom,
	type Atom,
	type BoxModel,
	type Editor,
	type TLCamera,
	type TLCameraOptions,
	type TLShapeId,
} from 'tldraw'

/**
 * Quick look: tap Space on a node and the camera zooms onto it while the rest of the board blurs.
 *
 * It is a camera move, not a copy of the node in a modal. The node on screen is the real one, so
 * editing, scrolling and checkboxes work exactly as they do on the board. The camera is locked while
 * it is open and put back where it was when it closes.
 *
 * State is per editor: every open tab keeps its board mounted, and a preview open on one must not
 * leak into another.
 */

export interface QuickLookState {
	/** What ← and → step through, in reading order. */
	ids: TLShapeId[]
	index: number
	/** Where the camera was, and how it was configured, before the preview took it over. */
	camera: TLCamera
	cameraOptions: TLCameraOptions
}

type Preset = Required<QuickLookPreset>

/** Registry nodes default to documents; text past 2.5× reads as shouting. */
const DOCUMENT: Preset = { fill: 0.85, maxZoom: 2.5 }
const PICTURE: Preset = { fill: 0.85, maxZoom: null }
/** Small things shouldn't take the whole screen. */
const SMALL: Preset = { fill: 0.6, maxZoom: 4 }

/** tldraw's own shapes that are worth looking at. Arrows, drawings and plain boxes are not. */
const NATIVE_PRESETS: Record<string, Preset> = {
	image: PICTURE,
	video: PICTURE,
	frame: PICTURE,
	note: SMALL,
	text: SMALL,
}

const ANIMATION = { animation: { duration: 250 } }

const states = new WeakMap<Editor, Atom<QuickLookState | null>>()

function stateOf(editor: Editor): Atom<QuickLookState | null> {
	let state = states.get(editor)
	if (!state) {
		state = atom<QuickLookState | null>('lifeboard:quick-look', null)
		states.set(editor, state)
	}
	return state
}

export function getQuickLook(editor: Editor): QuickLookState | null {
	return stateOf(editor).get()
}

/** The shape on screen, or `null` when no preview is open. */
export function getQuickLookShapeId(editor: Editor): TLShapeId | null {
	const state = getQuickLook(editor)
	return state ? (state.ids[state.index] ?? null) : null
}

export function presetFor(type: string): Preset | null {
	const def = getNodeDefinition(type)
	if (def) return { ...DOCUMENT, ...def.quickLook }
	return NATIVE_PRESETS[type] ?? null
}

function isPreviewable(editor: Editor, id: TLShapeId): boolean {
	const shape = editor.getShape(id)
	return !!shape && presetFor(shape.type) !== null && !editor.isShapeHidden(shape)
}

/** Whether Space has anything to show: some selected shape that can be previewed. */
export function canQuickLook(editor: Editor): boolean {
	return editor.getSelectedShapeIds().some((id) => isPreviewable(editor, id))
}

/**
 * Top-to-bottom rows, left-to-right within a row. A box joins the current row when its centre sits
 * above the bottom of the row's first box, so a slightly taller or lower neighbour doesn't start a
 * row of its own.
 */
export function readingOrder<T extends BoxModel>(boxes: readonly T[]): T[] {
	const sorted = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x)
	const rows: T[][] = []
	let rowBottom = -Infinity
	for (const box of sorted) {
		const row = rows.at(-1)
		if (row && box.y + box.h / 2 < rowBottom) row.push(box)
		else {
			rows.push([box])
			rowBottom = box.y + box.h
		}
	}
	return rows.flatMap((row) => row.sort((a, b) => a.x - b.x))
}

/** The camera that centres `bounds` in the viewport at the preset's size. */
export function fitCamera(
	bounds: BoxModel,
	viewport: { w: number; h: number },
	preset: Preset,
	zoomLimit: number
): { x: number; y: number; z: number } {
	const z = Math.min(
		(viewport.w * preset.fill) / bounds.w,
		(viewport.h * preset.fill) / bounds.h,
		preset.maxZoom ?? zoomLimit,
		zoomLimit
	)
	return {
		x: -bounds.x + (viewport.w - bounds.w * z) / 2 / z,
		y: -bounds.y + (viewport.h - bounds.h * z) / 2 / z,
		z,
	}
}

/**
 * The preview's order: the selection if several shapes are selected, otherwise every previewable
 * sibling of the one selected shape. Siblings rather than the whole page, so a node inside a frame
 * steps through its frame, and a frame on the page steps past its children as one slide.
 */
function cycleFor(editor: Editor): { ids: TLShapeId[]; index: number } | null {
	const selected = editor.getSelectedShapeIds().filter((id) => isPreviewable(editor, id))
	const first = selected[0]
	if (!first) return null
	const pool =
		selected.length > 1
			? selected
			: editor
					.getSortedChildIdsForParent(editor.getShape(first)!.parentId)
					.filter((id) => isPreviewable(editor, id))
	const boxes = pool.flatMap((id) => {
		const bounds = editor.getShapePageBounds(id)
		return bounds ? [{ id, x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h }] : []
	})
	const ids = readingOrder(boxes).map((box) => box.id)
	return { ids, index: selected.length > 1 ? 0 : Math.max(0, ids.indexOf(first)) }
}

function frameShape(editor: Editor, id: TLShapeId, immediate = false): void {
	const shape = editor.getShape(id)
	const bounds = editor.getShapePageBounds(id)
	const preset = shape && presetFor(shape.type)
	if (!bounds || !preset) return
	const viewport = editor.getViewportScreenBounds()
	// A zero-sized viewport or shape fits to NaN, and `setCamera` throws on that since tldraw 5.5.
	if (!viewport.w || !viewport.h || !bounds.w || !bounds.h) return
	const zoomLimit = editor.getCameraOptions().zoomSteps.at(-1)! * editor.getBaseZoom()
	editor.setCamera(fitCamera(bounds, viewport, preset, zoomLimit), {
		force: true,
		...(immediate ? {} : ANIMATION),
	})
}

export function openQuickLook(editor: Editor): boolean {
	if (getQuickLook(editor)) return true
	const cycle = cycleFor(editor)
	if (!cycle) return false
	const cameraOptions = editor.getCameraOptions()
	stateOf(editor).set({ ...cycle, camera: editor.getCamera(), cameraOptions })
	editor.setCameraOptions({ ...cameraOptions, isLocked: true })
	showCurrent(editor)
	return true
}

export function closeQuickLook(editor: Editor, { animate = true } = {}): void {
	const state = getQuickLook(editor)
	if (!state) return
	stateOf(editor).set(null)
	editor.setCameraOptions(state.cameraOptions)
	editor.setCamera(state.camera, { force: true, ...(animate ? ANIMATION : {}) })
}

export function toggleQuickLook(editor: Editor): void {
	if (getQuickLook(editor)) closeQuickLook(editor)
	else openQuickLook(editor)
}

/** ← and →. Wraps around, the way Quick look steps through a folder. */
export function stepQuickLook(editor: Editor, delta: 1 | -1): void {
	const state = getQuickLook(editor)
	if (!state || state.ids.length < 2) return
	const index = (state.index + delta + state.ids.length) % state.ids.length
	stateOf(editor).set({ ...state, index })
	showCurrent(editor)
}

/** Re-centres on the current shape, e.g. after the window was resized. */
export function refitQuickLook(editor: Editor): void {
	const id = getQuickLookShapeId(editor)
	if (id) frameShape(editor, id, true)
}

/** The shape on screen is also the selection, so Enter edits the thing you are looking at. */
function showCurrent(editor: Editor): void {
	const id = getQuickLookShapeId(editor)
	if (!id) return
	editor.select(id)
	frameShape(editor, id)
}
