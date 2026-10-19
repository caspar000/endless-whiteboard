import { atom, useEditor, useValue } from '@lifeboard/canvas'
import { lastBubbles } from './bandReport'

/**
 * The bubble guides (dev builds): every bubble the plain Bubbles layout (tree/bubbles.ts) reserved
 * drawn on the board, the circle round each node's whole subtree, a colour per level out from the
 * start. They show where the room goes: a subtree's circle must clear its parent, so whatever of the
 * circle the subtree doesn't fill lies empty between them. Each circle follows its node when dragged.
 */

const KEY = 'lifeboard:skill-tree-bubble-guides'
const shown = atom<boolean>(KEY, typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === 'true')

export const bubbleGuidesShown = (): boolean => shown.get()

export function showBubbleGuides(on: boolean): void {
	shown.set(on)
	try {
		localStorage.setItem(KEY, String(on))
	} catch {
		// Kept for this session only.
	}
}

const colour = (depth: number) => `hsl(${(depth * 53 + 190) % 360} 80% 60%)`

export function BubbleGuides() {
	const editor = useEditor()
	const on = useValue('lifeboard:skill-tree-bubble-guides-shown', () => shown.get(), [])
	const report = useValue('lifeboard:skill-tree-bubble-report', () => lastBubbles.get(), [])
	const circles = useValue(
		'lifeboard:skill-tree-bubble-circles',
		() => {
			if (!on || !report) return []
			const z = editor.getCamera().z
			return report.flatMap((g) => {
				const b = editor.getShapePageBounds(g.shape)
				if (!b) return []
				const c = editor.pageToViewport({ x: b.center.x + g.dx, y: b.center.y + g.dy })
				const node = editor.pageToViewport(b.center)
				return [{ key: g.id, x: c.x, y: c.y, r: g.r * z, depth: g.depth, node }]
			})
		},
		[editor, on, report]
	)
	if (!on) return null
	if (!report)
		return (
			<svg className="lb-band-guides" aria-hidden>
				<text className="lb-band-guides__label lb-bubble-guides__note" x={24} y={96}>
					Bubble guides: lay the board out with the Bubbles layout to see the bubbles it reserves.
				</text>
			</svg>
		)
	return (
		<svg className="lb-band-guides" aria-hidden>
			{circles.map((c) => (
				<g key={c.key} style={{ color: colour(c.depth) }}>
					<circle className="lb-bubble-guides__bubble" cx={c.x} cy={c.y} r={c.r} />
					<line className="lb-bubble-guides__spoke" x1={c.node.x} y1={c.node.y} x2={c.x} y2={c.y} />
				</g>
			))}
		</svg>
	)
}
