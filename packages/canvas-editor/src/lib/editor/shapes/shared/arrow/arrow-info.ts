import { TLArrowShape } from '@tldraw/tlschema'
import { Editor } from '../../../Editor'
import { TLArrowInfo } from './arrow-types'
import { getCurvedArrowInfo } from './curved-arrow'
import { getElbowArrowInfo } from './elbow-arrow'
import { getArrowWaypoints, getRoutedArrowInfo } from './routed-arrow'
import { getIsArrowStraight } from './shared'
import { getStraightArrowInfo } from './straight-arrow'

/** An arrow's drawing: an elbow's route, a route through its waypoints, or a straight or curved line by its bend. */
export function computeArrowInfo(editor: Editor, shape: TLArrowShape): TLArrowInfo {
	if (shape.props.kind === 'elbow') return getElbowArrowInfo(editor, shape)
	const waypoints = getArrowWaypoints(shape)
	if (waypoints.length) return getRoutedArrowInfo(editor, shape, waypoints)
	return getIsArrowStraight(shape) ? getStraightArrowInfo(editor, shape) : getCurvedArrowInfo(editor, shape)
}
