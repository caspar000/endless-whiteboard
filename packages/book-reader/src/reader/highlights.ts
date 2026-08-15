import {
	findProperty,
	optionHue,
	propertyIdFromName,
	readPropertyRegistry,
	readShapeProperties,
} from '@lifeboard/node-kit'
import type { Editor, TLShapeId } from 'tldraw'
import { QUOTE_NODE_TYPE, type QuoteNodeProps } from '../quote/definition'
import type { Highlight } from './types'

/**
 * The quotes taken from one book, as marks for the reader to draw.
 *
 * A free function rather than a closure inside the overlay, deliberately. It runs inside a tldraw
 * `useValue`, which derives outside React's render pass — a closure there can reach a component
 * local declared *below* it and blow up with a temporal-dead-zone error the first time the branch
 * that touches it is taken. Everything it needs arrives as an argument, so that cannot happen: the
 * only way to add a dependency is to add a parameter.
 *
 * The tag's hue is resolved here rather than in the readers: the property registry is a board-level
 * concern, and the readers should know only "what colour". `tagHues` is the configured palette,
 * keyed by label; `optionHue` falls back to a hash of the label for a tag missing from it.
 */
export function collectHighlights(
	editor: Editor,
	bookId: TLShapeId,
	tagHues: Record<string, number>
): Highlight[] {
	const tagId = findProperty(readPropertyRegistry(editor), propertyIdFromName('Highlight'))?.id
	const found: Highlight[] = []
	for (const shape of editor.getCurrentPageShapes()) {
		if (shape.type !== QUOTE_NODE_TYPE) continue
		const props = shape.props as QuoteNodeProps
		if (props.sourceId !== bookId || !props.location) continue
		const tag = tagId ? readShapeProperties(shape)[tagId] : null
		found.push({
			quoteId: shape.id,
			location: props.location,
			rects: props.rects,
			hue: typeof tag === 'string' && tag ? optionHue(tag, tagHues) : null,
		})
	}
	return found
}
