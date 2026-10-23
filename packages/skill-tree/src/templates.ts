/**
 * What the evidence note starts as, per medium (docs/skill-tree-plan.md, "Completion and evidence").
 *
 * Headings and prompts only: `hasEvidence` ignores every line that is also a line of the template, so
 * a note counts as evidence once something has been written under a heading. Editing these is a later
 * step (templates saved with the vault, like card layouts); for now they ship as the defaults.
 */

export const MEDIA = [
	'book',
	'work',
	'play',
	'film',
	'game',
	'album',
	'talk',
	'exercise',
	'artefact',
	'visit',
] as const
export type Medium = (typeof MEDIA)[number]

/** The method a template's evidence is filed under, for the method nodes of a later step. */
export interface Template {
	method: string
	md: string
}

const book: Template = {
	method: 'analytical',
	md: `## What is it about, as a whole?

## What is being said in detail, and how?

## Is it true, in whole or part?

## What of it?
`,
}

const TEMPLATES: Record<Medium, Template> = {
	book,
	work: book,
	play: {
		method: 'ball',
		md: `## Stasis and intrusion

## Triggers and heaps

## Forwards: what pulls you on

## Staging choices worth stealing
`,
	},
	film: {
		method: 'film-sheet',
		md: `## Scene and mode (tableau, montage, long take)

## Shot log: what the viewer learns, what they feel

## Where to look

## Game translation: beats and the one mechanic
`,
	},
	game: {
		method: 'five-passes',
		md: `## Formal

## Dramatic and dynamic

## MDA: aesthetic, dynamic, mechanic

## Director's pass

## One sequence, written up
`,
	},
	album: {
		method: 'listening',
		md: `## Standout track

## Three lines
`,
	},
	talk: {
		method: 'notes',
		md: `## The argument

## What I'll use
`,
	},
	exercise: {
		method: 'practice',
		md: `## What I built

## What happened when someone tried it

## What I'd change
`,
	},
	artefact: {
		method: 'postmortem',
		md: `## What it is

## What went right

## What went wrong

## Next time
`,
	},
	visit: {
		method: 'notes',
		md: `## Where and what

## What I'll use
`,
	},
}

const fallback: Template = { method: 'notes', md: `## Notes\n` }

export function templateFor(medium: string | null | undefined): Template {
	return (medium && (TEMPLATES as Record<string, Template>)[medium.toLowerCase()]) || fallback
}
