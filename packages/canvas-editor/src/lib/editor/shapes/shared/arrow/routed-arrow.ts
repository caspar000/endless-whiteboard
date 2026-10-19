import { TLArrowShape } from '@tldraw/tlschema'
import { Vec2d, VecLike } from '../../../../primitives/Vec2d'
import { Editor } from '../../../Editor'
import { TLArrowInfo } from './arrow-types'
import { pointAlongRoute } from './elbow-arrow'
import {
	BOUND_ARROW_OFFSET,
	STROKE_SIZES,
	getArrowTerminalsInArrowSpace,
	getBoundShapeInfoForTerminal,
	getBoundShapeRelationships,
} from './shared'
import { updateArrowheadPointWithBoundShape } from './straight-arrow'
import { getArrowTerminal } from './terminals'

/**
 * Where an arrow's waypoints are kept: `shape.meta[WAYPOINTS_META]`, points in the arrow's own space
 * (so they move with it). An arrow with waypoints runs from its start through each of them to its
 * end, its turns rounded, whatever its bend. Kept in `meta` because the arrow's props are tldraw's
 * schema: no new prop, nothing to migrate.
 */
export const WAYPOINTS_META = 'lifeboard:waypoints'

/** An arrow's waypoints, if it has any (anything not a list of points is none). */
export function getArrowWaypoints(shape: TLArrowShape): VecLike[] {
	const raw = (shape.meta as Record<string, unknown> | undefined)?.[WAYPOINTS_META]
	if (!Array.isArray(raw)) return []
	const points: VecLike[] = []
	for (const p of raw) {
		if (!p || typeof p !== 'object') return []
		const { x, y } = p as { x?: unknown; y?: unknown }
		if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return []
		points.push({ x, y })
	}
	return points
}

/**
 * A routed arrow's info: from its start through `waypoints` to its end. Each bound end meets its
 * shape where the line from the nearest waypoint does, as a straight arrow's would, and steps back
 * from an arrowhead as a straight arrow's does.
 */
export function getRoutedArrowInfo(editor: Editor, shape: TLArrowShape, waypoints: VecLike[]): TLArrowInfo {
	const handles = getArrowTerminalsInArrowSpace(editor, shape)
	const arrowPageTransform = editor.getShapePageTransform(shape)!
	const startInfo = getBoundShapeInfoForTerminal(editor, getArrowTerminal(editor, shape, 'start'))
	const endInfo = getBoundShapeInfoForTerminal(editor, getArrowTerminal(editor, shape, 'end'))
	const relationship =
		startInfo && endInfo ? getBoundShapeRelationships(editor, startInfo.shape.id, endInfo.shape.id) : 'safe'

	const first = Vec2d.From(waypoints[0]!)
	const last = Vec2d.From(waypoints[waypoints.length - 1]!)
	const a = handles.start.clone()
	const b = handles.end.clone()
	if (relationship === 'safe') {
		updateArrowheadPointWithBoundShape(a, first, arrowPageTransform, startInfo)
		updateArrowheadPointWithBoundShape(b, last, arrowPageTransform, endInfo)
	}
	// Back from a bound end's shape by the gap a straight arrow leaves for its arrowhead.
	const gap = (info: typeof startInfo, arrowhead: string) =>
		!info || info.isExact || arrowhead === 'none'
			? 0
			: BOUND_ARROW_OFFSET +
			  STROKE_SIZES[shape.props.size] / 2 +
			  ('size' in info.shape.props ? STROKE_SIZES[info.shape.props.size as keyof typeof STROKE_SIZES] / 2 : 0)
	const gapA = gap(startInfo, shape.props.arrowheadStart)
	const gapB = gap(endInfo, shape.props.arrowheadEnd)
	if (gapA && Vec2d.Dist(a, first) > gapA) a.setTo(Vec2d.Nudge(a, first, gapA))
	if (gapB && Vec2d.Dist(b, last) > gapB) b.setTo(Vec2d.Nudge(b, last, gapB))

	const points = [a, ...waypoints.map((p) => Vec2d.From(p)), b]
	let length = 0
	for (let i = 1; i < points.length; i++) length += Vec2d.Dist(points[i - 1]!, points[i]!)
	return {
		isStraight: true,
		start: { handle: handles.start, point: a, arrowhead: shape.props.arrowheadStart },
		end: { handle: handles.end, point: b, arrowhead: shape.props.arrowheadEnd },
		middle: pointAlongRoute(points, length / 2),
		isValid: length > 0,
		length,
		route: points,
		smooth: true,
	}
}
