import { TLDrawShapeSegment, VecModel, b64Vecs } from '@lifeboard/canvas-editor'

/**
 * A stroke segment as the 2023 drawing code works with it: a plain list of points.
 *
 * Boards store segments as a delta-encoded base64 `path` (since tldraw 4.3), and a stroke can carry a
 * `scaleX`/`scaleY` applied to all of its points (docs/fork-parity.md D3). The drawing code reads and
 * writes through these two functions, so its geometry keeps working on points.
 */
export interface PointSegment {
	type: 'free' | 'straight'
	points: VecModel[]
}

interface StrokeProps {
	segments: TLDrawShapeSegment[]
	scaleX?: number
	scaleY?: number
}

// Decoding runs on every render and hit test; the stored array only changes on edit.
const decoded = new WeakMap<TLDrawShapeSegment[], { scaleX: number; scaleY: number; segments: PointSegment[] }>()

export function decodeSegments({ segments, scaleX = 1, scaleY = 1 }: StrokeProps): PointSegment[] {
	const cached = decoded.get(segments)
	if (cached && cached.scaleX === scaleX && cached.scaleY === scaleY) return cached.segments
	const result = segments.map((segment) => ({
		type: segment.type,
		// `dim: 2` paths hold x and y only (no pressure); they decode with z at 0.5.
		points: b64Vecs
			.decodePoints(segment.path, segment.dim)
			.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY, z: p.z })),
	}))
	decoded.set(segments, { scaleX, scaleY, segments: result })
	return result
}

/** The inverse of {@link decodeSegments}: points in shape space, stored unscaled. */
export function encodeSegments(
	segments: PointSegment[],
	{ scaleX = 1, scaleY = 1 }: { scaleX?: number; scaleY?: number } = {}
): TLDrawShapeSegment[] {
	return segments.map((segment) => {
		const points = segment.points.map((p) => ({ x: p.x / scaleX, y: p.y / scaleY, z: p.z ?? 0.5 }))
		// Strokes without pressure (every z the default) are stored in two dimensions, as tldraw does.
		const dim = points.every((p) => p.z === 0.5) ? 2 : 3
		return { type: segment.type, path: b64Vecs.encodePoints(points, dim), dim }
	})
}
