/**
 * A compositor-owned page turn for a reflowable book.
 *
 * Foliate paginates one long iframe into columns, so two adjacent "pages" never exist as two DOM
 * elements that can be layered. A View Transition supplies the missing layer: the browser snapshots
 * the outgoing frame, the renderer moves underneath it, and CSS peels that exact snapshot away.
 * Text shaping, publisher CSS, images, SVG and annotations therefore come from the browser's own
 * paint rather than from our best attempt to reproduce them on a canvas.
 */

const TURN_NAME = 'lb-reader-turn'
const ROOT_CLASSES = [
	'lb-reader-vt',
	'lb-reader-vt--forward',
	'lb-reader-vt--backward',
] as const

type CssSupports = Pick<typeof CSS, 'supports'>

/**
 * API presence alone is not a safe gate: early WebKit implementations can fail while snapshotting
 * an iframe. Nested view-transition groups are the conservative maturity signal used by Readest's
 * Foliate implementation (Chromium/WebView 140+ at the time it shipped).
 */
export function supportsLayeredPageTurn(
	doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
	css: CssSupports | undefined = typeof CSS === 'undefined' ? undefined : CSS
): boolean {
	return (
		!!doc &&
		typeof doc.startViewTransition === 'function' &&
		css?.supports('view-transition-group: nearest') === true
	)
}

export interface LayeredPageTurnOptions {
	frame: HTMLElement
	direction: -1 | 1
	paper: string
	duration: number
	/** The existing reader controls still shape the compositor approximation. */
	curlAngle: number
	curlRadius: number
	navigate(): void | Promise<unknown>
	onStarted?(transition: ViewTransition): void
	onFinished(): void
	document?: Document
	css?: CssSupports
}

/**
 * Starts the transition synchronously so the caller can fall back before navigating when setup is
 * unavailable. Once this returns true, navigation belongs to the transition callback even if the
 * browser later skips or rejects the visual animation.
 */
export function startLayeredPageTurn({
	frame,
	direction,
	paper,
	duration,
	curlAngle,
	curlRadius,
	navigate,
	onStarted,
	onFinished,
	document: suppliedDocument,
	css: suppliedCss,
}: LayeredPageTurnOptions): boolean {
	const doc = suppliedDocument ?? (typeof document === 'undefined' ? undefined : document)
	const css = suppliedCss ?? (typeof CSS === 'undefined' ? undefined : CSS)
	if (!doc || !supportsLayeredPageTurn(doc, css)) return false

	const root = doc.documentElement
	const directionClass = direction > 0 ? 'lb-reader-vt--forward' : 'lb-reader-vt--backward'
	const previousName = frame.style.getPropertyValue('view-transition-name')
	const previousNamePriority = frame.style.getPropertyPriority('view-transition-name')
	const properties = {
		'--lb-reader-vt-paper': paper,
		'--lb-reader-vt-duration': `${Math.max(80, duration)}ms`,
		// Zero degrees lifts from the middle of the edge; forty lifts from the lower corner.
		'--lb-reader-vt-origin-y': `${50 + (58 * Math.min(40, Math.max(0, curlAngle))) / 40}%`,
		// A looser physical roll becomes a wider soft band at this approximation's fold.
		'--lb-reader-vt-fold-softness': `${2 + (10 * Math.min(26, Math.max(3, curlRadius)) - 30) / 23}%`,
	} as const
	const previous = new Map(
		Object.keys(properties).map((name) => [
			name,
			{
				value: root.style.getPropertyValue(name),
				priority: root.style.getPropertyPriority(name),
			},
		])
	)

	frame.style.setProperty('view-transition-name', TURN_NAME)
	root.classList.remove(...ROOT_CLASSES)
	root.classList.add('lb-reader-vt', directionClass)
	for (const [name, value] of Object.entries(properties)) root.style.setProperty(name, value)

	let cleaned = false
	const cleanup = (notifyFinished = true) => {
		if (cleaned) return
		cleaned = true
		root.classList.remove(...ROOT_CLASSES)
		for (const [name, old] of previous) {
			if (old.value) root.style.setProperty(name, old.value, old.priority)
			else root.style.removeProperty(name)
		}
		if (previousName) frame.style.setProperty('view-transition-name', previousName, previousNamePriority)
		else frame.style.removeProperty('view-transition-name')
		if (notifyFinished) onFinished()
	}

	let transition: ViewTransition
	try {
		transition = doc.startViewTransition(async () => {
			await navigate()
			return undefined
		})
	} catch {
		cleanup(false)
		return false
	}
	onStarted?.(transition)
	// A skipped transition still ran (or owns) the navigation callback. Clean up without replaying it.
	void transition.finished.catch(() => undefined).finally(cleanup)
	return true
}
