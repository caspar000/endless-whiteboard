/**
 * When it is safe to unmount the editor of a board the user has just left.
 *
 * Two independent reasons the editor has to outlive the navigation, both ending in lost data:
 *
 * 1. tldraw writes to IndexedDB on a throttle and `doPersist()` bails once the sync client is
 *    disposed, so unmounting inside the throttle window discards the pending write permanently.
 * 2. An image upload can still be running. tldraw creates the `asset` record with `src: ''` up front
 *    and fills it in when the upload resolves — from a promise `putExternalContent` never awaits — so
 *    unmounting first strands the image: a shape pointing at a source-less asset, and bytes orphaned
 *    in the blob store.
 *
 * Reason 2 is why the condition is *quiet for a whole window*, not *nothing running right now*. Those
 * differ in a way that cost a real image: an upload that starts and finishes between two ticks is
 * never observed as running, and its `src` write — subject to reason 1 — was discarded milliseconds
 * later. So the caller reports **when work last happened**, and the drain ends only once a full
 * window has passed since then. Anything sampled is a gap.
 *
 * Kept out of the component because the rule is easy to get subtly wrong and hard to observe: getting
 * it wrong loses a photo, silently, only when the timing lines up.
 */
export interface DrainOptions {
	/** How long the store must be quiet before unmounting. Must exceed tldraw's persist throttle. */
	drainMs: number
	/** Upper bound on the whole drain, so wedged work can't pin a hidden editor forever. */
	maxMs: number
	/**
	 * Timestamp of the most recent activity that will write to the store, or 0 if there has been
	 * none. Work still running must report *now*, so that it always reads as ongoing.
	 */
	lastActivityAt: () => number
	/** Called once, when the editor is safe to unmount. Not called if the drain is cancelled. */
	onDone: () => void
}

/** Starts a drain. Returns a cancel function; cancelling guarantees `onDone` is never called. */
export function startDrain({ drainMs, maxMs, lastActivityAt, onDone }: DrainOptions): () => void {
	const deadline = Date.now() + maxMs
	let timer: ReturnType<typeof setTimeout> | null = null

	const tick = () => {
		const quietFor = Date.now() - lastActivityAt()
		if (quietFor < drainMs && Date.now() < deadline) {
			// Wait out exactly the remainder rather than another whole window, so a board isn't held
			// open longer than the rule requires.
			timer = setTimeout(tick, drainMs - quietFor)
			return
		}
		timer = null
		onDone()
	}

	timer = setTimeout(tick, drainMs)

	return () => {
		if (timer) clearTimeout(timer)
		timer = null
	}
}
