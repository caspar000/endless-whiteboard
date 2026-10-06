import type { TLDefaultColorStyle } from '@tldraw/tlschema'
import { DefaultColorThemePalette, TLDefaultColorTheme } from './defaultColorTheme'

/** @public */
export type TLColorMode = 'light' | 'dark'

/**
 * A theme: a palette for each colour mode, as today's editor has it.
 *
 * @public
 */
export interface TLTheme {
	id: string
	colors: Record<TLColorMode, TLDefaultColorTheme>
}

/** The default palette as a theme. @public */
export const DEFAULT_THEME: TLTheme = {
	id: 'default',
	colors: { light: DefaultColorThemePalette.lightMode, dark: DefaultColorThemePalette.darkMode },
}

/** @public */
export type TLColorVariant = 'solid' | 'semi' | 'pattern' | 'fill' | 'frameStroke'

/**
 * One colour from a palette, in one variant. `fill` is what the `fill` style paints, the colour at
 * full strength, as tldraw 5 draws it (measured); `frameStroke` is a frame's border, the colour
 * itself. A name the palette doesn't have reads as black.
 *
 * @public
 */
export function getColorValue(
	colors: TLDefaultColorTheme,
	color: TLDefaultColorStyle | string,
	variant: TLColorVariant
): string {
	const entry = colors[color as TLDefaultColorStyle] ?? colors.black
	if (variant === 'fill' || variant === 'frameStroke') return entry.solid
	return entry[variant]
}
