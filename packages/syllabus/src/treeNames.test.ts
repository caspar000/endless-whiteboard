import { getTreeDef, replaceTreeDefs, updateTreeMeta } from '@lifeboard/skill-tree'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTrack, putTracks, resetSyllabus, updateTrack, type TrackDef } from './syllabus'
import { namePairs, planNames, stopTreeNames, watchTreeNames } from './treeNames'

const track = (trackId: string, name: string, over: Partial<TrackDef> = {}): TrackDef => ({
	trackId,
	name,
	goal: '',
	state: 'active',
	order: [],
	defaultTags: [],
	draft: '',
	...over,
})

const tree = (treeId: string, name: string, draft = '') => ({ treeId, name, draft, nodes: [{ nodeId: `${treeId}/root` }] })

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('a syllabus and its tree', () => {
	beforeEach(() => {
		resetSyllabus()
		replaceTreeDefs({})
	})
	afterEach(stopTreeNames)

	it('pair up only when one confirmed syllabus feeds the tree', () => {
		replaceTreeDefs({ adler: tree('adler', 'Western Canon Reader'), film: tree('film', 'Film'), games: tree('games', 'Games', 'board-1') })
		const tracks = {
			'adler/canon': track('adler/canon', 'Literature Syllabus'),
			'film/craft': track('film/craft', 'Film Craft'),
			'film/canon': track('film/canon', 'World Canon'),
			'games/design': track('games/design', 'Game Design'),
			'mine-x1y2': track('mine-x1y2', 'Mine'),
		}
		expect(namePairs(tracks, { adler: getTreeDef('adler')!, film: getTreeDef('film')!, games: getTreeDef('games')! }).map((p) => p.treeId)).toEqual(['adler'])
	})

	it("take the syllabus's name when they first meet, and the tree's when only the tree was renamed", () => {
		replaceTreeDefs({ adler: tree('adler', 'Western Canon Reader') })
		const agreed = new Map<string, string>()
		const tracks = { 'adler/canon': track('adler/canon', 'Literature Syllabus') }
		const trees = { adler: getTreeDef('adler')! }
		expect(planNames(tracks, trees, agreed)).toEqual({ tracks: [], trees: [{ treeId: 'adler', name: 'Literature Syllabus' }] })
		expect(planNames(tracks, { adler: { ...trees.adler, name: 'Literature Syllabus' } }, agreed)).toEqual({ tracks: [], trees: [] })
		expect(agreed.get('adler')).toBe('Literature Syllabus')
		expect(planNames(tracks, { adler: { ...trees.adler, name: 'Literature' } }, agreed)).toEqual({ tracks: [{ trackId: 'adler/canon', name: 'Literature' }], trees: [] })
		expect(planNames(tracks, { adler: { ...trees.adler, name: '' } }, agreed)).toEqual({ tracks: [], trees: [] })
	})

	it('stay together as either is renamed', async () => {
		replaceTreeDefs({ adler: tree('adler', 'Western Canon Reader') })
		putTracks([track('adler/canon', 'Literature Syllabus')])
		watchTreeNames()
		await flush()
		expect(getTreeDef('adler')!.name).toBe('Literature Syllabus')
		updateTrack('adler/canon', { name: 'Great Books' })
		await flush()
		expect(getTreeDef('adler')!.name).toBe('Great Books')
		updateTreeMeta('adler', { name: 'The Canon' })
		await flush()
		expect(getTrack('adler/canon')!.name).toBe('The Canon')
	})
})
