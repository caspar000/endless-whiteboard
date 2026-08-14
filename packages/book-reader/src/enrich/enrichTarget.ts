/**
 * Which book, if any, has its details panel open.
 *
 * Module-scope like the app's own properties target, and for the same reason: a context-menu action
 * is an imperative call with nowhere to hang React state, while the panel has to render inside a
 * shape's component. One id in a tiny store bridges the two.
 *
 * Its own listener set rather than a tldraw atom — an SDK's state must not depend on sharing a
 * reactivity instance with its host (see the note in node-kit's registry).
 */
let target: string | null = null
const listeners = new Set<() => void>()

export function openEnrich(shapeId: string): void {
	target = shapeId
	for (const listener of listeners) listener()
}

export function closeEnrich(): void {
	if (target === null) return
	target = null
	for (const listener of listeners) listener()
}

export function getEnrichTarget(): string | null {
	return target
}

export function subscribeToEnrichTarget(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}
