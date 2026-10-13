/**
 * A board's colour in the sidebar and the tab strip: a soft two-hue gradient picked from its id, so
 * a board keeps its colour across renames and devices without storing one.
 */
export function boardTint(id: string): string {
	let hash = 0
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
	const hue = Math.abs(hash) % 360
	return gradient(hue, 75, 84)
}

/**
 * A chosen colour (`#rrggbb`), drawn the way the colour picked from the id is: from the colour itself
 * into a hue 40° on, a little less saturated and a little deeper. The swatches are those colours at the
 * default's own softness, so a red board looks like the default made red.
 */
export function boardGradient(hex: string): string {
	const { h, s, l } = hexToHsl(hex)
	return gradient(h, s, l)
}

function gradient(h: number, s: number, l: number): string {
	return `linear-gradient(135deg, hsl(${h} ${s}% ${l}%), hsl(${(h + 40) % 360} ${Math.max(s - 5, 0)}% ${Math.max(l - 4, 0)}%))`
}

/** `#rrggbb` for a hue in degrees and saturation and lightness in percent. */
export function hslToHex(h: number, s: number, l: number): string {
	const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
	const channel = (n: number) => {
		const k = (n + h / 30) % 12
		const value = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
		return Math.round(value * 255)
			.toString(16)
			.padStart(2, '0')
	}
	return `#${channel(0)}${channel(8)}${channel(4)}`
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
	const n = Number.parseInt(hex.slice(1), 16)
	const [r, g, b] = [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	const d = max - min
	if (d === 0) return { h: 0, s: 0, l: Math.round(l * 100) }
	const s = d / (1 - Math.abs(2 * l - 1))
	const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return { h: Math.round((h * 60 + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}
