import { nodeShapeUtils } from '@lifeboard/schema'
import {
	defaultShapeUtils,
	FrameShapeUtil,
	type TLAnyShapeUtilConstructor,
} from 'tldraw'
import { expressionShapeUtils } from './expressionShapeUtils'

/**
 * The frame, made a container rather than a card: no fill, a colourable border.
 *
 * A frame's default body is opaque, which on a whiteboard is the wrong way round — you group things
 * with a frame to say "these belong together", not to hide the paper under them. `getCustomDisplayValues`
 * is tldraw's own merge hook over `getDefaultDisplayValues`, so this replaces the fill and nothing else.
 *
 * `showColors: true` is what makes the border colourable at all: it is the flag that registers the
 * frame's existing `color` prop as a real `DefaultColorStyle` style prop, so `setStyleForSelectedShapes`
 * reaches it and the border, heading and label all derive from it. The prop is already in the schema
 * either way (`getDefaultProps` has always returned `color: 'black'`), so turning this on needs no
 * migration — nothing about what is stored changes.
 *
 * Replacing a built-in works because `<Tldraw>` merges by shape type
 * (`mergeArraysAndReplaceDefaults('type', …)`), so a `frame` util here takes the default's place.
 */
const frameShapeUtil = FrameShapeUtil.configure({
	showColors: true,
	getCustomDisplayValues: () => ({
		// Both, because the fill is read from whichever of the two `showColors` selects.
		fillColor: 'transparent',
		showColorsFillColor: 'transparent',
	}),
})

/**
 * Built per *schema version*, not per render: rebuilding shape utils on every render would recreate
 * every shape's class identity and defeat tldraw's caching. Shape utils and node tools come from the
 * same registry, so a node type can never end up with one but not the other.
 *
 * Keyed on `getNodeTypesVersion()` rather than computed once at module scope, because a type that
 * appears *after* this module is evaluated would otherwise never get a util — the editor would then
 * throw "No shape util found for type …" the moment anything created one, taking the board down.
 * That happens whenever vite HMR re-evaluates an extension, and it is exactly what a runtime-loaded
 * plugin will do on purpose. In a production build the version never changes after startup, so this
 * is computed once there too.
 */
export function buildBoardShapeUtils(): TLAnyShapeUtilConstructor[] {
	return [
		...nodeShapeUtils(),
		frameShapeUtil,
		// Stickies, text, shape labels and arrow labels evaluate `{…}` too — see expressionShapeUtils.
		...expressionShapeUtils,
	]
}

/**
 * The full set a board's store is built from, as `<Tldraw>` assembles it: tldraw's defaults with ours
 * replacing them by type. `useSyncedStore` builds its store before `<Tldraw>` sees any utils, so a synced
 * board has to be handed this list rather than ours alone.
 */
export function buildStoreShapeUtils(utils: TLAnyShapeUtilConstructor[]): TLAnyShapeUtilConstructor[] {
	const ours = new Set(utils.map((util) => util.type))
	return [...defaultShapeUtils.filter((util) => !ours.has(util.type)), ...utils]
}
