import type { Editor, TLShape, TLShapeId } from 'tldraw'

/**
 * A minimal stand-in for the handful of `Editor` methods the property layer touches.
 *
 * The point is not to avoid tldraw — it is to make the *hazard* testable. `updateShape` below merges
 * `meta` exactly one level deep, which is what tldraw does (`Editor.ts`: `next.meta = {...prev.meta,
 * ...partial.meta}`) and is the reason the property keys are flat and colon-namespaced. A test that
 * asserted "writing values leaves the sidecar alone" against a deep-merging fake would prove nothing;
 * against this one it fails the moment anybody nests the keys.
 *
 * Only used by tests, so it lives beside them rather than in the package's public surface.
 */
export interface FakeEditor {
	editor: Editor
	shape(id?: string): TLShape
	documentMeta(): Record<string, unknown>
	/** How many `run` calls happened — one user action must be one undo entry (§7). */
	runs: number
}

export function fakeEditor(initial: { shapes?: Record<string, TLShape> } = {}): FakeEditor {
	let documentMeta: Record<string, unknown> = {}
	const shapes = new Map<string, TLShape>(Object.entries(initial.shapes ?? {}))
	const state = { runs: 0 }

	if (!shapes.size) shapes.set('shape:a', makeShape('shape:a'))

	const editor = {
		getDocumentSettings: () => ({ meta: documentMeta }),
		updateDocumentSettings: (partial: { meta?: Record<string, unknown> }) => {
			// tldraw replaces document settings wholesale, which is why every caller spreads the
			// existing meta itself. Reproduced rather than smoothed over.
			if (partial.meta) documentMeta = partial.meta
		},
		run: (fn: () => void) => {
			state.runs++
			fn()
		},
		getShape: (id: string) => shapes.get(id),
		updateShape: (partial: { id: string; meta?: Record<string, unknown> }) => {
			const prev = shapes.get(partial.id)
			if (!prev) return
			shapes.set(partial.id, {
				...prev,
				// The one-level-deep merge. See the note above.
				meta: { ...prev.meta, ...partial.meta },
			} as TLShape)
		},
	} as unknown as Editor

	return {
		editor,
		shape: (id = 'shape:a') => shapes.get(id)!,
		documentMeta: () => documentMeta,
		get runs() {
			return state.runs
		},
	}
}

export function makeShape(id: string, meta: Record<string, unknown> = {}): TLShape {
	return {
		id: id as TLShapeId,
		typeName: 'shape',
		type: 'geo',
		parentId: 'page:page',
		index: 'a1',
		x: 0,
		y: 0,
		rotation: 0,
		isLocked: false,
		opacity: 1,
		props: {},
		meta,
	} as unknown as TLShape
}
