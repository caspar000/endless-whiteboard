import { atom } from 'tldraw'

/**
 * The aura's look, as numbers — and as something you can drag.
 *
 * Every question about how the tracing aura *reads* is answered here: tighter or looser, a slow
 * coastline or a fine scribble, crisp or soft. The geometry in `auraGeometry.ts` is fixed; this is the
 * part that is taste, so it is one object rather than constants scattered through it.
 *
 * Held in a signal because of Settings → Canvas → Advanced (`settings/AuraAdvanced.tsx`), which puts a
 * slider on each of these. A look like this cannot be settled without dragging something and looking,
 * so the panel stays — behind a closed disclosure, because these are not decisions anyone needs to
 * make. The values are kept in `localStorage`, so a change survives a reload.
 */
export interface AuraPreset {
	/** How far the outline sits from the shape, on average. */
	offset: number
	/** How far it strays from that. The whole amplitude of the noise. */
	wobble: number
	/**
	 * Roughly how far apart the *largest* features are, along the outline. Smaller means a busier,
	 * scribblier line; larger means a few long slow lobes.
	 */
	feature: number
	/** Bands of detail. Each adds half-scale roughness on top of the last (see `fbm`). */
	octaves: number
	/** How much of each octave survives into the next. 0.5 is the natural-looking classic. */
	roughness: number
	/** Domain warping: 0 is plain fractal noise, ~1 gives stretched lobes and pinched inlets. */
	warp: number
	/**
	 * How eagerly two nearby shapes fuse into one outline, as the width of the blend between their
	 * distance fields (see `smin` in `auraField.ts`).
	 *
	 * At 0 the union is hard: outlines meet at a crease, or cross. Turned up, shapes that are close
	 * share one outline with a pinched waist, and the further up it goes the further apart they can be
	 * and still join.
	 */
	merge: number
	/** How fast the pattern evolves, in noise units per second. */
	drift: number
	/** Points drawn per feature. Detail costs frames, so this is the performance dial. */
	samplesPerFeature: number
	/** Stroke width of the outline, in page units. */
	stroke: number
	/** Blur under the stroke. 0 is the crisp, drawn look; higher turns it back into a glow. */
	softness: number
	/**
	 * How far a traced relation's line pushes the outline out, on top of the offset.
	 *
	 * A relation goes into the field as a thick line segment (`FieldCapsule`), so the outline stands off
	 * the arrow by this plus `offset` — where the first version drew a line along the arrow's own
	 * centreline and lost it underneath. It is also what joins the shapes at either end into one
	 * envelope: turn it right down and the ribbon between them narrows to a thread.
	 */
	ribbon: number
	/**
	 * Percent opacity of the wash inside the outline.
	 *
	 * The aura layer is drawn *behind* the shapes, so this tints the ring between the outline and the
	 * shape rather than the shape itself — the fill under an opaque card is simply never seen. A
	 * transparent shape (an unfilled rectangle, a frame) does let it through, which reads correctly:
	 * the whole area is inside the aura.
	 */
	fill: number
}

/** Settled by eye with the tuning panel; see `AuraAdvanced.tsx`. */
export const DEFAULT_AURA: AuraPreset = {
	offset: 19,
	wobble: 10,
	feature: 20,
	octaves: 1,
	roughness: 0.71,
	warp: 1.55,
	merge: 40,
	drift: 0.3,
	samplesPerFeature: 30,
	stroke: 4,
	softness: 0,
	ribbon: 6,
	fill: 10,
}

/** Slider bounds for the tuner — and the honest range each number is useful over. */
export const AURA_RANGES: Record<keyof AuraPreset, { min: number; max: number; step: number }> = {
	offset: { min: 0, max: 60, step: 1 },
	wobble: { min: 0, max: 40, step: 1 },
	feature: { min: 20, max: 400, step: 5 },
	octaves: { min: 1, max: 7, step: 1 },
	roughness: { min: 0.2, max: 0.8, step: 0.01 },
	warp: { min: 0, max: 3, step: 0.05 },
	merge: { min: 0, max: 120, step: 2 },
	drift: { min: 0, max: 2, step: 0.05 },
	samplesPerFeature: { min: 6, max: 60, step: 2 },
	stroke: { min: 0.5, max: 6, step: 0.25 },
	softness: { min: 0, max: 20, step: 0.5 },
	ribbon: { min: 0, max: 40, step: 1 },
	fill: { min: 0, max: 40, step: 1 },
}

const STORAGE_KEY = 'lifeboard:auraPreset'

function load(): AuraPreset {
	try {
		const raw = localStorage.getItem(STORAGE_KEY)
		if (!raw) return DEFAULT_AURA
		const parsed = JSON.parse(raw) as Partial<AuraPreset>
		// Merged over the defaults key by key, so a stored preset written before a field existed — or
		// with a junk value in one — still opens, minus that one value.
		const next = { ...DEFAULT_AURA }
		for (const key of Object.keys(DEFAULT_AURA) as (keyof AuraPreset)[]) {
			const value = parsed[key]
			if (typeof value === 'number' && Number.isFinite(value)) next[key] = value
		}
		return next
	} catch {
		return DEFAULT_AURA
	}
}

const preset = atom<AuraPreset>('lifeboard:auraPreset', load())

export function getAuraPreset(): AuraPreset {
	return preset.get()
}

export function setAuraPreset(changes: Partial<AuraPreset>): void {
	const next = { ...preset.get(), ...changes }
	preset.set(next)
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
	} catch {
		// Private-mode Safari can throw on write; losing the tuning across reloads is survivable.
	}
}

export function resetAuraPreset(): void {
	preset.set(DEFAULT_AURA)
	try {
		localStorage.removeItem(STORAGE_KEY)
	} catch {
		// As above.
	}
}

/** The furthest the outline can get from the shape — what the aura layer pads its box by. */
export function auraReach(p: AuraPreset): number {
	return p.offset + p.wobble
}
