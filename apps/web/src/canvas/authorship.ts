import type { Editor, TLShape } from '@lifeboard/canvas'
import { currentAccount } from '../server/accounts'

/**
 * Who made a shape and who changed it last (docs/fork-parity.md S6), kept in the shape's `meta` as
 * `lbBy`: account ids and when. Stamped by the editor that makes the change, on a server board, so it
 * syncs, works offline and travels with the shape like everything else about it. A paste is a making:
 * the copy is the paster's.
 */
export interface Authorship {
	/** The account that made it. */
	created: string
	/** The account that changed it last. */
	edited: string
	/** When, in ms. */
	at: number
}

/** How old "edited" may get before the same person's next change renews it. */
const RESTAMP_MS = 60_000

export function readAuthorship(shape: TLShape): Authorship | null {
	const by = (shape.meta as { lbBy?: unknown }).lbBy
	if (!by || typeof by !== 'object') return null
	const { created, edited, at } = by as Partial<Authorship>
	return typeof created === 'string' && typeof edited === 'string' && typeof at === 'number' ? { created, edited, at } : null
}

/** Stamps the person's own changes to shapes, as they make them. Returns the way to stop. */
export function trackAuthorship(editor: Editor): () => void {
	const stamp = (shape: TLShape, made: boolean): TLShape => {
		const me = currentAccount.get()
		if (!me) return shape
		const was = readAuthorship(shape)
		// Already this person's, and recently: left as it is. A drag rewrites a shape every frame, and a
		// new `meta` each time would make everything that reads it (properties, expressions) look again.
		if (!made && was?.edited === me.id && Date.now() - was.at < RESTAMP_MS) return shape
		const lbBy: Authorship = { created: made || !was ? me.id : was.created, edited: me.id, at: Date.now() }
		return { ...shape, meta: { ...shape.meta, lbBy: { ...lbBy } } }
	}

	const stopCreate = editor.sideEffects.registerBeforeCreateHandler('shape', (shape, source) =>
		source === 'user' ? stamp(shape, true) : shape
	)
	const stopChange = editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next, source) => {
		if (source !== 'user') return next
		// A change to the stamp alone, or to nothing, is not an edit. Shallow: a changed prop is a new
		// `props` object, and this runs on every frame of a drag.
		const changed = (Object.keys(next) as Array<keyof TLShape>).some((key) =>
			key === 'meta' ? metaChanged(prev.meta, next.meta) : prev[key] !== next[key]
		)
		return changed ? stamp(next, false) : next
	})
	return () => {
		stopCreate()
		stopChange()
	}
}

function metaChanged(prev: TLShape['meta'], next: TLShape['meta']): boolean {
	const keys = new Set([...Object.keys(prev), ...Object.keys(next)])
	keys.delete('lbBy')
	return [...keys].some((key) => prev[key] !== next[key])
}
