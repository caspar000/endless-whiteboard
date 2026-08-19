/**
 * Which model answers in the agent panel, and how hard it thinks.
 *
 * The panel used to have neither control: it took whatever model the host was launched with and
 * whatever reasoning effort Claude Code defaults to, which is `high`. That is the right default for
 * writing code and the wrong one for "add a note per city" — the turn spends more thinking about the
 * request than doing it. Both are now on the composer, next to the box, because the choice is made
 * per request rather than configured once and forgotten.
 *
 * The catalog is a table here rather than a question asked of the host, and that is a deliberate
 * trade. The SDK can report its own model list (`Query.supportedModels()`), but only from a *running*
 * conversation — so asking would leave the pickers empty until after the first turn, which is exactly
 * the turn somebody wants to make cheap. The list is pinned by the SDK version in
 * `packages/agent-host/package.json`, so it moves when that does.
 */

/**
 * The reasoning levels the Claude Agent SDK accepts.
 *
 * `xhigh` and `max` are quietly downgraded by Claude Code on a model that cannot do them, which is
 * why `efforts` below only offers what each model actually supports — a picker that lets you choose
 * a level and then silently ignores it is worse than one that does not offer it.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface EffortOption {
	value: EffortLevel
	label: string
	/**
	 * What picking this costs you, in the panel's own terms.
	 *
	 * Written out because the control exists to be used: "Medium" alone tells you nothing about
	 * whether it is enough for the request you are about to type.
	 */
	description: string
}

export interface AgentModel {
	/** What goes on the wire and into the SDK's `model` option. */
	slug: string
	name: string
	/** For the composer's trigger, which has a 360px column to live in. */
	shortName: string
	description: string
	/** Empty for a model with no reasoning control, which hides the effort picker entirely. */
	efforts: readonly EffortOption[]
	defaultEffort: EffortLevel | null
}

/**
 * The five levels, shared by every Claude 5 model.
 *
 * One list rather than a copy per model: they genuinely are the same five, and the moment a model
 * differs it gets its own array — which is what `claude-haiku-4-5` does below, with none at all.
 */
const CLAUDE_5_EFFORTS: readonly EffortOption[] = [
	{
		value: 'low',
		label: 'Low',
		description: 'Barely reasons. Right for a request that is really a handful of tool calls.',
	},
	{
		value: 'medium',
		label: 'Medium',
		description: 'Enough to plan a few steps. The panel default.',
	},
	{
		value: 'high',
		label: 'High',
		description: "Claude Code's own default, and more than most board work needs.",
	},
	{
		value: 'xhigh',
		label: 'Extra High',
		description: 'For a request it has to work out before it can start.',
	},
	{
		value: 'max',
		label: 'Max',
		description: 'Thinks as long as it is allowed to. Slow, and the most expensive.',
	},
]

/**
 * The models the panel offers, strongest first.
 *
 * The order is the recommendation — it is what ⌘1 lands on and what somebody scanning the list reads
 * as "the good one" — so it descends by capability rather than by slug or by release date.
 *
 * Only current models. Claude Code still answers to older slugs, but a picker is advice, and there is
 * no board request better served by a superseded model.
 */
export const AGENT_MODELS: readonly AgentModel[] = [
	{
		slug: 'claude-fable-5',
		name: 'Claude Fable 5',
		shortName: 'Fable 5',
		description: 'Opus-class, and the best of them at writing. For boards that are mostly prose.',
		efforts: CLAUDE_5_EFFORTS,
		defaultEffort: 'high',
	},
	{
		slug: 'claude-opus-5',
		name: 'Claude Opus 5',
		shortName: 'Opus 5',
		description: 'The strongest all-rounder. Reach for it when a turn keeps going wrong.',
		efforts: CLAUDE_5_EFFORTS,
		defaultEffort: 'high',
	},
	{
		slug: 'claude-sonnet-5',
		name: 'Claude Sonnet 5',
		shortName: 'Sonnet 5',
		description: 'Fast, and easily enough for building and editing a board.',
		efforts: CLAUDE_5_EFFORTS,
		defaultEffort: 'high',
	},
	{
		slug: 'claude-haiku-4-5',
		name: 'Claude Haiku 4.5',
		shortName: 'Haiku 4.5',
		description: 'The cheapest. For bulk edits you have already described exactly.',
		// No reasoning control at all, so the effort picker does not render for it.
		efforts: [],
		defaultEffort: null,
	},
]

/**
 * What a fresh install gets: Sonnet at medium.
 *
 * Not the model's own default (`high`) and not the strongest model, because the panel's median
 * request is a few tool calls against a board the user is looking at. Somebody who wants Opus at max
 * is one click from it and the choice sticks; somebody who never opens the picker should not be
 * paying Opus-at-high prices to be told four notes were added.
 */
export const DEFAULT_MODEL_SLUG = 'claude-sonnet-5'
export const DEFAULT_EFFORT: EffortLevel = 'medium'

export interface AgentModelSelection {
	model: string
	/** `null` for a model with no reasoning control — see `AgentModel.efforts`. */
	effort: EffortLevel | null
}

export function findAgentModel(slug: string): AgentModel | null {
	return AGENT_MODELS.find((model) => model.slug === slug) ?? null
}

/**
 * A stored pair, made valid.
 *
 * localStorage outlives the catalog: a slug that was offered last month may not be now, and an
 * effort level may have been dropped from the model that had it. Both fall back rather than reaching
 * the SDK, because the SDK's answer to an unknown model is a failed turn.
 *
 * An unusable level falls back to the **panel's** default rather than the model's, and that is the
 * load-bearing choice in this file: `high` is what Claude Code picks for itself and it is the wrong
 * starting point for board work, so a person who has never opened the picker — or whose stored level
 * has just been dropped — should not land on it. A model that does not offer `medium` at all is the
 * only case where its own default applies.
 */
export function resolveSelection(slug: string | null, effort: string | null): AgentModelSelection {
	const model = (slug && findAgentModel(slug)) || findAgentModel(DEFAULT_MODEL_SLUG)
	// Only reachable if the catalog itself is empty, which it is not — but the fallback keeps this
	// function total rather than making every caller handle a null.
	if (!model) return { model: DEFAULT_MODEL_SLUG, effort: DEFAULT_EFFORT }

	if (model.efforts.length === 0) return { model: model.slug, effort: null }
	const asked = model.efforts.find((option) => option.value === effort)
	if (asked) return { model: model.slug, effort: asked.value }

	const panelDefault = model.efforts.find((option) => option.value === DEFAULT_EFFORT)
	return {
		model: model.slug,
		effort: panelDefault?.value ?? model.defaultEffort ?? model.efforts[0]?.value ?? DEFAULT_EFFORT,
	}
}

// ---------------------------------------------------------------------------
// The stored selection
// ---------------------------------------------------------------------------

/**
 * localStorage and a module-level store, the same shape as `prefs.ts` and for the same reason: the
 * choice belongs to the person, not to a panel that may be closed.
 *
 * Kept out of `AgentPrefs` deliberately. Everything in there governs whether something outside the
 * browser may touch your boards, and this does not — mixing a taste setting into a security switch
 * makes both harder to reason about.
 */
const MODEL_KEY = 'lifeboard:agentModel'
const EFFORT_KEY = 'lifeboard:agentEffort'

function read(key: string): string | null {
	try {
		return localStorage.getItem(key)
	} catch {
		return null
	}
}

function write(key: string, value: string): void {
	try {
		localStorage.setItem(key, value)
	} catch {
		// Private-mode Safari throws on write. Losing the choice across reloads is not worth handling.
	}
}

let selection: AgentModelSelection | null = null
const listeners = new Set<() => void>()

export function getAgentModelSelection(): AgentModelSelection {
	// Stable between changes: `useSyncExternalStore` loops forever on a snapshot rebuilt per read.
	selection ??= resolveSelection(read(MODEL_KEY), read(EFFORT_KEY))
	return selection
}

export function subscribeToAgentModelSelection(listener: () => void): () => void {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

function publish(next: AgentModelSelection): void {
	selection = next
	write(MODEL_KEY, next.model)
	// The absence of an effort is itself a choice worth remembering, so a model with none clears the
	// key rather than leaving the previous model's level behind to be picked up later.
	write(EFFORT_KEY, next.effort ?? '')
	for (const listener of listeners) listener()
}

/**
 * Switches model, keeping the effort level where it can.
 *
 * Carrying the level across is the point: somebody who has settled on `low` and moves up to Opus
 * wants Opus at low, not Opus at whatever Anthropic ships as the default. It falls back only when
 * the new model does not offer the level at all.
 */
export function setAgentModel(slug: string): void {
	publish(resolveSelection(slug, getAgentModelSelection().effort))
}

export function setAgentEffort(effort: EffortLevel): void {
	publish(resolveSelection(getAgentModelSelection().model, effort))
}
