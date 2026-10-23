/**
 * The first fifteen entries of Adler's reading list (*How to Read a Book*, appendix A) as they were
 * first built: the ids content/adler.yaml keeps for them, so an import merges with anything made
 * from the sample. Reference data for content.test.ts; the list itself is content/adler.yaml.
 */
export interface SampleEntry {
	title: string
	tags?: string
	childRule?: string
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
