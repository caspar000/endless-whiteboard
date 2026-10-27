import type { TLClipboardHooks, TLShape } from '@lifeboard/canvas'
import { CARD_TYPE, isBox } from '../box'
import { REF_TYPE } from './definition'
import { boardIdOf } from './live'

/** Where a copied card came from, written on it as it is copied out of a box. */
const FROM = 'lifeboard:zettelFrom'

interface From {
	boxId: string
	cardId: string
}

function fromOf(shape: TLShape): From | null {
	const from = (shape.meta as Record<string, unknown>)[FROM] as Partial<From> | undefined
	return from?.boxId && from.cardId ? { boxId: from.boxId, cardId: from.cardId } : null
}

/**
 * Copying a box's card and pasting it on another board shows the note there (ref/definition.tsx)
 * rather than making a loose copy of it: a note has one place, its box. As a card is copied out of a
 * box it is marked with where it came from; pasted onto a board that isn't a box, a marked card
 * becomes a reference to it. Pasted back into a box it is a duplicate, which the box takes off as it
 * takes off every copy (watch.ts).
 */
export const boxClipboard: TLClipboardHooks = {
	onBeforeCopyToClipboard({ editor }, content) {
		if (!isBox(editor)) return
		const boxId = boardIdOf(editor)
		if (!boxId) return
		return {
			...content,
			shapes: content.shapes.map((shape) =>
				(shape.type as string) === CARD_TYPE ? { ...shape, meta: { ...shape.meta, [FROM]: { boxId, cardId: shape.id } } } : shape
			),
		}
	},
	onBeforePasteFromClipboard({ editor }, content) {
		if (isBox(editor) || !content.shapes.some((shape) => (shape.type as string) === CARD_TYPE && fromOf(shape))) return
		return {
			...content,
			shapes: content.shapes.map((shape) => {
				const from = (shape.type as string) === CARD_TYPE ? fromOf(shape) : null
				if (!from) return shape
				const { [FROM]: _from, ...meta } = shape.meta as Record<string, unknown>
				const props = shape.props as { zid: string; richText: unknown; w: number; h: number }
				return {
					...shape,
					type: REF_TYPE,
					meta,
					props: { boxId: from.boxId, cardId: from.cardId, zid: props.zid, richText: props.richText, pending: false, w: props.w, h: props.h },
				} as unknown as TLShape
			}),
		}
	},
}
