/**
 * Coherent noise, and the two tricks that make it look like a coastline.
 *
 * Sums of sines can only ever look like sums of sines: however many you add, the result is periodic
 * and the eye finds the period. What actually generates natural outlines — coastlines, mountain
 * ridges, cloud edges — is **fractional Brownian motion**: one band of smooth noise, plus a half-size
 * copy at half the strength, plus a quarter-size copy at a quarter, and so on. Each octave adds
 * detail without changing the shape, which is why the result has features at every scale instead of
 * one favourite wavelength.
 *
 * On top of that, **domain warping** (`fbm(p + fbm(p))`) is what turns fractal roughness into
 * *shapes*. Instead of asking the noise how far out the line should be at this point, it first asks
 * the noise where to look — so the pattern gets stretched here and folded there, producing the
 * inlets, peninsulas and little curls that a plain sum of octaves never does. This is Inigo Quilez's
 * technique and it is the difference between "wobbly" and "interesting".
 *
 * Everything here is deterministic and pure: same coordinates and seed, same value, on every machine.
 * No tables to initialise, so it costs nothing until the lens is switched on.
 */

/** A 32-bit hash of two integers and a seed, well mixed. `Math.imul` keeps it exact. */
function hash(ix: number, iy: number, seed: number): number {
	let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177)
	h = Math.imul(h ^ (h >>> 13), 1274126177)
	return (h ^ (h >>> 16)) >>> 0
}

/** Smoothstep — the interpolation that keeps the noise's first derivative continuous. */
function fade(t: number): number {
	return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
	return a + (b - a) * t
}

/** Peak amplitude of 2-D gradient noise, used to normalise it into [-1, 1]. */
const GRADIENT_PEAK = Math.SQRT1_2

/**
 * Gradient (Perlin-style) noise in two dimensions, in roughly [-1, 1].
 *
 * Gradient rather than value noise because value noise puts its extremes on the lattice points, which
 * shows up as a faint grid — and a grid in an aura reads as a bug. Here each lattice point carries a
 * random *direction* instead, so the zero crossings land on the lattice and the features do not.
 */
export function gradientNoise(x: number, y: number, seed: number): number {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const u = fade(x - x0)
	const v = fade(y - y0)

	const dot = (ix: number, iy: number): number => {
		const angle = (hash(ix, iy, seed) / 4294967296) * Math.PI * 2
		return Math.cos(angle) * (x - ix) + Math.sin(angle) * (y - iy)
	}

	const top = lerp(dot(x0, y0), dot(x0 + 1, y0), u)
	const bottom = lerp(dot(x0, y0 + 1), dot(x0 + 1, y0 + 1), u)
	return lerp(top, bottom, v) / GRADIENT_PEAK
}

/**
 * Fractional Brownian motion: octaves of `gradientNoise` at doubling frequency and shrinking
 * amplitude, normalised back into [-1, 1].
 *
 * `roughness` is how much each octave keeps of the last one's strength. Below about 0.4 the detail
 * fades out and the line goes smooth; above about 0.65 the fine octaves take over and it goes hairy.
 * The classic value is 0.5, and the interesting range is narrow — which is exactly why it wants a
 * slider rather than a guess.
 *
 * Bounded by construction: the octave amplitudes are divided by their own sum, so the result cannot
 * leave [-1, 1] however many octaves are asked for. The aura's reach depends on that.
 */
export function fbm(
	x: number,
	y: number,
	seed: number,
	octaves: number,
	roughness: number
): number {
	let sum = 0
	let norm = 0
	let amplitude = 1
	let fx = x
	let fy = y
	const count = Math.max(1, Math.min(8, Math.round(octaves)))
	for (let octave = 0; octave < count; octave++) {
		// A different seed per octave, or every octave would be the same field at a different zoom and
		// their peaks would pile up in the same places.
		sum += gradientNoise(fx, fy, seed + octave * 1013) * amplitude
		norm += amplitude
		amplitude *= roughness
		fx *= 2
		fy *= 2
	}
	return norm === 0 ? 0 : sum / norm
}

/**
 * Domain-warped fBm — the field the aura's outline is actually read from.
 *
 * Two more fBm samples say where to look before the third says how far out to go. `warp` of zero is
 * plain fBm; around one, the field develops the stretched lobes and pinched inlets that read as
 * deliberate shapes rather than as roughness.
 *
 * The offsets on the warp samples are arbitrary constants, there only to make the two look-up fields
 * independent of each other and of the field being read.
 */
export function warpedFbm(
	x: number,
	y: number,
	seed: number,
	octaves: number,
	roughness: number,
	warp: number
): number {
	if (warp <= 0) return fbm(x, y, seed, octaves, roughness)
	const wx = fbm(x + 5.2, y + 1.3, seed + 7919, octaves, roughness)
	const wy = fbm(x + 9.7, y + 2.8, seed + 6871, octaves, roughness)
	return fbm(x + wx * warp, y + wy * warp, seed, octaves, roughness)
}
