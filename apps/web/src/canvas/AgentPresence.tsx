import { getAgentActivity, subscribeToAgentActivity, type AgentActivity } from '@lifeboard/node-kit'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { useEditor, useValue } from 'tldraw'
import { getAgentPrefs, subscribeToAgentPrefs } from '../agent/prefs'

/**
 * The agent's cursor.
 *
 * Everything an agent does lands in the live editor, in front of whoever is watching — and until this
 * existed, all that reached the person watching was shapes appearing out of nowhere. You could not
 * tell reading from writing, could not tell which note it had just touched, and could not tell a
 * working agent from a stuck one. A named cursor that moves to what it is holding answers all three
 * at a glance, which is why every multiplayer canvas has one.
 *
 * Two parts, and the split is deliberate:
 *
 *  - **The rings** are drawn in page geometry scaled by the camera, so they sit exactly on the shapes
 *    and grow with a zoom, like the shapes do.
 *  - **The cursor** is placed by converting a page point to screen coordinates but drawn at a fixed
 *    size, so it stays a cursor at any zoom rather than becoming a billboard.
 *
 * Both live in `InFrontOfTheCanvas` — *above* the shapes, unlike the tracing aura, because a cursor
 * that a sticky note can cover is not a cursor.
 */

/** How long an activity is held at full strength before it starts to go. */
const HOLD_MS = 2_600
/** The fade itself. Must match `.lb-agent-cursor` / `.lb-agent-ring`'s transition in styles.css. */
const FADE_MS = 700

type Phase = 'live' | 'fading' | 'gone'

/**
 * Ages one activity: shown, then fading, then unmounted.
 *
 * The middle state is what makes it fade at all — an element removed from the tree cannot transition,
 * so it has to survive its own disappearance long enough to animate. Both timers restart on every new
 * report, so a busy agent's cursor never flickers between two pieces of work.
 */
function useActivityPhase(activity: AgentActivity | null): Phase {
	const [phase, setPhase] = useState<Phase>('gone')

	useEffect(() => {
		if (!activity) {
			setPhase('gone')
			return
		}
		setPhase('live')
		const fade = setTimeout(() => setPhase('fading'), HOLD_MS)
		const gone = setTimeout(() => setPhase('gone'), HOLD_MS + FADE_MS)
		return () => {
			clearTimeout(fade)
			clearTimeout(gone)
		}
	}, [activity])

	return phase
}

/**
 * The pointer itself.
 *
 * Drawn rather than reused from tldraw's collaborator cursor: that one is bound to a `presence`
 * record in a multiplayer store, which is a whole subsystem to stand up for a single local agent that
 * has no session, no user id and no other peers.
 */
function CursorArrow() {
	return (
		<svg className="lb-agent-cursor__arrow" viewBox="0 0 20 22" aria-hidden="true">
			<path
				d="M2 1.6 L2 17.4 L6.2 13.6 L9 20 L12 18.7 L9.2 12.6 L15 12.4 Z"
				// Outlined in the page colour so the cursor keeps its shape over a dark node, a photo, or
				// bare paper — the same reason a real pointer has a white border.
				stroke="var(--lb-canvas)"
				strokeWidth="1.4"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

export function AgentPresence() {
	const editor = useEditor()
	const activity = useSyncExternalStore(subscribeToAgentActivity, getAgentActivity)
	const prefs = useSyncExternalStore(subscribeToAgentPrefs, getAgentPrefs)
	const phase = useActivityPhase(activity)

	// Re-read on every camera change, so the overlay stays glued to the board through pans and zooms.
	// A signal rather than an event listener: this is exactly what tldraw's own overlays do.
	const camera = useValue('lifeboard:camera', () => editor.getCamera(), [editor])

	if (!prefs.showPresence || !activity || phase === 'gone') return null
	// Identity, not an id: an agent working on a board behind another tab must not draw on this one.
	if (activity.editor !== editor) return null

	const tip = editor.pageToViewport(activity.point ?? { x: 0, y: 0 })

	return (
		<div
			className={`lb-agent-presence${phase === 'fading' ? ' lb-agent-presence--fading' : ''}`}
			data-kind={activity.kind}
			aria-hidden="true"
		>
			{activity.shapes.map((shape) => {
				const corner = editor.pageToViewport({ x: shape.x, y: shape.y })
				return (
					<div
						className="lb-agent-ring"
						// Keyed by the report as well as the shape, so looking at the same node twice
						// replays the pulse instead of leaving a ring sitting there.
						key={`${activity.seq}:${shape.id}`}
						style={{
							transform: `translate(${corner.x}px, ${corner.y}px)`,
							width: shape.w * camera.z,
							height: shape.h * camera.z,
						}}
					/>
				)
			})}

			{/*
			 * Not keyed by `seq`: the cursor is one object that *moves*, and remounting it per report
			 * would teleport it. Keeping it mounted is what lets the CSS transition glide it from the
			 * last thing the agent touched to this one.
			 */}
			<div
				className="lb-agent-cursor"
				style={{ transform: `translate(${tip.x}px, ${tip.y}px)` }}
			>
				<CursorArrow />
				<div className="lb-agent-cursor__label">
					<span className="lb-agent-cursor__verb">{activity.verb}</span>
					<span className="lb-agent-cursor__op">{activity.operation}</span>
				</div>
			</div>
		</div>
	)
}
