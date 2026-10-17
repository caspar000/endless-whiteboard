import type { Editor, TLShapeId } from '@lifeboard/canvas'
import { isItem } from './board'
import { addChildItem, createItem, createTrack, ITEM_HEIGHT, setCollapsed, type NewItem } from './ops'

/**
 * The first fifteen entries of Adler's reading list (*How to Read a Book*, appendix A), as test data
 * for every step of the build (docs/skill-tree-plan.md, "Build steps").
 *
 * Works marked core are the ones this sample treats as an entry's centre, so the entry counts as
 * read once they are; the others add depth. The full list arrives through the YAML import of step 5.
 */
export interface SampleEntry extends NewItem {
	works?: { title: string; core?: boolean }[]
}

export const ADLER_SAMPLE: readonly SampleEntry[] = [
	{ title: 'Homer', tags: 'adler/greek-epic-drama', works: [{ title: 'Iliad', core: true }, { title: 'Odyssey', core: true }] },
	{ title: 'The Old Testament' },
	{ title: 'Aeschylus, Tragedies', tags: 'adler/greek-epic-drama', works: [{ title: 'Oresteia', core: true }, { title: 'Prometheus Bound' }] },
	{ title: 'Sophocles, Tragedies', tags: 'adler/greek-epic-drama', works: [{ title: 'Oedipus the King', core: true }, { title: 'Antigone' }, { title: 'Oedipus at Colonus' }] },
	{ title: 'Herodotus, History', tags: 'adler/greek-history' },
	{ title: 'Euripides, Tragedies', tags: 'adler/greek-epic-drama', works: [{ title: 'Medea', core: true }, { title: 'Hippolytus' }, { title: 'The Bacchae', core: true }] },
	{ title: 'Thucydides, History of the Peloponnesian War', tags: 'adler/greek-history' },
	{ title: 'Hippocrates, Medical writings', tags: 'adler/greek-science' },
	{ title: 'Aristophanes, Comedies', tags: 'adler/greek-epic-drama', works: [{ title: 'The Clouds', core: true }, { title: 'The Birds' }, { title: 'The Frogs' }] },
	{
		title: 'Plato, Dialogues', tags: 'adler/greek-philosophy',
		works: [
			{ title: 'The Republic', core: true },
			{ title: 'Symposium', core: true },
			{ title: 'Apology', core: true },
			{ title: 'Phaedo' },
			{ title: 'Meno' },
			{ title: 'Phaedrus' },
			{ title: 'Protagoras' },
			{ title: 'Gorgias' },
			{ title: 'Sophist' },
			{ title: 'Theaetetus' },
		],
	},
	{
		title: 'Aristotle', tags: 'adler/greek-philosophy',
		works: [
			{ title: 'Poetics', core: true },
			{ title: 'Nicomachean Ethics', core: true },
			{ title: 'Politics', core: true },
			{ title: 'Rhetoric' },
			{ title: 'Physics' },
			{ title: 'Metaphysics' },
			{ title: 'On the Soul' },
			{ title: 'Organon' },
		],
	},
	{ title: 'Epicurus, Letters', tags: 'adler/greek-philosophy', works: [{ title: 'Letter to Herodotus' }, { title: 'Letter to Menoeceus' }], childRule: 'all' },
	{ title: 'Euclid, Elements', tags: 'adler/greek-science' },
	{ title: 'Archimedes', tags: 'adler/greek-science', works: [{ title: 'On the Equilibrium of Planes' }, { title: 'On Floating Bodies' }, { title: 'The Sand-Reckoner' }], childRule: 'n:1' },
	{ title: 'Apollonius of Perga, On Conic Sections', tags: 'adler/greek-science' },
]

const ROW_GAP = 24
/** A collapsed card's checklist row, for spacing entries before their cards have measured themselves. */
const LIST_ROW = 24
const TRACK_GAP = 60

/**
 * Puts the sample on the board at a point: a track card, and the entries in a column beside it with
 * their works as collapsed children. One undo entry.
 */
export function insertAdlerSample(editor: Editor, at: { x: number; y: number }): TLShapeId {
	let trackId!: TLShapeId
	editor.run(() => {
		editor.markHistoryStoppingPoint('insert Adler sample')
		const itemX = at.x + 360 + TRACK_GAP
		let y = at.y
		const itemIds: string[] = []
		for (const [index, entry] of ADLER_SAMPLE.entries()) {
			const id = createItem(
				editor,
				{
					...entry,
					itemId: `adler/${String(index + 1).padStart(3, '0')}-${slug(entry.title)}`,
					kind: 'Study',
					medium: 'book',
				},
				{ x: itemX, y }
			)
			const shape = editor.getShape(id)
			if (isItem(shape)) itemIds.push(shape.props.itemId)
			for (const work of entry.works ?? []) {
				addChildItem(editor, id, {
					title: work.title,
					core: work.core,
					kind: 'Study',
					medium: 'work',
					itemId: `${shape && isItem(shape) ? shape.props.itemId : 'adler'}/${slug(work.title)}`,
				}, false)
			}
			const works = entry.works?.length ?? 0
			if (works > 0) setCollapsed(editor, id, true, false)
			// Collapsed children are hidden and listed on the card, so the next entry goes under the card
			// as it will be once it has grown to fit its checklist.
			y += ITEM_HEIGHT + 16 + works * LIST_ROW + ROW_GAP
		}
		trackId = createTrack(
			editor,
			{ name: "Adler's reading list (sample)", goal: 'Western canon reader', trackId: 'adler/canon', itemIds, state: 'active' },
			at
		)
	})
	return trackId
}

function slug(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
}
