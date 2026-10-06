import { TLArrowShapeArrowheadStyle } from '@tldraw/tlschema'
import { VecLike } from '../../../../primitives/Vec2d'

/** @public */
export type TLArrowPoint = {
	handle: VecLike
	point: VecLike
	arrowhead: TLArrowShapeArrowheadStyle
}

/** @public */
export interface TLArcInfo {
	center: VecLike
	radius: number
	size: number
	length: number
	largeArcFlag: number
	sweepFlag: number
}

/** @public */
export type TLArrowInfo =
	| {
			isStraight: false
			start: TLArrowPoint
			end: TLArrowPoint
			middle: VecLike
			handleArc: TLArcInfo
			bodyArc: TLArcInfo
			isValid: boolean
	  }
	| {
			isStraight: true
			start: TLArrowPoint
			end: TLArrowPoint
			middle: VecLike
			isValid: boolean
			length: number
			/** An elbow arrow's corners, from start to end (`kind: 'elbow'`). */
			route?: VecLike[]
			/** The run of an elbow's route that `elbowMidPoint` moves, if it has one. */
			elbow?: { axis: 'x' | 'y'; from: number; to: number }
	  }
