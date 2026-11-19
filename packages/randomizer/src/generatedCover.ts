import type { ListKind, RandomItem } from './model'

/**
 * A cover for an item that has no picture: abstract art drawn from its title, with the title, the
 * creator and the year set on it, so a list typed in a hurry still shuffles through covers rather
 * than blank cards. The same title always draws the same cover.
 *
 * Ported from the accepted design's prototype (DARK-6, variant 1B), which drew its sample covers this
 * way. It returns an SVG data URI, which is what lets the split-flap halves use it like any image.
 */

type Palette = readonly [string, string, string, string]

/** Background, two accents, ink: the sample covers' own palettes. */
const PALETTES: readonly Palette[] = [
	['#f2ece0', '#e4572e', '#1d3557', '#1d3557'],
	['#0d1b2a', '#e0e1dd', '#778da9', '#e0e1dd'],
	['#d8f3dc', '#40916c', '#1b4332', '#1b4332'],
	['#111111', '#f4d35e', '#ee964b', '#f4f4f4'],
	['#2b2d42', '#ef233c', '#8d99ae', '#edf2f4'],
	['#14213d', '#fca311', '#000814', '#e5e5e5'],
	['#c9c9c9', '#ff4d6d', '#222222', '#222222'],
	['#f1faee', '#457b9d', '#1d3557', '#1d3557'],
	['#3d2314', '#c4703b', '#e9b384', '#f6e3cf'],
	['#000000', '#7ae582', '#25a18e', '#e8e8e8'],
	['#cdd7f6', '#3a4fb8', '#f28482', '#1a1f4a'],
	['#ffd6a5', '#d62828', '#003049', '#003049'],
	['#1b263b', '#f7b538', '#0b132b', '#f1f1f1'],
	['#10002b', '#ff006e', '#3a86ff', '#ffffff'],
	['#e3eef2', '#5c8da8', '#23395b', '#23395b'],
	['#d4a373', '#7f2b0a', '#3c1a0a', '#2b1406'],
	['#050505', '#e9ecef', '#ff5400', '#e9ecef'],
	['#e9e4da', '#b23a48', '#2d3142', '#2d3142'],
	['#ffcad4', '#3d405b', '#81b29a', '#3d405b'],
	['#0b3c49', '#9ad1d4', '#ccdbdc', '#f2f7f8'],
	['#8ecae6', '#ffb703', '#fb8500', '#023047'],
	['#1a1a2e', '#e94560', '#0f3460', '#f5f5f5'],
	['#e8eef0', '#2a6f97', '#c75146', '#132a3a'],
	['#2f2f2f', '#b08968', '#7f5539', '#ede0d4'],
	['#dfe7fd', '#3d5a80', '#98c1d9', '#1b2a41'],
	['#f8f9fa', '#adb5bd', '#212529', '#212529'],
	['#3c096c', '#e0aaff', '#9d4edd', '#f8f0ff'],
	['#003049', '#f77f00', '#001d2e', '#fdf0d5'],
	['#fefae0', '#bc6c25', '#283618', '#283618'],
	['#606c38', '#dda15e', '#fefae0', '#fefae0'],
	['#0b090a', '#e5e5e5', '#a4161a', '#f5f3f4'],
	['#e63946', '#f1faee', '#1d3557', '#f1faee'],
]

const FONTS = {
	serif: "Georgia, 'Times New Roman', serif",
	sans: "'Helvetica Neue', Helvetica, Arial, sans-serif",
	mono: "'Courier New', Courier, monospace",
	cond: "'Arial Narrow', 'Helvetica Neue', Arial, sans-serif",
} as const
type Face = keyof typeof FONTS
const FACES: readonly Face[] = ['serif', 'sans', 'mono', 'cond']

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** FNV-1a: a stable number from a title. */
export function hashText(s: string): number {
	let h = 2166136261
	for (const ch of s) {
		h ^= ch.codePointAt(0) ?? 0
		h = Math.imul(h, 16777619)
	}
	return h >>> 0
}

/** mulberry32: a seeded stream, so the art's own choices repeat with the title. */
function seeded(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

function wrap(text: string, max: number): string[] {
	const out: string[] = []
	let line = ''
	for (const word of text.split(' ')) {
		if (line && `${line} ${word}`.length > max) {
			out.push(line)
			line = word
		} else line = line ? `${line} ${word}` : word
	}
	if (line) out.push(line)
	return out.slice(0, 3)
}

const n1 = (v: number) => Math.round(v * 10) / 10

type Art = (w: number, h: number, c: Palette, r: () => number, title: string) => string

const ART: Record<string, Art> = {
	sun(w, h, c) {
		const m = Math.min(w, h)
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/><circle cx="${w / 2}" cy="${n1(h * 0.5)}" r="${n1(m * 0.3)}" fill="${c[1]}"/><rect y="${n1(h * 0.62)}" width="${w}" height="${n1(h * 0.38)}" fill="${c[2]}"/>`
		for (let i = 0; i < 6; i++) {
			const ww = w * (0.5 - i * 0.07)
			s += `<rect x="${n1((w - ww) / 2)}" y="${n1(h * 0.66 + i * h * 0.05)}" width="${n1(ww)}" height="${n1(h * 0.018)}" fill="${c[1]}" opacity="${(0.8 - i * 0.12).toFixed(2)}"/>`
		}
		return s
	},
	rings(w, h, c, r) {
		const m = Math.min(w, h)
		const cx = n1(w * (0.35 + r() * 0.3))
		const cy = n1(h * (0.4 + r() * 0.2))
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 10; i >= 1; i--) s += `<circle cx="${cx}" cy="${cy}" r="${n1(i * m * 0.075)}" fill="${[c[1], c[0], c[2]][i % 3]}"/>`
		return s
	},
	wave(w, h, c, r) {
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < 9; i++) {
			const y = n1(h * (0.1 + i * 0.1))
			const a = n1(h * (0.05 + r() * 0.06))
			s += `<path d="M-10 ${y} Q ${n1(w * 0.25)} ${n1(y - a)} ${n1(w * 0.5)} ${y} T ${w + 10} ${y}" fill="none" stroke="${i % 2 ? c[1] : c[2]}" stroke-width="${n1(h * 0.035)}" stroke-linecap="round"/>`
		}
		return s
	},
	stripes(w, h, c, r) {
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		let y = h * 0.08
		let i = 0
		while (y < h) {
			const t = h * (0.025 + r() * 0.07)
			s += `<rect y="${n1(y)}" width="${w}" height="${n1(t)}" fill="${[c[1], c[0], c[2], c[0]][i % 4]}"/>`
			y += t
			i++
		}
		return s + `<rect x="${n1(w * 0.72)}" width="${n1(w * 0.06)}" height="${h}" fill="${c[3]}" opacity=".85"/>`
	},
	grid(w, h, c, r) {
		const n = 4
		const g = w * 0.035
		const cw = (w - g * (n + 1)) / n
		const ch = (h - g * (n + 1)) / n
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < n; i++)
			for (let j = 0; j < n; j++) {
				const x = n1(g + i * (cw + g))
				const y = n1(g + j * (ch + g))
				const v = r()
				if (v > 0.86) s += `<circle cx="${n1(x + cw / 2)}" cy="${n1(y + ch / 2)}" r="${n1(Math.min(cw, ch) / 2)}" fill="${c[1]}"/>`
				else if (v < 0.32) s += `<rect x="${x}" y="${y}" width="${n1(cw)}" height="${n1(ch)}" fill="${c[1]}"/>`
				else if (v < 0.58) s += `<rect x="${x}" y="${y}" width="${n1(cw)}" height="${n1(ch)}" fill="${c[2]}"/>`
				else s += `<rect x="${x}" y="${y}" width="${n1(cw)}" height="${n1(ch)}" fill="none" stroke="${c[2]}" stroke-opacity=".5" stroke-width="1.5"/>`
			}
		return s
	},
	horizon(w, h, c) {
		const m = Math.min(w, h)
		return (
			`<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c[2]}"/><stop offset=".35" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient></defs>` +
			`<rect width="${w}" height="${h}" fill="url(#sky)"/>` +
			`<circle cx="${n1(w * 0.64)}" cy="${n1(h * 0.5)}" r="${n1(m * 0.11)}" fill="${c[3]}" opacity=".92"/>` +
			`<path d="M0 ${n1(h * 0.66)} L${n1(w * 0.2)} ${n1(h * 0.5)} L${n1(w * 0.36)} ${n1(h * 0.6)} L${n1(w * 0.55)} ${n1(h * 0.44)} L${n1(w * 0.78)} ${n1(h * 0.62)} L${w} ${n1(h * 0.52)} L${w} ${h} L0 ${h} Z" fill="${c[2]}" opacity=".6"/>` +
			`<path d="M0 ${n1(h * 0.78)} L${n1(w * 0.3)} ${n1(h * 0.66)} L${n1(w * 0.58)} ${n1(h * 0.76)} L${n1(w * 0.82)} ${n1(h * 0.68)} L${w} ${n1(h * 0.74)} L${w} ${h} L0 ${h} Z" fill="${c[2]}"/>`
		)
	},
	type(w, h, c, _r, title) {
		const letter = (title.replace(/^(The|A) /, '')[0] ?? 'X').toUpperCase()
		const m = Math.min(w, h)
		return (
			`<rect width="${w}" height="${h}" fill="${c[0]}"/><circle cx="${n1(w * 0.74)}" cy="${n1(h * 0.3)}" r="${n1(m * 0.16)}" fill="${c[2]}"/>` +
			`<text x="${n1(-w * 0.04)}" y="${n1(h * 0.96)}" font-family="${FONTS.serif}" font-weight="700" font-size="${n1(h * 1.05)}" fill="${c[1]}">${esc(letter)}</text>`
		)
	},
	dots(w, h, c) {
		const n = 11
		const cell = w / n
		const rows = Math.ceil(h / cell)
		const cx = w * 0.3
		const cy = h * 0.38
		const md = Math.hypot(w, h) * 0.85
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < n; i++)
			for (let j = 0; j < rows; j++) {
				const x = cell * (i + 0.5)
				const y = cell * (j + 0.5)
				const rad = cell * 0.48 * Math.pow(Math.max(0, 1 - Math.hypot(x - cx, y - cy) / md), 1.3)
				if (rad > 0.6) s += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(rad)}" fill="${(i + j) % 7 === 0 ? c[2] : c[1]}"/>`
			}
		return s
	},
	arch(w, h, c) {
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < 5; i++) {
			const x0 = w * 0.08 + i * w * 0.09
			const x1 = w - x0
			const rx = (x1 - x0) / 2
			const top = h * 0.16 + i * h * 0.08 + rx
			s += `<path d="M${n1(x0)} ${h} L${n1(x0)} ${n1(top)} A${n1(rx)} ${n1(rx)} 0 0 1 ${n1(x1)} ${n1(top)} L${n1(x1)} ${h} Z" fill="${[c[1], c[2], c[0], c[1], c[2]][i]}"/>`
		}
		return s
	},
	bars(w, h, c, r) {
		const n = 13
		const bw = w / n
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < n; i++) {
			const bh = h * (0.12 + r() * 0.66)
			s += `<rect x="${n1(i * bw + bw * 0.18)}" y="${n1(h * 0.92 - bh)}" width="${n1(bw * 0.64)}" height="${n1(bh)}" fill="${r() > 0.78 ? c[2] : c[1]}"/>`
		}
		return s + `<rect y="${n1(h * 0.935)}" width="${w}" height="${n1(h * 0.012)}" fill="${c[1]}" opacity=".6"/>`
	},
	split(w, h, c) {
		const m = Math.min(w, h)
		return (
			`<rect width="${w}" height="${h}" fill="${c[0]}"/><rect x="${n1(w / 2)}" width="${n1(w / 2)}" height="${h}" fill="${c[1]}"/>` +
			`<circle cx="${n1(w / 2)}" cy="${n1(h * 0.48)}" r="${n1(m * 0.26)}" fill="${c[2]}"/>` +
			`<circle cx="${n1(w * 0.5 + m * 0.26)}" cy="${n1(h * 0.48 - m * 0.26)}" r="${n1(m * 0.06)}" fill="${c[3]}"/>`
		)
	},
	tri(w, h, c, r) {
		const n = 4
		const cw = w / n
		const ch = h / n
		let s = `<rect width="${w}" height="${h}" fill="${c[0]}"/>`
		for (let i = 0; i < n; i++)
			for (let j = 0; j < n; j++) {
				const v = r()
				if (v > 0.72) continue
				const x = i * cw
				const y = j * ch
				const pts = [
					[x, y],
					[x + cw, y],
					[x + cw, y + ch],
					[x, y + ch],
				]
				pts.splice(Math.floor(r() * 4), 1)
				s += `<polygon points="${pts.map((p) => p.map(n1).join(',')).join(' ')}" fill="${v < 0.36 ? c[1] : c[2]}"/>`
			}
		return s
	},
}
const ART_NAMES = Object.keys(ART)

const nest = (x: number, y: number, w: number, h: number, inner: string) =>
	`<svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${inner}</svg>`

interface Look {
	c: Palette
	art: Art
	face: Face
	r: () => number
	flip: boolean
}

function lookFor(item: Pick<RandomItem, 'title' | 'creator'>): Look {
	const h = hashText(`${item.title}\u0000${item.creator}`)
	return {
		c: PALETTES[h % PALETTES.length]!,
		art: ART[ART_NAMES[(h >>> 8) % ART_NAMES.length]!]!,
		face: FACES[(h >>> 16) % FACES.length]!,
		r: seeded(h),
		flip: ((h >>> 20) & 1) === 1,
	}
}

function squareCover(item: RandomItem, { c, art, face, r, flip }: Look): string {
	const band = 62
	const artY = flip ? 0 : band
	const textY = flip ? 300 - band : 0
	const title = face === 'cond' ? item.title.toUpperCase() : item.title
	return (
		`<rect width="300" height="300" fill="${c[0]}"/>` +
		nest(0, artY, 300, 300 - band, art(300, 300 - band, c, r, item.title)) +
		`<text x="18" y="${textY + 31}" font-family="${FONTS[face]}" font-weight="700" font-size="${title.length > 22 ? 15 : 21}" fill="${c[3]}"${face === 'cond' ? ' letter-spacing="1"' : ''}>${esc(title)}</text>` +
		`<text x="18" y="${textY + 49}" font-family="${FONTS.sans}" font-size="10" letter-spacing="2" fill="${c[3]}" opacity=".8">${esc(item.creator.toUpperCase())}</text>` +
		`<text x="282" y="${textY + 49}" text-anchor="end" font-family="${FONTS.mono}" font-size="9" fill="${c[3]}" opacity=".6">${esc(item.year)}</text>`
	)
}

function posterCover(item: RandomItem, { c, art, face, r }: Look): { W: number; H: number; s: string } {
	const W = 180
	const H = 270
	const band = 88
	const upper = face !== 'serif'
	let s = `<rect width="${W}" height="${H}" fill="${c[0]}"/>` + nest(0, 0, W, H - band, art(W, H - band, c, r, item.title))
	if (item.creator) s += `<text x="14" y="${H - band + 18}" font-family="${FONTS.sans}" font-size="7.5" letter-spacing="2" fill="${c[3]}" opacity=".75">A FILM BY ${esc(item.creator.toUpperCase())}</text>`
	wrap(item.title, 12).forEach((line, k) => {
		s += `<text x="13" y="${H - band + 41 + k * 21}" font-family="${FONTS[face]}" font-weight="700" font-size="19"${upper ? ' letter-spacing=".5"' : ''} fill="${c[3]}">${esc(upper ? line.toUpperCase() : line)}</text>`
	})
	s += `<text x="${W - 14}" y="${H - 11}" text-anchor="end" font-family="${FONTS.mono}" font-size="8" fill="${c[3]}" opacity=".7">${esc(item.year)}</text>`
	return { W, H, s }
}

function bookCover(item: RandomItem, { c, art, face, r }: Look): { W: number; H: number; s: string } {
	const W = 184
	const H = 276
	const top = 92
	const bottom = 32
	const upper = face === 'cond' || face === 'mono'
	let s = `<rect width="${W}" height="${H}" fill="${c[0]}"/>` + nest(0, top, W, H - top - bottom, art(W, H - top - bottom, c, r, item.title))
	wrap(item.title, 12).forEach((line, k) => {
		s += `<text x="22" y="${36 + k * 23}" font-family="${FONTS[face]}" font-weight="700" font-size="20" fill="${c[3]}">${esc(upper ? line.toUpperCase() : line)}</text>`
	})
	s += `<rect x="22" y="${top - 14}" width="28" height="2" fill="${c[3]}" opacity=".6"/>`
	s += `<text x="22" y="${H - 12}" font-family="${FONTS.sans}" font-size="9.5" letter-spacing="1.6" fill="${c[3]}">${esc(item.creator.toUpperCase())}</text>`
	s += `<rect width="7" height="${H}" fill="#000" opacity=".22"/><rect x="7" width="1.5" height="${H}" fill="#fff" opacity=".14"/>`
	return { W, H, s }
}

/** A tall cover on a dark mat, so a poster or a book sits in the square window the way a card would. */
function matted({ W, H, s }: { W: number; H: number; s: string }): string {
	const x = (300 - W) / 2
	const y = (300 - H) / 2
	return (
		`<defs><radialGradient id="mat" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#34343a"/><stop offset="1" stop-color="#222226"/></radialGradient></defs>` +
		`<rect width="300" height="300" fill="url(#mat)"/>` +
		`<rect x="${x + 3}" y="${y + 5}" width="${W}" height="${H}" rx="1" fill="#000" opacity=".4"/>` +
		nest(x, y, W, H, s) +
		`<rect x="${x + 0.5}" y="${y + 0.5}" width="${W - 1}" height="${H - 1}" fill="none" stroke="#fff" stroke-opacity=".1"/>`
	)
}

const cache = new Map<string, string>()

/** The generated cover for an item, as a data URI. Cached by what it draws. */
export function generatedCover(item: RandomItem, shape: ListKind['shape']): string {
	const key = `${shape}\u0000${item.title}\u0000${item.creator}\u0000${item.year}`
	const hit = cache.get(key)
	if (hit) return hit
	const look = lookFor(item)
	const body = shape === 'square' ? squareCover(item, look) : matted(shape === 'poster' ? posterCover(item, look) : bookCover(item, look))
	const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 300" width="600" height="600">${body}</svg>`)}`
	cache.set(key, uri)
	return uri
}
