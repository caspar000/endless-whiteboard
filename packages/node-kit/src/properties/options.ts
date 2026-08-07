/**
 * Colours for `select` / `multiSelect` options.
 *
 * Derived from the option's text rather than stored on the definition, which is the whole point:
 * Notion and ClickUp make you assign a colour per option and then keep them in sync by hand, while a
 * hash gives "DOING" the same colour on every board, in every table, forever — and costs the schema
 * nothing. `PropertyDef.options` stays a plain `string[]`, so nothing about equality, validation or
 * the JSON-scalar bound has to move.
 *
 * The trade is that you can't *choose* the colour. Worth it here: the colours exist to tell options
 * apart at a glance, not to mean anything.
 */

/**
 * Hues spaced far enough apart to stay distinguishable as chips, skipping the muddy yellow-greens.
 * Ten is enough that a realistic option list rarely collides, and a collision is cosmetic anyway.
 */
const HUES = [4, 25, 42, 96, 150, 172, 197, 224, 265, 320]

/**
 * A stable hue for an option label.
 *
 * Trimmed and lowercased, so `DONE` and `done` land on the same colour. Inner spacing is left alone:
 * `To Do` and `ToDo` are two different options, and colouring them alike would say otherwise.
 */
export function optionHue(option: string): number {
	const key = option.trim().toLowerCase()
	let hash = 0
	for (let i = 0; i < key.length; i++) {
		// The classic 31-multiplier string hash, coerced back to int32 each round so it can't drift
		// into float territory on a long label.
		hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0
	}
	return HUES[Math.abs(hash) % HUES.length]!
}

/** The inline style that paints a chip its option's colour. See `.lb-chip` in the stylesheet. */
export function optionStyle(option: string): Record<string, string> {
	return { '--lb-opt-h': String(optionHue(option)) }
}
