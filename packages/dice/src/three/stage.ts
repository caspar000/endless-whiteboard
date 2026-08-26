import {
	AmbientLight,
	DirectionalLight,
	Mesh,
	OrthographicCamera,
	PlaneGeometry,
	Quaternion,
	Scene,
	ShadowMaterial,
	WebGLRenderer,
} from 'three'
import type { Editor } from 'tldraw'
import type { RolledDie } from '../roll'
import { toneFor } from '../DieIcon'
import { geometryFor, inkResultFace, materialsFor, resultInk } from './mesh'
import { bodyCount, bodySolidsForRoll, physicalDiceFor } from './physical'
import { THROW_SCALE, THROW_STEP, simulateThrow, type Throw } from './simulate'
import { flipY, toPage } from './space'
import { bodyColourFor } from '../prefs'
import { upFace } from './faces'
import type { DieKind } from '../kinds'

/**
 * The dice, on the board.
 *
 * Two decisions shape this whole file.
 *
 * **The world is measured in page units.** One unit here is one unit of tldraw's page space, and the
 * camera's frustum is set from `editor.getViewportPageBounds()` on every frame. That is what makes the
 * dice roll *on* the paper rather than in a scene that has to be mapped onto it: they land where you
 * released them, they scale when you zoom, and they stay put when you pan. The paper is the floor, at
 * z = 0, and the single y flip between page space and this one lives in `space.ts` — read its comment
 * before touching a coordinate here, because getting it wrong renders the dice as if seen from beneath
 * the board.
 *
 * **The camera looks straight down.** A tilted camera would be more dramatic and would break the
 * previous paragraph: a die at the top of the screen would project away from its page point. Looking
 * down is also simply how you read a number off a die. The three-dimensionality comes from the tumble
 * and the lighting, not from the angle.
 *
 * Nothing is simulated here. `simulate.ts` has already produced the whole throw as keyframes, so this
 * interpolates between two of them per frame — which is why forty dice cost the same as one, and why a
 * dropped frame cannot change where anything lands.
 */

/** How long the dice sit still, once settled, before they fade out. */
const LINGER_MS = 1_400
const FADE_MS = 450

interface Die {
	mesh: Mesh
	/** Index into a frame's body list. */
	body: number
	/** Which solid it is, and what is printed on each of its faces — for `readFaces` below. */
	solid: DieKind
	labels: readonly string[]
	/** The face that will be on top, and the colour to ink it — applied only once it has landed. */
	result: { face: number; ink: string } | null
}

export interface Stage {
	/**
	 * Throws a roll at a page point, replacing whatever was on the stage.
	 *
	 * `onSettled` fires when the tumble finishes — immediately, if it is being skipped — with the
	 * resting pile in **page** coordinates, so the caller can put a readout above the dice rather than
	 * over them.
	 */
	play(
		dice: readonly RolledDie[],
		at: { x: number; y: number },
		animate: boolean,
		onSettled: (pile: { top: number; centreX: number }) => void
	): void
	resize(): void
	dispose(): void
	/**
	 * What each die is *actually showing the camera*, read back off the live meshes.
	 *
	 * A debug seam, in the spirit of the `window.editor` the board already exposes: it is the only way to
	 * check that the numbers on screen are the numbers that were rolled, since everything between the two
	 * is a matrix and a texture. Used by the e2e suite, which cannot read a numeral out of a WebGL canvas.
	 */
	readFaces(): { label: string; alignment: number }[]
}

/**
 * Builds the stage over a canvas element.
 *
 * The renderer is created once per board and kept: WebGL context creation is expensive and browsers cap
 * how many can exist at a time, so churning one per roll would eventually start losing contexts.
 */
export function createStage(canvas: HTMLCanvasElement, editor: Editor): Stage {
	const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true })
	// Capped at 2: past that a die's numerals are not any more legible and the fill cost doubles again.
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
	renderer.shadowMap.enabled = true

	const scene = new Scene()
	const camera = new OrthographicCamera()
	camera.up.set(0, 1, 0)

	scene.add(new AmbientLight(0xffffff, 1.6))
	// Off to one side rather than overhead, so faces facing different ways read differently as the die
	// turns. Straight down would light every upward face identically and flatten the tumble.
	const sun = new DirectionalLight(0xffffff, 2.1)
	sun.position.set(-320, 420, 700)
	sun.castShadow = true
	sun.shadow.mapSize.set(1024, 1024)
	scene.add(sun)

	/*
	 * The paper, as something that catches a shadow and is otherwise invisible.
	 *
	 * `ShadowMaterial` renders only what is shadowed, so the board shows through everywhere else. The
	 * shadow is what sells contact: without it the dice read as floating over the board rather than
	 * lying on it.
	 */
	const floor = new Mesh(new PlaneGeometry(4000, 4000), new ShadowMaterial({ opacity: 0.22 }))
	floor.receiveShadow = true
	scene.add(floor)

	let dice: Die[] = []
	let current: Throw | null = null
	let origin = { x: 0, y: 0 }
	let startedAt = 0
	let animate = true
	let frame = 0
	let settledReported = false
	let reportSettled: ((pile: { top: number; centreX: number }) => void) | null = null

	/**
	 * The resting pile, converted back into page space.
	 *
	 * Read off the final recorded frame rather than the live meshes, so it is the same answer whether or
	 * not the animation was played — the two must agree, since one of them is what the e2e suite sees.
	 */
	function restingPile(): { top: number; centreX: number } {
		const last = current?.frames.at(-1)
		if (!last?.length) return { top: origin.y, centreX: origin.x }
		const points = last.map((body) => toPage(origin, body.position))
		const xs = points.map((p) => p.x)
		return {
			// The *smallest* page y is the highest on screen, minus a radius so the card clears the top of
			// the topmost die rather than its centre.
			top: Math.min(...points.map((p) => p.y)) - THROW_SCALE.radius,
			centreX: (Math.min(...xs) + Math.max(...xs)) / 2,
		}
	}

	function clear(): void {
		for (const die of dice) {
			scene.remove(die.mesh)
			const material = die.mesh.material
			if (Array.isArray(material)) for (const m of material) m.dispose()
		}
		dice = []
		current = null
	}

	function syncCamera(): void {
		const bounds = editor.getViewportPageBounds()
		// The frustum is the viewport, in page units, with y flipped once (see space.ts). Everything the
		// camera frames is therefore exactly what the board is showing, at whatever zoom it is showing it.
		camera.left = bounds.minX
		camera.right = bounds.maxX
		camera.top = flipY(bounds.minY)
		camera.bottom = flipY(bounds.maxY)
		camera.near = -4000
		camera.far = 4000
		camera.position.set(0, 0, 2000)
		camera.updateProjectionMatrix()

		const container = editor.getContainer()
		const { clientWidth, clientHeight } = container
		if (clientWidth && clientHeight) renderer.setSize(clientWidth, clientHeight, false)

		// The sun follows the view, so the light comes from the same direction wherever you have panned to.
		const centre = bounds.center
		sun.position.set(centre.x - 320, flipY(centre.y) + 420, 700)
		sun.target.position.set(centre.x, flipY(centre.y), 0)
		sun.target.updateMatrixWorld()
		// A shadow camera wide enough for the throw, and no wider — its resolution is spread over it.
		const span = 420
		sun.shadow.camera.left = -span
		sun.shadow.camera.right = span
		sun.shadow.camera.top = span
		sun.shadow.camera.bottom = -span
		sun.shadow.camera.near = 1
		sun.shadow.camera.far = 2600
		sun.shadow.camera.updateProjectionMatrix()
		floor.position.set(centre.x, flipY(centre.y), 0)
	}

	const from = new Quaternion()
	const to = new Quaternion()

	/** Places every die at time `t` seconds into the recorded throw. */
	function poseAt(seconds: number): void {
		if (!current || current.frames.length === 0) return
		const exact = seconds / THROW_STEP
		const last = current.frames.length - 1
		const lower = Math.min(Math.floor(exact), last)
		const upper = Math.min(lower + 1, last)
		const blend = upper === lower ? 0 : exact - lower
		const a = current.frames[lower]!
		const b = current.frames[upper]!

		for (const die of dice) {
			const pa = a[die.body]!
			const pb = b[die.body]!
			// Only the page *origin* is converted (see space.ts); the simulation already runs in this
			// world, so its offsets and orientations are used exactly as recorded.
			die.mesh.position.set(
				origin.x + pa.position[0] + (pb.position[0] - pa.position[0]) * blend,
				flipY(origin.y) + pa.position[1] + (pb.position[1] - pa.position[1]) * blend,
				pa.position[2] + (pb.position[2] - pa.position[2]) * blend
			)
			from.set(...pa.orientation)
			to.set(...pb.orientation)
			// Slerp, not a component lerp: a lerp between two rotations more than a little apart both
			// shrinks the quaternion and takes a visibly wrong path, which on a tumbling die reads as a
			// stutter.
			from.slerp(to, blend)
			// Untouched. There is no mirroring to undo — that was the bug: negating one axis reflects the
			// scene, and the dice then read as though seen from under the board.
			die.mesh.quaternion.copy(from)
		}
	}

	function render(): void {
		if (!current) return
		syncCamera()
		const elapsed = performance.now() - startedAt
		// Zero when the tumble is skipped: the dice are already at rest, so the linger starts at once.
		const settleMs = animate ? current.duration * 1000 : 0

		if (animate) poseAt(Math.min(elapsed, settleMs) / 1000)
		if (!settledReported && elapsed >= settleMs) {
			settledReported = true
			// The answer is coloured *now*, not when the die was built: a tinted face mid-tumble would
			// give the result away before the die had landed.
			for (const die of dice) {
				if (die.result) inkResultFace(die.mesh, die.solid, die.labels, die.result.face, die.result.ink)
			}
			reportSettled?.(restingPile())
		}

		const after = elapsed - settleMs
		const fading = after > LINGER_MS
		const opacity = fading ? Math.max(0, 1 - (after - LINGER_MS) / FADE_MS) : 1
		for (const die of dice) {
			const material = die.mesh.material
			if (Array.isArray(material)) {
				for (const m of material) {
					m.opacity = opacity
					m.transparent = opacity < 1
				}
			}
		}
		;(floor.material as ShadowMaterial).opacity = 0.22 * opacity

		renderer.render(scene, camera)

		if (opacity <= 0) {
			clear()
			renderer.clear()
			return
		}
		frame = requestAnimationFrame(render)
	}

	return {
		play(rolled, at, shouldAnimate, onSettled) {
			cancelAnimationFrame(frame)
			clear()
			origin = at
			animate = shouldAnimate
			settledReported = false
			reportSettled = onSettled

			const solids = bodySolidsForRoll(rolled)
			current = simulateThrow(solids)

			// Hand each rolled die the faces its bodies settled on, and let it renumber itself so the
			// value already drawn is the one showing. This is the whole "physics is theatre" trick.
			let body = 0
			for (const die of rolled) {
				const bodies = bodyCount(die.kind)
				const settled = current.settled.slice(body, body + bodies)
				// The roll's own colour, so the face that landed on top is the one thing on the die that is
				// not black — see `materialsFor`. Read from the *rolled* die, since a percentile pair's two
				// halves share one result.
				const tone = toneFor(die.kind, die.value)
				const ink = tone ? resultInk(tone.side, tone.strength, bodyColourFor(die.kind)) : null
				for (const physical of physicalDiceFor(die, settled)) {
					const mesh = new Mesh(
						geometryFor(physical.solid),
						materialsFor(physical.solid, physical.labels)
					)
					mesh.castShadow = true
					scene.add(mesh)
					dice.push({
						mesh,
						body,
						solid: physical.solid,
						labels: physical.labels,
						result: ink ? { face: physical.wantedFace, ink } : null,
					})
					body += 1
				}
			}

			startedAt = performance.now()
			// Skipping the tumble means starting at the last frame, which is by construction the same
			// result — see `simulate.ts`. That is all `prefers-reduced-motion` and the e2e suite need.
			if (!animate) {
				poseAt(current.duration)
				// Reported here rather than waiting for the first frame, so a skipped roll's number is on
				// screen in the same tick the dice appear in. Nothing to spoil when there is no tumble.
				settledReported = true
				for (const die of dice) {
					if (die.result) {
						inkResultFace(die.mesh, die.solid, die.labels, die.result.face, die.result.ink)
					}
				}
				onSettled(restingPile())
			}
			frame = requestAnimationFrame(render)
		},
		readFaces() {
			return dice.map((die) => {
				// Read from the mesh's own quaternion, not from the recorded frame: this has to reflect what
				// was drawn, including anything the renderer did to it on the way.
				const q = die.mesh.quaternion
				const up = upFace(die.solid, { x: q.x, y: q.y, z: q.z, w: q.w })
				return { label: die.labels[up.index] ?? '?', alignment: up.alignment }
			})
		},
		resize: syncCamera,
		dispose() {
			cancelAnimationFrame(frame)
			clear()
			floor.geometry.dispose()
			;(floor.material as ShadowMaterial).dispose()
			renderer.dispose()
		},
	}
}
