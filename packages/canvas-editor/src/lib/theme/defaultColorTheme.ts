/**
 * The default colour palette, from tldraw 2.0.0-alpha.19's `@tldraw/tlschema` (Apache-2.0, see
 * NOTICE). The palette left the schema package after 2023; the fork keeps its own.
 *
 * Modified: the values are today's, measured from what tldraw 5.5 draws in both modes (its rendering,
 * not its code), so boards look the same as they did before the fork. `white`, which today's schema
 * has and 2023's didn't, gets an entry in both modes; every colour has a `noteFill` and a `linedFill`.
 */
import type { Expand } from '@tldraw/utils'

const colors = [
	'black',
	'grey',
	'light-violet',
	'violet',
	'blue',
	'light-blue',
	'yellow',
	'orange',
	'green',
	'light-green',
	'light-red',
	'red',
	'white',
] as const

/** @public */
export type TLDefaultColorThemeColor = {
	solid: string
	semi: string
	pattern: string
	/**
	 * A sticky note's fill. Matched to what tldraw 5 draws (measured from its rendering, not its
	 * code), so boards keep their stickies' colours across the cutover.
	 */
	noteFill: string
	/** The fill of the `lined-fill` style: a shade off `solid`, so the shape's outline shows around it. */
	linedFill: string
	highlight: {
		srgb: string
		p3: string
	}
}

/** @public */
export type TLDefaultColorTheme = Expand<
	{
		id: 'light' | 'dark'
		text: string
		background: string
		solid: string
	} & Record<(typeof colors)[number], TLDefaultColorThemeColor>
>

/** @public */
export const DefaultColorThemePalette: {
	lightMode: TLDefaultColorTheme
	darkMode: TLDefaultColorTheme
} = {
	lightMode: {
		id: 'light',
		text: '#000000',
		background: 'rgb(249, 250, 251)',
		solid: '#fcfffe',

		black: {
			solid: '#1d1d1d',
			semi: '#e8e8e8',
			pattern: '#494949',
			linedFill: '#363636',
			noteFill: '#fadf9a',
			highlight: {
				srgb: '#fddd00',
				p3: 'color(display-p3 0.972 0.8705 0.05)',
			},
		},
		grey: {
			solid: '#9fa8b2',
			semi: '#eceef0',
			pattern: '#bcc3c9',
			linedFill: '#bbc1c9',
			noteFill: '#bec8d1',
			highlight: {
				srgb: '#cbe7f1',
				p3: 'color(display-p3 0.8163 0.9023 0.9416)',
			},
		},
		'light-violet': {
			solid: '#e085f4',
			semi: '#f5eafa',
			pattern: '#e9acf8',
			linedFill: '#e9abf7',
			noteFill: '#deaff8',
			highlight: {
				srgb: '#ff88ff',
				p3: 'color(display-p3 0.9676 0.5652 0.9999)',
			},
		},
		violet: {
			solid: '#ae3ec9',
			semi: '#ecdcf2',
			pattern: '#bd63d3',
			linedFill: '#be68d4',
			noteFill: '#da90fc',
			highlight: {
				srgb: '#c77cff',
				p3: 'color(display-p3 0.7469 0.5089 0.9995)',
			},
		},
		blue: {
			solid: '#4465e9',
			semi: '#dce1f8',
			pattern: '#6681ee',
			linedFill: '#6580ec',
			noteFill: '#89a2fe',
			highlight: {
				srgb: '#10acff',
				p3: 'color(display-p3 0.308 0.6632 0.9996)',
			},
		},
		'light-blue': {
			solid: '#4ba1f1',
			semi: '#ddedfa',
			pattern: '#6fbbf8',
			linedFill: '#7abaf5',
			noteFill: '#9ac3fc',
			highlight: {
				srgb: '#00f4ff',
				p3: 'color(display-p3 0.1512 0.9414 0.9996)',
			},
		},
		yellow: {
			solid: '#f1ac4b',
			semi: '#f9f0e6',
			pattern: '#fecb92',
			linedFill: '#f5c27a',
			noteFill: '#fdd399',
			highlight: {
				srgb: '#fddd00',
				p3: 'color(display-p3 0.972 0.8705 0.05)',
			},
		},
		orange: {
			solid: '#e16919',
			semi: '#f8e2d4',
			pattern: '#f78438',
			linedFill: '#ea8643',
			noteFill: '#f9a374',
			highlight: {
				srgb: '#ffa500',
				p3: 'color(display-p3 0.9988 0.6905 0.266)',
			},
		},
		green: {
			solid: '#099268',
			semi: '#d3e9e3',
			pattern: '#39a785',
			linedFill: '#0bad7c',
			noteFill: '#6ec694',
			highlight: {
				srgb: '#00ffc8',
				p3: 'color(display-p3 0.2536 0.984 0.7981)',
			},
		},
		'light-green': {
			solid: '#4cb05e',
			semi: '#dbf0e0',
			pattern: '#65cb78',
			linedFill: '#7ec88c',
			noteFill: '#96ce88',
			highlight: {
				srgb: '#65f641',
				p3: 'color(display-p3 0.563 0.9495 0.3857)',
			},
		},
		'light-red': {
			solid: '#f87777',
			semi: '#f4dadb',
			pattern: '#fe9e9e',
			linedFill: '#f99a9a',
			noteFill: '#f6a4a0',
			highlight: {
				srgb: '#ff7fa3',
				p3: 'color(display-p3 0.9988 0.5301 0.6397)',
			},
		},
		red: {
			solid: '#e03131',
			semi: '#f4dadb',
			pattern: '#e55959',
			linedFill: '#e75f5f',
			noteFill: '#fa8080',
			highlight: {
				srgb: '#ff636e',
				p3: 'color(display-p3 0.9992 0.4376 0.45)',
			},
		},
		white: {
			solid: '#ffffff',
			semi: '#f5f5f5',
			pattern: '#f9f9f9',
			linedFill: '#ffffff',
			noteFill: '#fefefe',
			highlight: {
				srgb: '#ffffff',
				p3: 'color(display-p3 1 1 1)',
			},
		},
	},
	darkMode: {
		id: 'dark',
		text: '#f9fafb',
		background: '#101011',
		solid: '#010403',

		black: {
			solid: '#f2f2f2',
			semi: '#2c3036',
			pattern: '#989898',
			linedFill: '#ffffff',
			noteFill: '#2b2b2b',
			highlight: {
				srgb: '#d2b700',
				p3: 'color(display-p3 0.8078 0.7225 0.0312)',
			},
		},
		grey: {
			solid: '#9398b0',
			semi: '#33373c',
			pattern: '#7c8187',
			linedFill: '#8388a5',
			noteFill: '#55585e',
			highlight: {
				srgb: '#9cb4cb',
				p3: 'color(display-p3 0.6299 0.7012 0.7856)',
			},
		},
		'light-violet': {
			solid: '#e599f7',
			semi: '#383442',
			pattern: '#9770a9',
			linedFill: '#dc71f4',
			noteFill: '#752e8d',
			highlight: {
				srgb: '#c400c7',
				p3: 'color(display-p3 0.7024 0.0403 0.753)',
			},
		},
		violet: {
			solid: '#ae3ec9',
			semi: '#342938',
			pattern: '#763a8b',
			linedFill: '#8f2fa7',
			noteFill: '#5e1b6f',
			highlight: {
				srgb: '#9e00ee',
				p3: 'color(display-p3 0.5651 0.0079 0.8986)',
			},
		},
		blue: {
			solid: '#4f72fc',
			semi: '#262d40',
			pattern: '#3a4b9e',
			linedFill: '#3c5cdd',
			noteFill: '#293e97',
			highlight: {
				srgb: '#0079d2',
				p3: 'color(display-p3 0.0032 0.4655 0.7991)',
			},
		},
		'light-blue': {
			solid: '#4dabf7',
			semi: '#2a3642',
			pattern: '#4d7aa9',
			linedFill: '#2793ec',
			noteFill: '#1e5394',
			highlight: {
				srgb: '#00bdc8',
				p3: 'color(display-p3 0.0023 0.7259 0.7735)',
			},
		},
		yellow: {
			solid: '#ffc034',
			semi: '#3b352b',
			pattern: '#fecb92',
			linedFill: '#ffae00',
			noteFill: '#895d1b',
			highlight: {
				srgb: '#d2b700',
				p3: 'color(display-p3 0.8078 0.7225 0.0312)',
			},
		},
		orange: {
			solid: '#f76707',
			semi: '#3b2e27',
			pattern: '#9f552d',
			linedFill: '#f54900',
			noteFill: '#7b3804',
			highlight: {
				srgb: '#d07a00',
				p3: 'color(display-p3 0.7699 0.4937 0.0085)',
			},
		},
		green: {
			solid: '#099268',
			semi: '#253231',
			pattern: '#366a53',
			linedFill: '#087856',
			noteFill: '#004328',
			highlight: {
				srgb: '#009774',
				p3: 'color(display-p3 0.0085 0.582 0.4604)',
			},
		},
		'light-green': {
			solid: '#40c057',
			semi: '#2a3830',
			pattern: '#4e874e',
			linedFill: '#37a44b',
			noteFill: '#20571c',
			highlight: {
				srgb: '#00a000',
				p3: 'color(display-p3 0.2711 0.6172 0.0195)',
			},
		},
		'light-red': {
			solid: '#ff8787',
			semi: '#3c2b2b',
			pattern: '#a56767',
			linedFill: '#ff6666',
			noteFill: '#793232',
			highlight: {
				srgb: '#db005b',
				p3: 'color(display-p3 0.7849 0.0585 0.3589)',
			},
		},
		red: {
			solid: '#e03131',
			semi: '#382726',
			pattern: '#8f3734',
			linedFill: '#c31d1d',
			noteFill: '#7d1f1e',
			highlight: {
				srgb: '#de002c',
				p3: 'color(display-p3 0.7978 0.0509 0.2035)',
			},
		},
		white: {
			solid: '#f3f3f3',
			semi: '#f5f5f5',
			pattern: '#f9f9f9',
			linedFill: '#f3f3f3',
			noteFill: '#e9e9e9',
			highlight: {
				srgb: '#ffffff',
				p3: 'color(display-p3 1 1 1)',
			},
		},
	},
}

/** @public */
export function getDefaultColorTheme(opts: { isDarkMode: boolean }): TLDefaultColorTheme {
	return opts.isDarkMode ? DefaultColorThemePalette.darkMode : DefaultColorThemePalette.lightMode
}
