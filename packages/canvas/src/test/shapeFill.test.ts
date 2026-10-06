import { DefaultColorThemePalette } from '@lifeboard/canvas-editor'
import { describe, expect, it } from 'vitest'
import { getShapeFillSvg } from '../lib/shapes/shared/ShapeFill'

const theme = DefaultColorThemePalette.lightMode
const d = 'M0,0L10,0L10,10Z'
const fillsOf = (el: SVGElement | undefined) =>
	el ? [el, ...el.querySelectorAll('path')].map((p) => p.getAttribute('fill')).filter(Boolean) : []

describe('fills in export (D11)', () => {
	it('draws lined-fill flat, a shade off the colour, so the outline shows around it', () => {
		expect(fillsOf(getShapeFillSvg({ d, fill: 'lined-fill', color: 'blue', theme }))).toEqual([
			theme.blue.linedFill,
		])
		expect(theme.blue.linedFill).not.toBe(theme.blue.solid)
	})

	it('paints a shape’s own fill colour in every style, under the hatching for pattern', () => {
		const override = { fillColor: '#123456' }
		for (const fill of ['solid', 'semi', 'fill', 'lined-fill'] as const) {
			expect(fillsOf(getShapeFillSvg({ d, fill, color: 'red', theme, override }))).toEqual(['#123456'])
		}
		expect(fillsOf(getShapeFillSvg({ d, fill: 'pattern', color: 'red', theme, override }))[0]).toBe('#123456')
	})
})
