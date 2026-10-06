import { sanitizeSvg } from './sanitizeSvg'

const svg = (inner: string, attrs = '') =>
	`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${inner}</svg>`

describe('sanitizeSvg (X1)', () => {
	it('keeps a picture as it was', () => {
		const picture = svg(
			'<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use href="#g"/><text>Hi</text><image href="data:image/png;base64,AAAA"/><animate attributeName="fill" values="red;blue"/>',
			'width="10" height="10"'
		)
		const out = sanitizeSvg(picture)!
		for (const kept of ['linearGradient', 'fill="url(#g)"', 'href="#g"', '<text>Hi</text>', 'data:image/png', 'values="red;blue"', 'width="10"']) {
			expect(out).toContain(kept)
		}
	})

	it('takes out scripts, handlers and HTML', () => {
		const out = sanitizeSvg(
			svg(
				'<script>alert(1)</script><rect onclick="alert(2)" width="1"/><image href="x" onerror="alert(3)"/><foreignObject><iframe src="https://evil.example"/></foreignObject>',
				'onload="alert(4)"'
			)
		)!
		expect(out).not.toMatch(/alert|script|onclick|onerror|onload|foreignObject|iframe/i)
		expect(out).toContain('<rect width="1"')
	})

	it('takes out links that leave the file, and animations that would set one', () => {
		const out = sanitizeSvg(
			svg(
				'<a href="javascript:alert(1)"><rect/></a><a xlink:href="JavaScript:alert(2)"/><image href="https://tracker.example/p.gif"/><use href="https://evil.example/x.svg#a"/><a><set attributeName="href" to="javascript:alert(3)"/></a><image href="data:image/svg+xml;base64,PHN2Zz4="/>'
			)
		)!
		expect(out).not.toMatch(/javascript|tracker|evil|<set|svg\+xml/i)
		expect(out).toContain('<rect')
	})

	it('empties CSS that reaches out', () => {
		const out = sanitizeSvg(
			svg('<style>@import "https://evil.example/a.css"; rect { fill: url(https://evil.example/f) } .k { fill: url(#g) }</style><rect style="background: url(\'https://evil.example/b\')"/>')
		)!
		expect(out).not.toContain('evil')
		expect(out).toContain('url(#g)')
	})

	it('refuses what is not an SVG', () => {
		expect(sanitizeSvg('<html><body/></html>')).toBeNull()
		expect(sanitizeSvg('not xml at all <')).toBeNull()
	})
})
