import type { Editor, TLShape } from '@lifeboard/canvas'
import { readText } from './properties'

/**
 * The syllabus's shapes on a board. Items and tracks are vault data (syllabus.ts); these shapes are
 * views of them: a card shows one item, a list shows one track.
 */

export const ITEM_TYPE = 'node.skillItem'
export const TRACK_TYPE = 'node.track'
export const NOTE_TYPE = 'node.markdown'

/** A card: one vault item, its works as a checklist inside. */
export interface SkillItemProps {
	itemId: string
	autoHeight: boolean
}

/** A list: one vault track as an outline, in reading order. */
export interface TrackProps {
	trackId: string
	/** Item ids unfolded on this card, newline-separated: how it is folded is this board's business. */
	open: string
}

export type ItemShape = TLShape & { type: typeof ITEM_TYPE; props: SkillItemProps }
export type TrackShape = TLShape & { type: typeof TRACK_TYPE; props: TrackProps }

export function isItem(shape: TLShape | undefined | null): shape is ItemShape {
	return shape?.type === ITEM_TYPE
}

export function isTrack(shape: TLShape | undefined | null): shape is TrackShape {
	return shape?.type === TRACK_TYPE
}

/** The note filed as this item's write-up, if there is one on this board. */
export function evidenceNoteFor(editor: Editor, itemId: string): TLShape | undefined {
	if (!itemId) return undefined
	return editor
		.getCurrentPageShapes()
		// `node.markdown` is the notes package's type; this package doesn't import its shape types.
		.find((shape) => (shape.type as string) === NOTE_TYPE && readText(shape, 'evidenceOf') === itemId)
}

export const UP_NEXT_TYPE = 'node.upNext'

export interface UpNextProps {
	/** The track this card shows; '' follows the first active one. */
	trackId: string
	autoHeight: boolean
}
