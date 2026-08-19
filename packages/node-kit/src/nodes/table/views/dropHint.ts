import { atom } from 'tldraw'

/**
 * Which lane of which view is lit up while a drag hovers over it.
 *
 * An atom rather than shape state: it changes on every pointer move, and a board-document write per
 * move would push a drag's worth of records through tldraw's persistence throttle for something nobody
 * wants persisted. Read by the kanban chrome with `useValue`, which works here because both sides are
 * inside node-kit and so share one copy of tldraw's signal library — see the warning in `registry.tsx`
 * about what happens when they do not.
 *
 * **Its own module, deliberately.** The chrome needs to read the hint and nothing else about dropping;
 * when this lived in `interaction.ts` the view registry ended up importing the whole drop behaviour,
 * which imports the query engine, which imports the node definition — and the definition builds its
 * commands from the registry at module scope, so the cycle closed on a half-initialised `VIEWS` and
 * every import of it threw. A leaf module keeps the chrome's dependency a leaf.
 */
const dropHint = atom<{ viewId: string; lane: string } | null>('lifeboard:view-drop-hint', null)

export function getDropHint(): { viewId: string; lane: string } | null {
	return dropHint.get()
}

export function setDropHint(viewId: string, lane: string | null): void {
	const current = dropHint.get()
	if (lane === null) {
		// Only the view that lit the hint may clear it: `onDragShapesOut` on the one being left arrives
		// after `onDragShapesOver` on the one being entered, so an unguarded clear would blank the hint
		// that had just been set while dragging from one kanban straight into another.
		if (current?.viewId === viewId) dropHint.set(null)
		return
	}
	if (current?.viewId === viewId && current.lane === lane) return
	dropHint.set({ viewId, lane })
}
