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

import type { PropertyDef, StatusStage } from './types'

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

/**
 * `status` colours come from the stage, not from the label — that is the whole difference between a
 * status and a select. Two boards spelling "done" as `Shipped` and `Closed` should still look alike,
 * and a hash would give them nothing in common.
 *
 * Grey / blue / green, which is what Notion, ClickUp and Linear all landed on independently: unstarted
 * work should recede, and finished work should read as finished without being read.
 */
const STAGE_COLOURS: Record<StatusStage, { h: number; s: number }> = {
	todo: { h: 225, s: 9 },
	active: { h: 210, s: 70 },
	done: { h: 150, s: 55 },
}

export function stageStyle(stage: StatusStage): Record<string, string> {
	const { h, s } = STAGE_COLOURS[stage]
	return { '--lb-opt-h': String(h), '--lb-opt-s': `${s}%` }
}

/** Which stage an option sits in. Unlisted means `todo`, so `stages` can stay absent until it matters. */
export function stageForOption(def: Pick<PropertyDef, 'stages'>, option: string): StatusStage {
	return def.stages?.[option] ?? 'todo'
}

/** The style for one option of any choice type — stage-coloured for a status, hashed otherwise. */
export function choiceStyle(
	def: Pick<PropertyDef, 'type' | 'stages'>,
	option: string
): Record<string, string> {
	return def.type === 'status' ? stageStyle(stageForOption(def, option)) : optionStyle(option)
}
