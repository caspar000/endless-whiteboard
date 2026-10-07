import { Box2d } from '../../primitives/Box2d'

/** @public */
export type RequiredKeys<T, K extends keyof T> = Partial<Omit<T, K>> & Pick<T, K>
/** @public */
export type OptionalKeys<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

/** @public */
export type TLSvgOptions = {
	bounds: Box2d
	scale: number
	background: boolean
	/** Room around the shapes, in page units; `auto` trims to what's drawn, strokes and all. */
	padding: number | 'auto'
	darkMode?: boolean
	preserveAspectRatio: React.SVGAttributes<SVGSVGElement>['preserveAspectRatio']
}
