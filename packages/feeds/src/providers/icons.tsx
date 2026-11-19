import type { NodeToolbarIcon } from '@lifeboard/node-kit'

/**
 * The platforms' marks, drawn as outlines in the same weight as the app's other icons (Tabler's
 * brand set, MIT). Lucide has no brand icons.
 */
function outline(d: string): NodeToolbarIcon {
	return function BrandIcon({ size = 16, ...rest }) {
		return (
			<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...rest}>
				<path d={d} />
			</svg>
		)
	}
}

export const YouTubeIcon = outline('M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8z M10 9l5 3l-5 3z')
export const RedditIcon = outline(
	'M12 8c2.6 0 4.9 .7 6.3 1.9a1.9 1.9 0 1 1 2.2 2.8c.1 .3 .1 .6 .1 .9c0 3 -3.8 5.4 -8.6 5.4s-8.6 -2.4 -8.6 -5.4c0 -.3 0 -.6 .1 -.9a1.9 1.9 0 1 1 2.2 -2.8c1.4 -1.2 3.7 -1.9 6.3 -1.9z M12 8l1 -5l6 1 M19 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0 M9 13v.01 M15 13v.01 M10 16c1.2 .6 2.8 .6 4 0'
)
export const XIcon = outline('M4 4l11.733 16h4.267l-11.733 -16z M4 20l6.768 -6.768 M13.228 10.772l6.772 -6.772')
