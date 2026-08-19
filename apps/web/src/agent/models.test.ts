import { beforeEach, describe, expect, it } from 'vitest'
import {
	AGENT_MODELS,
	DEFAULT_EFFORT,
	DEFAULT_MODEL_SLUG,
	getAgentModelSelection,
	resolveSelection,
	setAgentEffort,
	setAgentModel,
} from './models'

/**
 * The catalog's job is to never hand the SDK something it will refuse.
 *
 * A model slug or effort level that the far side rejects is not a wrong label in a menu — it is a
 * failed turn, after the user has typed their request. Everything here is about what happens when the
 * stored pair and the catalog disagree, which is the normal state of affairs after an upgrade.
 */

describe('the panel default', () => {
	it('is a model the catalog actually offers, at a level that model has', () => {
		// Pinned because it is the value nobody chooses: if the default slug is ever edited to something
		// the catalog does not list, every fresh install silently falls back and nobody notices.
		const model = AGENT_MODELS.find((entry) => entry.slug === DEFAULT_MODEL_SLUG)
		expect(model).toBeDefined()
		expect(model?.efforts.map((effort) => effort.value)).toContain(DEFAULT_EFFORT)
	})

	it('is cheaper than the model would pick for itself', () => {
		// The reason this control exists: Claude Code defaults to `high`, which spends more on thinking
		// about "add a note per city" than on doing it.
		const model = AGENT_MODELS.find((entry) => entry.slug === DEFAULT_MODEL_SLUG)
		expect(DEFAULT_EFFORT).not.toBe(model?.defaultEffort)
	})

	it('gives every model with reasoning levels a default among them', () => {
		for (const model of AGENT_MODELS) {
			if (model.efforts.length === 0) {
				expect(model.defaultEffort, model.slug).toBeNull()
				continue
			}
			expect(model.efforts.map((effort) => effort.value), model.slug).toContain(model.defaultEffort)
		}
	})
})

describe('resolving a stored pair', () => {
	it('keeps a pair the catalog still offers', () => {
		expect(resolveSelection('claude-opus-5', 'max')).toEqual({ model: 'claude-opus-5', effort: 'max' })
	})

	it('falls back to the default model when the stored slug is gone', () => {
		// The case that matters: a model dropped from the catalog must not reach the SDK, because its
		// answer to an unknown model is a failed turn rather than a substitution.
		expect(resolveSelection('claude-opus-3', 'low')).toEqual({
			model: DEFAULT_MODEL_SLUG,
			effort: 'low',
		})
	})

	/**
	 * The panel's default, not the model's.
	 *
	 * `high` is what the model would pick for itself, and picking it here would mean an upgrade that
	 * drops a level quietly moves somebody onto a more expensive setting than they had.
	 */
	it("falls back to the panel default when the level is not one the model offers", () => {
		expect(resolveSelection('claude-opus-5', 'ludicrous')).toEqual({
			model: 'claude-opus-5',
			effort: DEFAULT_EFFORT,
		})
	})

	it('has no level at all for a model with no reasoning control', () => {
		// Not "the default level" — Haiku takes no effort parameter, and sending one is how a turn ends
		// up charged for a setting the model cannot use.
		expect(resolveSelection('claude-haiku-4-5', 'max')).toEqual({
			model: 'claude-haiku-4-5',
			effort: null,
		})
	})

	it('resolves nothing at all', () => {
		expect(resolveSelection(null, null)).toEqual({
			model: DEFAULT_MODEL_SLUG,
			effort: DEFAULT_EFFORT,
		})
	})
})

describe('the stored selection', () => {
	beforeEach(() => {
		// The store is module state; each test sets it explicitly rather than depending on the last.
		setAgentModel(DEFAULT_MODEL_SLUG)
		setAgentEffort(DEFAULT_EFFORT)
	})

	it('carries the level across a model switch', () => {
		// The point of carrying it: somebody who has settled on `low` and moves up to Opus wants Opus at
		// low, not Opus at whatever the provider ships as its default.
		setAgentEffort('low')
		setAgentModel('claude-opus-5')
		expect(getAgentModelSelection()).toEqual({ model: 'claude-opus-5', effort: 'low' })
	})

	it('drops the level for a model that has none, and restores one on the way back', () => {
		setAgentEffort('max')
		setAgentModel('claude-haiku-4-5')
		expect(getAgentModelSelection()).toEqual({ model: 'claude-haiku-4-5', effort: null })

		// Coming back cannot restore `max` — the store no longer holds it — so it lands on the panel's
		// default rather than on nothing, and notably not on the model's more expensive `high`.
		setAgentModel('claude-opus-5')
		expect(getAgentModelSelection()).toEqual({ model: 'claude-opus-5', effort: DEFAULT_EFFORT })
	})

	it('returns the same object between changes', () => {
		// `useSyncExternalStore` re-renders forever on a snapshot rebuilt per read.
		expect(getAgentModelSelection()).toBe(getAgentModelSelection())
	})
})
