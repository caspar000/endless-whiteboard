/**
 * The one conversion between tldraw's page coordinates and the world the dice roll in.
 *
 * It exists because getting this wrong twice cost two bugs that looked like different problems.
 *
 * tldraw's page y grows **downward**; a renderer's y grows up. The tempting move is to negate y when
 * placing each die — and negating a single axis is a **reflection**, not a rotation. It flips the
 * handedness of the whole scene, so the dice render as though seen from underneath the paper: a die that
 * has landed on 3 shows you its 3 through the board, from below. Compensating for that by transforming
 * each die's *rotation* as well only produces a mirrored world with correctly-mirrored dice in it.
 *
 * So there is no mirroring anywhere. There is one right-handed world:
 *
 *  - **x** is page x.
 *  - **y** is page y *negated* — but only ever when converting a page coordinate, here.
 *  - **z** is height above the paper, toward the viewer. Gravity is −z, the floor is z = 0.
 *
 * The simulation runs in that world directly, so a die's recorded orientation is used **untouched**.
 * A throw is symmetric about its origin, so nothing is lost by the sim not knowing which way page y
 * pointed.
 */

export interface Point {
	x: number
	y: number
}

/** Page y and world y are each other's negation. Stated once, so no caller has to remember it. */
export function flipY(y: number): number {
	return -y
}

/** Where a die sits in the world, given the page point it was thrown at and its offset from it. */
export function toWorld(origin: Point, offset: readonly [number, number, number]): [number, number, number] {
	return [origin.x + offset[0], flipY(origin.y) + offset[1], offset[2]]
}

/**
 * Where a die is on the *page* — for anything that has to line up with the board rather than the scene,
 * which so far means placing the readout above the settled pile.
 */
export function toPage(origin: Point, offset: readonly [number, number, number]): Point {
	const world = toWorld(origin, offset)
	return { x: world[0], y: flipY(world[1]) }
}
