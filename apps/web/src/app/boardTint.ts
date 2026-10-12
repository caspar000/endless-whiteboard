/**
 * A board's colour in the sidebar and the tab strip: a soft two-hue gradient picked from its id, so
 * a board keeps its colour across renames and devices without storing one.
 */
export function boardTint(id: string): string {
	let hash = 0
	for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
	const hue = Math.abs(hash) % 360
	return `linear-gradient(135deg, hsl(${hue} 75% 84%), hsl(${(hue + 40) % 360} 70% 80%))`
}
