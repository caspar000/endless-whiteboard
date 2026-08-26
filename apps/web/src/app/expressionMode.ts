import {
	evaluateExpression,
	expressionForBoard,
	expressionSuggestions,
	getCurrentRates,
	getPageEdges,
	getPageFacts,
	getUserQueries,
	isAggregateExpression,
	propertyMap,
	queryNameProblem,
	readPropertyRegistry,
	readShapeProperties,
	readShapePropertyUnits,
} from '@lifeboard/node-kit'
import type { Editor } from 'tldraw'
import { EXPRESSION_PREFIX, splitSaveClause } from './paletteItems'

/**
 * `=` in the palette — the half that needs the editor.
 *
 * The evaluator is the one the notes use (`collections/expressions.ts`) and the completions are the
 * ones the `{…}` menu offers (`collections/suggest.ts`), reached through the same two functions.
 * Nothing is reimplemented here: a question typed into ⌘K and the same question typed into a note
 * have to mean the same thing, and the only way to guarantee that is to ask the same code.
 */
export interface ExpressionPreview {
	/**
	 * The answer, or `null` when what has been typed is not (yet) a question. `null` is the
	 * evaluator's own "I do not recognise this", and it stays silent rather than reporting an error —
	 * the same forgiveness that lets a note keep an unresolved `{…}` looking like what you typed.
	 */
	result: string | null
	/** What the expression will say once written down: the question with its scope spelled out. */
	explicit: string
	/** Completions from the `{…}` menu's own rules, each as the whole query it would produce. */
	completions: { label: string; detail: string; query: string }[]
	/** The name typed after `as`, with why it cannot be used — or `null` when none was. */
	saveAs: { name: string; problem: string | null } | null
	/** Set when the whole question is just the name of a question the user saved earlier. */
	savedName: string | null
}

export function readExpression(editor: Editor, raw: string): ExpressionPreview {
	// The naming clause is stripped before anything else looks at the line: `sum cash page as runway`
	// is the question `sum cash page`, and every rule below is about that.
	const { question: body, saveAs } = splitSaveClause(raw)
	const properties = readPropertyRegistry(editor)
	const explicit = expressionForBoard(body)

	/*
	 * The selected shape is the subject of the bare-property form (`= price` → this shape's price)
	 * and of nothing else. An aggregate question asked from the palette has **no** subject, and must
	 * not borrow one: a query excludes its own shape from what it collects, so passing the selection
	 * would make `= count` quietly answer "everything except the thing you happen to have clicked".
	 */
	const selected = isAggregateExpression(body) ? null : editor.getOnlySelectedShape()

	const result = body.trim()
		? evaluateExpression(explicit, {
				facts: getPageFacts(editor).get(),
				edges: getPageEdges(editor).get(),
				properties: propertyMap(properties),
				rates: getCurrentRates(),
				selfId: selected?.id ?? '',
				values: selected ? readShapeProperties(selected) : {},
				units: selected ? readShapePropertyUnits(selected) : {},
			})
		: null

	// Only the user's own are offered for forgetting: an extension's vocabulary goes away with the
	// extension, and a row that appeared to delete one would be promising something it cannot do.
	const saved = getUserQueries().find(
		(query) => query.name.toLowerCase() === body.trim().toLowerCase()
	)

	const suggestions = expressionSuggestions(body, properties)
	const completions = (suggestions?.items ?? []).map((item) => ({
		label: item.label,
		detail: item.detail,
		// `from` is an offset into the body, so the word being typed is replaced rather than appended:
		// `= sum pri` + "Price" is `= sum Price`, not `= sum priPrice`.
		query: `${EXPRESSION_PREFIX}${body.slice(0, suggestions?.from ?? 0)}${item.insert}`,
	}))

	return {
		result,
		explicit,
		completions,
		saveAs: saveAs === null ? null : { name: saveAs, problem: queryNameProblem(saveAs) },
		savedName: saved?.name ?? null,
	}
}
