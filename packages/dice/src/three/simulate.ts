import { Body, Box, ConvexPolyhedron, Material, SAPBroadphase, Vec3 as CVec3, World } from 'cannon-es'
import type { DieKind } from '../kinds'
import { isCocked, upFace, type Quat } from './faces'
import { circumradius, sizeScale, solidFor } from './solids'

/**
 * The throw, simulated once — headlessly — and recorded as keyframes.
 *
 * This is the piece that decides the whole architecture, so it is worth saying why it is shaped like
 * this. The obvious design steps a physics world inside the render loop. Instead the simulation runs to
 * completion *before the first frame is drawn*, and what it produces is a list of positions and
 * orientations per body per tick. Three things follow, and all three are load-bearing:
 *
 *  - **The outcome exists before the animation does.** So the die can be renumbered to show the number
 *    `crypto.getRandomValues` already drew (`faces.ts`), and the roll is provably uniform rather than
 *    however a physics engine happens to be biased.
 *  - **Nothing simulates during playback.** The render loop interpolates two recorded frames. A board
 *    with forty dice on it costs the same per frame as one with one, and no dropped frame can change
 *    where a die lands.
 *  - **Skipping is free.** `prefers-reduced-motion`, a hidden tab and the e2e suite all just jump to the
 *    last frame, which is by construction the same result the animation would have reached.
 *
 * A cocked die — one resting against another, with no face properly up — is not a result. Rather than
 * fudging a reading, the whole throw is discarded and re-thrown with new initial conditions, invisibly,
 * until it settles cleanly.
 */

/** One body's state at one tick. Plain arrays, so a frame is cheap to store and read. */
export interface BodyFrame {
	position: [number, number, number]
	orientation: [number, number, number, number]
}

export interface Throw {
	/** `frames[tick][body]`. The last tick is the resting pose. */
	frames: BodyFrame[][]
	/** Which face of each body finished upward, indexed the same way as `frames[…]`. */
	settled: number[]
	/** How long the recorded throw lasts, in seconds — what the player paces itself against. */
	duration: number
	/** How many throws were discarded as cocked before this one. Diagnostics only. */
	rejected: number
}

/**
 * Everything about the throw's scale, in **page units** — the same units tldraw measures the board in,
 * which is what lets the dice roll *on* the paper rather than in a scene that has to be mapped onto it.
 *
 * The gravity is not Earth's, and deliberately. At this scale (a die is ~44 units across, so roughly
 * 2.7 units per millimetre) true gravity is about 26,000 units/s², and a die dropped a couple of
 * centimetres lands in under a tenth of a second — physically right and, as a thing to watch,
 * over before it has begun. This is tuned for a roll you can follow; `settles within a watchable
 * window` in the tests is what holds it there.
 */
const SCALE = {
	/** Circumradius of a die, so the widest ones are about 44 units across. */
	radius: 22,
	gravity: 2400,
	/**
	 * Half-width of the invisible box the dice are thrown into, for a *small* hand — see `arenaFor`.
	 *
	 * Tightened from 300 once: with a wide arena and a fast throw, three dice landed most of a screen
	 * apart and stopped reading as one roll, and the result card — which centres itself on the pile —
	 * ended up floating in the gap between them.
	 */
	arena: 250,
	/** How high above the paper they start. */
	dropHeight: 240,
	/** Initial speed, and how much of it is sideways rather than down. */
	speed: 230,
	spin: 22,
} as const

const STEP = 1 / 60
/** 4 seconds. A throw that has not settled by then is not going to be worth watching. */
const MAX_TICKS = 240
/** How many consecutive near-still ticks count as "stopped". */
const STILL_TICKS = 8
const STILL_SPEED = 4
const STILL_SPIN = 0.6

/** How random the throw is. Injected so tests can make one repeatable. */
export type Random = () => number

/**
 * A cannon-es hull for a solid — **one per body, never shared.**
 *
 * The obvious optimisation here is a cache per die kind, since a `ConvexPolyhedron` costs real work to
 * build (normals, unique edges) and shapes look immutable. They are not: cannon-es caches
 * *world-space* vertices and face normals **on the shape**, with `worldVerticesNeedsUpdate` flags, and
 * recomputes them from whichever body is currently being tested. Share one hull between four d20s and
 * they collide against geometry positioned and oriented for a different die.
 *
 * That bug did not look like a physics bug. The dice interpenetrated and came to rest in poses that were
 * not resting on anything, so almost every throw failed the cocked check, burned all eight retries, took
 * seconds of blocked main thread, and finally fell through to "accept whatever came up" — landing dice
 * at angles where the face the simulation called upward was not the face a person would read. It
 * presented as *the numbers on the dice not matching the card*, and only with several dice at once.
 *
 * The vertex arrays are still shared, which is where the allocation actually is.
 */
const hullInputs = new Map<DieKind, { vertices: CVec3[]; faces: number[][] }>()

function hullFor(kind: DieKind): ConvexPolyhedron {
	let input = hullInputs.get(kind)
	if (!input) {
		const { vertices, faces } = solidFor(kind)
		// The same volume-matched scale the mesh is built at, or the picture and the physics would be
		// different sizes — see `sizeScale`.
		const r = SCALE.radius * sizeScale(kind)
		input = {
			vertices: vertices.map(([x, y, z]) => new CVec3(x * r, y * r, z * r)),
			faces: faces.map((face) => [...face]),
		}
		hullInputs.set(kind, input)
	}
	// A fresh shape each time, over shared inputs. cannon-es copies neither, so the vertices are shared
	// too — which is fine, because nothing mutates them; it is the *cached world transforms* that cannot
	// be shared.
	return new ConvexPolyhedron({
		vertices: input.vertices.map((v) => v.clone()),
		faces: input.faces.map((face) => [...face]),
	})
}

/** A unit quaternion from three uniform randoms — Shoemake's method, so no orientation is favoured. */
function randomOrientation(random: Random): [number, number, number, number] {
	const u = random()
	const v = random()
	const w = random()
	const a = Math.sqrt(1 - u)
	const b = Math.sqrt(u)
	return [
		a * Math.sin(2 * Math.PI * v),
		a * Math.cos(2 * Math.PI * v),
		b * Math.sin(2 * Math.PI * w),
		b * Math.cos(2 * Math.PI * w),
	]
}

/**
 * How tall the invisible box has to be.
 *
 * Generous on purpose. The dice are stacked above the paper before the throw, and volume-matching makes
 * some of them half again as wide as the d20 — so a box sized to the *look* of the arena let a big die
 * spawn above the walls, get shoved sideways by a neighbour, and leave. The walls are invisible; making
 * them tall costs nothing and a die that escapes costs the whole roll.
 */
const CEILING = 3_000
/** Thick enough that nothing tunnels through it at the speeds gravity here produces. */
const FLOOR_THICKNESS = 400

/**
 * How much room a hand needs.
 *
 * A fixed arena is right for a handful of dice and wrong for forty: they cannot fit in one layer, so
 * they pile up, jostle each other and never come to rest — a full hand ran to the tick cap without
 * settling, which is the simulation failing rather than the test being strict. Growing with the square
 * root of the count is growing with the *area* they need, which is the thing that was short.
 *
 * Small hands are untouched, so the tight cluster a few dice land in is unchanged.
 */
export function arenaFor(solids: readonly DieKind[]): number {
	const maxExtent = Math.max(...solids.map((kind) => SCALE.radius * circumradius(kind)))
	return Math.max(SCALE.arena, Math.sqrt(solids.length) * maxExtent * 1.5)
}

function buildWorld(arena: number): World {
	const world = new World({ gravity: new CVec3(0, 0, -SCALE.gravity) })
	// Dice hit each other constantly; the naive broadphase is O(n²) and 40 dice is 780 pairs a tick.
	world.broadphase = new SAPBroadphase(world)
	world.allowSleep = true

	// Bouncy enough to tumble, damped enough to stop. A die that keeps its energy never settles, and a
	// dead one lands with a thud and no roll at all.
	const surface = new Material('dice')
	world.defaultContactMaterial.friction = 0.35
	world.defaultContactMaterial.restitution = 0.28

	// The paper, and four walls to keep the throw in sight. Boxes rather than planes: an infinite plane
	// is cheaper but a die that clips a corner of one can tunnel straight through it.
	const floor = new Body({ mass: 0, material: surface })
	floor.addShape(new Box(new CVec3(arena, arena, FLOOR_THICKNESS)))
	floor.position.set(0, 0, -FLOOR_THICKNESS)
	world.addBody(floor)

	for (const [dx, dy] of [
		[1, 0],
		[-1, 0],
		[0, 1],
		[0, -1],
	] as const) {
		const wall = new Body({ mass: 0, material: surface })
		const thickness = 40
		wall.addShape(
			new Box(new CVec3(dx === 0 ? arena : thickness, dy === 0 ? arena : thickness, CEILING))
		)
		wall.position.set(dx * (arena + thickness), dy * (arena + thickness), 0)
		world.addBody(wall)
	}

	return world
}

/**
 * One attempt: throw the given solids and record where they go.
 *
 * Returns `null` if any die finished cocked, which is the caller's signal to throw again. Nothing about
 * the failed attempt is shown to anyone, so a retry costs a few milliseconds and no visible glitch.
 */
function attempt(solids: readonly DieKind[], random: Random, requireFlat: boolean): Throw | null {
	// The widest die in the hand, in page units — what the arena and the spawn geometry are measured in.
	const maxExtent = Math.max(...solids.map((kind) => SCALE.radius * circumradius(kind)))
	const arena = arenaFor(solids)
	const world = buildWorld(arena)

	const bodies = solids.map((kind, index) => {
		const body = new Body({ mass: 12, allowSleep: true })
		body.addShape(hullFor(kind))
		/*
		 * Spawned on a ring rather than a line, sized to the dice and to the arena.
		 *
		 * A line was fine while every die was about the same width and there were a few of them. Once the
		 * dice were matched by *apparent* size the widest became more than twice the narrowest in real
		 * extent, and a line of seven ran clean outside the walls — dice spawned inside each other, the
		 * separation impulses threw them about, and a full set simply never settled.
		 *
		 * A ring gives every die the same room, always fits inside the arena, and needs no case for one
		 * die (the ring collapses to a point). `spacing` is what the circumference has to provide for
		 * neighbours not to overlap; when the arena cannot provide it — a hand of forty — the ring is
		 * capped and the *height* stagger keeps them arriving in sequence instead of as one clump.
		 */
		const spacing = maxExtent * 2.1
		const needed = solids.length > 1 ? (solids.length * spacing) / (2 * Math.PI) : 0
		const ring = Math.min(arena - maxExtent * 1.15, needed)
		const angle = (index / Math.max(solids.length, 1)) * Math.PI * 2
		body.position.set(
			Math.cos(angle) * ring + (random() - 0.5) * maxExtent * 0.3,
			Math.sin(angle) * ring + (random() - 0.5) * maxExtent * 0.3,
			// Staggered in height, so they land in sequence rather than all at once — and bounded, so a
			// full hand still settles inside the tick budget.
			SCALE.dropHeight + index * maxExtent * 0.55
		)
		const [qx, qy, qz, qw] = randomOrientation(random)
		body.quaternion.set(qx, qy, qz, qw)
		body.velocity.set(
			(random() - 0.5) * SCALE.speed,
			(random() - 0.5) * SCALE.speed,
			-SCALE.speed * 0.35
		)
		body.angularVelocity.set(
			(random() - 0.5) * SCALE.spin,
			(random() - 0.5) * SCALE.spin,
			(random() - 0.5) * SCALE.spin
		)
		// Without damping a convex hull on a flat floor can jitter forever on a contact it cannot resolve.
		body.linearDamping = 0.06
		body.angularDamping = 0.12
		world.addBody(body)
		return body
	})

	const frames: BodyFrame[][] = []
	let still = 0

	for (let tick = 0; tick < MAX_TICKS; tick++) {
		// `step(dt)` and emphatically not `fixedStep(dt)`: the latter derives its own delta from the wall
		// clock, so driving it from a tight loop advances the simulation by almost nothing and the dice
		// hang in the air at their drop height. This loop *is* the clock.
		world.step(STEP)
		frames.push(
			bodies.map((body) => ({
				position: [body.position.x, body.position.y, body.position.z],
				orientation: [body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w],
			}))
		)
		const moving = bodies.some(
			(body) => body.velocity.length() > STILL_SPEED || body.angularVelocity.length() > STILL_SPIN
		)
		still = moving ? 0 : still + 1
		if (still >= STILL_TICKS) break
	}

	const settled: number[] = []
	for (const [index, body] of bodies.entries()) {
		const orientation: Quat = {
			x: body.quaternion.x,
			y: body.quaternion.y,
			z: body.quaternion.z,
			w: body.quaternion.w,
		}
		const face = upFace(solids[index]!, orientation)
		// Not a result. Discard the whole throw rather than read a number off a die on its edge — unless
		// we have run out of patience, in which case the most-upward face is still the one to relabel.
		if (requireFlat && isCocked(face)) return null
		settled.push(face.index)
	}

	return { frames, settled, duration: frames.length * STEP, rejected: 0 }
}

/**
 * Throws until it lands cleanly.
 *
 * The retry limit exists so a pathological hand cannot hang the tab. If it is ever reached the last
 * attempt is returned anyway — a slightly tilted die is a far better failure than no roll at all, and
 * the *number* it shows is correct regardless, because the number was never the physics' to decide.
 */
export function simulateThrow(
	solids: readonly DieKind[],
	random: Random = Math.random,
	maxAttempts = 8
): Throw {
	if (solids.length === 0) return { frames: [], settled: [], duration: 0, rejected: 0 }
	for (let rejected = 0; rejected < maxAttempts; rejected++) {
		const clean = attempt(solids, random, true)
		if (clean) return { ...clean, rejected }
	}
	/*
	 * Out of patience. Take the next throw as it comes, tilted die and all.
	 *
	 * Worth being clear about what this costs: nothing about the *result*. The number was drawn before
	 * any of this ran and the labels are rotated onto whichever face finished most nearly up, so a
	 * slightly leaning die shows the right value — it just looks like a die that wants nudging. That is
	 * a far better failure than a hand that never rolls.
	 */
	const settledForBetter = attempt(solids, random, false)!
	return { ...settledForBetter, rejected: maxAttempts }
}

export const THROW_SCALE = SCALE
export const THROW_STEP = STEP
