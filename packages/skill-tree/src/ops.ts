import { connectShapes, updateShapeProperties } from '@lifeboard/node-kit'
import { createShapeId, type Editor, type TLShapeId } from '@lifeboard/canvas'
import {
	childrenOf,
	evidenceNoteFor,
	isHiddenByCollapse,
	isItem,
	isTrack,
	ITEM_TYPE,
	NOTE_TYPE,
	progressOf,
	TRACK_TYPE,
	type ItemShape,
	type SkillItemProps,
	type TrackShape,
} from './board'
import { formatOrder, makeItemId, parseOrder, todayIso, type ItemKind } from './model'
import { ensureProperties, hideOnCard, isDone, PROP_ID, readText } from './properties'
import { templateFor } from './templates'

/**
 * Everything that changes the syllabus on a board. Each function is one undo entry.
 *
 * Completion is the centre of it (docs/skill-tree-plan.md, "Completion and evidence"): ticking an item
 * sets Done and Done at, files a note from the item's template beside it, and walks up the parents so
 * a unit whose core steps are done is done too.
 */

export const ITEM_WIDTH = 260
export const ITEM_HEIGHT = 56
const NOTE_WIDTH = 300
const GAP = 40
const CHILD_GAP = 12

/** Ticks or unticks an item. A parent's own tick is derived from its children, so it is left alone. */
export function setItemDone(editor: Editor, itemId: TLShapeId, done: boolean): void {
	const item = editor.getShape(itemId)
	if (!isItem(item)) return
	if (childrenOf(editor, item.id).length > 0) return

	editor.run(() => {
		editor.markHistoryStoppingPoint(done ? 'complete item' : 'reopen item')
		writeDone(editor, item, done)
		if (done) fileEvidence(editor, item)
		updateAncestors(editor, item)
	})
}

export function toggleItemDone(editor: Editor, itemId: TLShapeId): void {
	const item = editor.getShape(itemId)
	if (isItem(item)) setItemDone(editor, itemId, !isDone(item))
}

function writeDone(editor: Editor, item: ItemShape, done: boolean): void {
	ensureProperties(editor, ['done', 'doneAt'])
	const fresh = editor.getShape(item.id) ?? item
	updateShapeProperties(editor, fresh, {
		[PROP_ID.done]: done,
		[PROP_ID.doneAt]: done ? todayIso() : null,
	})
	hideOnCard(editor, item.id, ['done', 'doneAt'])
}

/**
 * Puts the item's evidence note beside it, from its medium's template, unless it already has one.
 *
 * Reused rather than replaced on a second tick: unticking keeps the note, because it may hold writing,
 * and ticking again should land you back in it.
 */
function fileEvidence(editor: Editor, item: ItemShape): void {
	if (!item.props.itemId || evidenceNoteFor(editor, item.props.itemId)) return
	const template = templateFor(readText(item, 'medium'))
	const noteId = createShapeId()
	editor.createShape({
		id: noteId,
		type: NOTE_TYPE,
		...notePosition(editor, item),
		props: { md: `# ${item.props.title || 'Notes'}\n\n${template.md}`, autoHeight: true, w: NOTE_WIDTH },
	} as never)
	ensureProperties(editor, ['evidenceOf', 'method'])
	const note = editor.getShape(noteId)
	if (note) {
		updateShapeProperties(editor, note, {
			[PROP_ID.evidenceOf]: item.props.itemId,
			[PROP_ID.method]: template.method,
		})
		// The item id means nothing to read; the method is worth seeing on the note.
		hideOnCard(editor, noteId, ['evidenceOf'])
	}
	connectShapes(editor, item.id, noteId, { hidden: true })
}

/**
 * Where an item's note goes: to the right of the card you can see (the item, or the collapsed parent
 * hiding it), below any notes already filed there for it or its family.
 */
function notePosition(editor: Editor, item: ItemShape): { x: number; y: number } {
	let anchor: ItemShape = item
	for (let depth = 0; isHiddenByCollapse(editor, anchor) && anchor.props.parentId && depth < 16; depth++) {
		const parent = editor.getShape(anchor.props.parentId as TLShapeId)
		if (!isItem(parent)) break
		anchor = parent
	}
	const bounds = editor.getShapePageBounds(anchor.id)
	const x = (bounds?.maxX ?? anchor.x) + GAP
	let y = bounds?.y ?? anchor.y
	const family = new Set(descendantItemIds(editor, anchor))
	for (const shape of editor.getCurrentPageShapes()) {
		if ((shape.type as string) !== NOTE_TYPE || !family.has(readText(shape, 'evidenceOf'))) continue
		const noteBounds = editor.getShapePageBounds(shape.id)
		if (noteBounds && Math.abs(noteBounds.x - x) < 1) y = Math.max(y, noteBounds.maxY + CHILD_GAP)
	}
	return { x, y }
}

/** The item's own id and every descendant's, depth first. */
function descendantItemIds(editor: Editor, item: ItemShape, depth = 0): string[] {
	if (depth > 16) return []
	return [item.props.itemId, ...childrenOf(editor, item.id).flatMap((child) => descendantItemIds(editor, child, depth + 1))]
}

/** Recomputes Done for every ancestor, so finishing a unit's last core step finishes the unit. */
function updateAncestors(editor: Editor, item: ItemShape): void {
	let parentId = item.props.parentId
	for (let depth = 0; parentId && depth < 16; depth++) {
		const parent = editor.getShape(parentId as TLShapeId)
		if (!isItem(parent)) return
		const complete = progressOf(editor, parent).complete
		if (complete !== isDone(parent)) writeDone(editor, parent, complete)
		parentId = parent.props.parentId
	}
}

export interface NewItem {
	title: string
	kind?: ItemKind
	medium?: string
	core?: boolean
	childRule?: string
	tags?: string
	itemId?: string
	collapsed?: boolean
}

/** Creates an item shape with its Kind and Medium filled in. Returns its id. */
export function createItem(
	editor: Editor,
	spec: NewItem,
	at: { x: number; y: number },
	parentId: TLShapeId | '' = ''
): TLShapeId {
	const id = createShapeId()
	const props: Partial<SkillItemProps> = {
		itemId: spec.itemId ?? makeItemId(spec.title),
		title: spec.title,
		parentId,
		core: spec.core ?? false,
		childRule: spec.childRule ?? 'core',
		collapsed: spec.collapsed ?? false,
		tags: spec.tags ?? '',
	}
	editor.run(() => {
		editor.createShape({ id, type: ITEM_TYPE, x: at.x, y: at.y, props } as never)
		ensureProperties(editor, ['kind', 'medium'])
		const shape = editor.getShape(id)
		if (shape && (spec.kind || spec.medium)) {
			updateShapeProperties(editor, shape, {
				...(spec.kind ? { [PROP_ID.kind]: spec.kind } : {}),
				...(spec.medium ? { [PROP_ID.medium]: spec.medium } : {}),
			})
		}
		hideOnCard(editor, id, ['kind', 'medium'])
	})
	return id
}

/** Where the next child of a parent goes: a column to its right, below the children it has. */
function nextChildPosition(editor: Editor, parent: ItemShape): { x: number; y: number } {
	const bounds = editor.getShapePageBounds(parent.id)
	const x = (bounds?.maxX ?? parent.x) + GAP
	let y = bounds?.y ?? parent.y
	for (const child of childrenOf(editor, parent.id)) {
		const childBounds = editor.getShapePageBounds(child.id)
		if (childBounds) y = Math.max(y, childBounds.maxY + CHILD_GAP)
	}
	return { x, y }
}

/** Adds a child under a parent, related to it by a hidden relation, and expands the parent. */
export function addChildItem(
	editor: Editor,
	parentId: TLShapeId,
	spec: NewItem,
	/** Off when an outer `editor.run` already owns the undo entry. */
	mark = true
): TLShapeId | null {
	const parent = editor.getShape(parentId)
	if (!isItem(parent)) return null
	let childId: TLShapeId | null = null
	editor.run(() => {
		if (mark) editor.markHistoryStoppingPoint('add child item')
		if (parent.props.collapsed) editor.updateShape({ id: parent.id, type: ITEM_TYPE, props: { collapsed: false } })
		const fresh = editor.getShape(parent.id) as ItemShape
		childId = createItem(editor, spec, nextChildPosition(editor, fresh), parent.id)
		connectShapes(editor, parent.id, childId, { hidden: true })
		updateAncestors(editor, editor.getShape(childId) as ItemShape)
	})
	return childId
}

export function setCollapsed(editor: Editor, itemId: TLShapeId, collapsed: boolean, mark = true): void {
	const item = editor.getShape(itemId)
	if (!isItem(item) || item.props.collapsed === collapsed) return
	editor.run(() => {
		if (mark) editor.markHistoryStoppingPoint(collapsed ? 'collapse item' : 'expand item')
		editor.updateShape({ id: item.id, type: ITEM_TYPE, props: { collapsed } })
		// A collapsed child can't stay selected: it is no longer drawn.
		if (collapsed) {
			const hidden = new Set(childrenOf(editor, item.id).map((c) => c.id))
			editor.setSelectedShapes(editor.getSelectedShapeIds().filter((id) => !hidden.has(id)))
		}
	})
}

/** Lays a parent's children out again as a column to its right, in their current order. */
export function arrangeChildren(editor: Editor, parentId: TLShapeId): void {
	const parent = editor.getShape(parentId)
	if (!isItem(parent)) return
	const children = childrenOf(editor, parent.id)
	if (children.length === 0) return
	const bounds = editor.getShapePageBounds(parent.id)
	const x = (bounds?.maxX ?? parent.x) + GAP
	let y = bounds?.y ?? parent.y
	editor.run(() => {
		editor.markHistoryStoppingPoint('arrange children')
		for (const child of children) {
			editor.updateShape({ id: child.id, type: ITEM_TYPE, x, y })
			y += (editor.getShapePageBounds(child.id)?.h ?? ITEM_HEIGHT) + CHILD_GAP
		}
	})
}

export interface NewTrack {
	name: string
	goal?: string
	trackId?: string
	itemIds?: readonly string[]
	state?: 'active' | 'paused' | 'notStarted'
	defaultTags?: string
}

export function createTrack(editor: Editor, spec: NewTrack, at: { x: number; y: number }): TLShapeId {
	const id = createShapeId()
	editor.createShape({
		id,
		type: TRACK_TYPE,
		x: at.x,
		y: at.y,
		props: {
			trackId: spec.trackId ?? makeItemId(spec.name, 'track/'),
			name: spec.name,
			goal: spec.goal ?? '',
			state: spec.state ?? 'notStarted',
			order: formatOrder(spec.itemIds ?? []),
			defaultTags: spec.defaultTags ?? '',
		},
	} as never)
	return id
}

/** Top-level items among the selection, in reading order. Children travel with their parent. */
export function selectedTopItems(editor: Editor): ItemShape[] {
	return editor
		.getSelectedShapes()
		.filter(isItem)
		.filter((item) => !item.props.parentId)
		.sort((a, b) => a.y - b.y || a.x - b.x)
}

/** Makes a track of the selected items, to their left. */
export function trackFromSelection(editor: Editor): TLShapeId | null {
	const items = selectedTopItems(editor)
	if (items.length === 0) return null
	const bounds = editor.getSelectionPageBounds()
	let id: TLShapeId | null = null
	editor.run(() => {
		editor.markHistoryStoppingPoint('make track')
		id = createTrack(
			editor,
			{ name: 'New track', itemIds: items.map((item) => item.props.itemId), state: 'active' },
			{ x: (bounds?.x ?? 0) - 360 - GAP, y: bounds?.y ?? 0 }
		)
		editor.setSelectedShapes([id])
	})
	return id
}

/** Appends the selected items to the selected track, keeping the order it already has. */
export function addSelectionToTrack(editor: Editor): void {
	const track = editor.getSelectedShapes().find(isTrack)
	if (!track) return
	const items = selectedTopItems(editor)
	if (items.length === 0) return
	setTrackOrder(editor, track, [...parseOrder(track.props.order), ...items.map((item) => item.props.itemId)])
}

export function setTrackOrder(editor: Editor, track: TrackShape, ids: readonly string[]): void {
	editor.run(() => {
		editor.markHistoryStoppingPoint('reorder track')
		editor.updateShape({ id: track.id, type: TRACK_TYPE, props: { order: formatOrder(ids) } })
	})
}

/** Moves one id up or down a place in a track. */
export function moveInTrack(editor: Editor, track: TrackShape, itemId: string, delta: -1 | 1): void {
	const order = parseOrder(track.props.order)
	const from = order.indexOf(itemId)
	const to = from + delta
	if (from < 0 || to < 0 || to >= order.length) return
	const [moved] = order.splice(from, 1)
	if (moved !== undefined) order.splice(to, 0, moved)
	setTrackOrder(editor, track, order)
}

export function removeFromTrack(editor: Editor, track: TrackShape, itemId: string): void {
	setTrackOrder(
		editor,
		track,
		parseOrder(track.props.order).filter((id) => id !== itemId)
	)
}

const STATES = ['active', 'paused', 'notStarted'] as const

export function cycleTrackState(editor: Editor, track: TrackShape): void {
	const index = STATES.indexOf(track.props.state as (typeof STATES)[number])
	const next = STATES[(index + 1) % STATES.length]
	editor.run(() => {
		editor.markHistoryStoppingPoint('track state')
		editor.updateShape({ id: track.id, type: TRACK_TYPE, props: { state: next } })
	})
}

/** Pans to an item and selects it, expanding its parents so it is drawn. */
export function revealItem(editor: Editor, item: ItemShape): void {
	editor.run(() => {
		let parentId = item.props.parentId
		for (let depth = 0; parentId && depth < 16; depth++) {
			const parent = editor.getShape(parentId as TLShapeId)
			if (!isItem(parent)) break
			if (parent.props.collapsed) editor.updateShape({ id: parent.id, type: ITEM_TYPE, props: { collapsed: false } })
			parentId = parent.props.parentId
		}
	})
	editor.setSelectedShapes([item.id])
	const bounds = editor.getShapePageBounds(item.id)
	if (bounds) editor.zoomToBounds(bounds, { animation: { duration: 200 }, targetZoom: Math.max(editor.getZoomLevel(), 0.8) })
}

/** The next undone step under a parent, depth first. `null` when the whole item is done. */
export function nextStep(editor: Editor, item: ItemShape): ItemShape | null {
	const children = childrenOf(editor, item.id)
	if (children.length === 0) return isDone(item) ? null : item
	for (const child of children) {
		const step = nextStep(editor, child)
		if (step) return step
	}
	return null
}
