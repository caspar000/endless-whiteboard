import type { TLShape } from './shape-types'
import { SerializedSchema } from '@tldraw/store'
import {
	TLAsset,
	TLShapeId,
} from '@tldraw/tlschema'

/** @public */
export interface TLContent {
	shapes: TLShape[]
	rootShapeIds: TLShapeId[]
	assets: TLAsset[]
	schema: SerializedSchema
}
