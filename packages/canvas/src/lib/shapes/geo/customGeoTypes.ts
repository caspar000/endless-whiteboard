import { GeoShapeGeoStyle, type TLGeoShape, type VecLike } from '@lifeboard/canvas-editor'

/**
 * Geo shapes of new kinds (docs/fork-parity.md B6), beside the rectangle, ellipse and the rest. A kind
 * is its outline: everything else a geo shape does (label, fill, dash, colour, resizing, flipping,
 * export, links) comes with it.
 *
 * Registering a kind adds it to the `geo` style, which the board's schema validates, so it must be
 * registered wherever boards are read: the app and the server alike. An extension's `geoTypes` are
 * (node-kit's `registerExtension`), which is the way to add one.
 *
 * @public
 */
export interface GeoTypeDefinition {
	/** The outline within the shape's `w` × `h` box, in order round it. */
	getVertices(w: number, h: number, shape: TLGeoShape): VecLike[]
	/**
	 * `polygon`: snaps to its corners as well as its centre. `blobby`: a rounded outline of many
	 * points, which snaps only to its centre and is drawn smooth rather than hand-drawn.
	 */
	snapType?: 'polygon' | 'blobby'
	/** The size a click makes; 200 × 200 otherwise. */
	defaultSize?: { w: number; h: number }
	/** For a picker: an SVG path in a 24 × 24 box. */
	icon?: string
	/** For a picker: what to call it. */
	label?: string
}

const definitions = new Map<string, GeoTypeDefinition>()

/** Adds a geo kind. Registering a name again replaces its definition. @public */
export function registerGeoType(name: string, definition: GeoTypeDefinition): void {
	definitions.set(name, definition)
	GeoShapeGeoStyle.addValues(name as TLGeoShape['props']['geo'])
}

/** A registered kind's definition, or `undefined` for the built-in kinds. @public */
export function getGeoType(name: string): GeoTypeDefinition | undefined {
	return definitions.get(name)
}

/** Every registered kind, in the order they were registered. @public */
export function getGeoTypes(): Array<[string, GeoTypeDefinition]> {
	return [...definitions]
}
