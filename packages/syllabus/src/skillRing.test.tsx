// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { makeTrees, replaceTreeDefs, SKILL_TYPE, skillNodeDefinition, type SkillNodeProps } from '@lifeboard/skill-tree'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { putEvidence, putItems, putTracks, removeEvidence, resetSyllabus, setDone } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { makerId } from './syllabusTrees'
import { parseSyllabus } from './syllabusYaml'
import { confirmTreePlans, keepTreePlans, resetTreePlans } from './treePlans'

/*
 * DARK-10, as a person sees it: /mu/core collapsed to its skill nodes, nothing listened to. Ancient
 * hangs from the root and asks for two albums written up, so it is in reach from the start, and its
 * ring has to stay empty until an album is done. The node is drawn once, and follows the ticks.
 *
 * DARK-15: a ring is how much of the node's list is done (Ancient: 1 album of 3), not how close it is
 * to unlocking (2 albums), and a node above is the average of the nodes under it. Western Classical's
 * 8 genres, with as many albums as /mu/core gives them, are 1/8 of it each.
 */

/** Western Classical's genres in /mu/core: id, albums, and how many unlock it. */
const GENRES: readonly (readonly [string, number, number])[] = [
	['medieval', 5, 1],
	['renaissance', 10, 2],
	['baroque', 20, 4],
	['classical', 10, 2],
	['romantic', 25, 5],
	['modern', 25, 5],
	['postmodern', 20, 4],
	['other', 20, 4],
]

/** Ancient as /mu/core's file in syllabi/ writes it, its three albums and its node, and Western Classical's genres. */
const MUCORE = `goal: mucore
name: Music listener
tracks:
  - id: chart
    name: "/mu/core"
    state: active
    items:
      - id: ancient
        title: "Ancient"
        kind: study
        medium: album
        tags: [ancient]
        childRule: all
        children:
          - { id: "1100-ancient", title: "Ancient Sumerian, Ancient Egyptian, Ancient Greek: Ensemble De Organographia - Music of the Ancient Sumerians, Egyptians & Greeks", medium: album }
          - { id: "1101-ancient-greek", title: "Ancient Greek: Gregorio Paniagua - Musique de la Grèce antique", medium: album }
          - { id: "1102-ancient-roman", title: "Ancient Roman: Musica Romana - Symphonia Panica", medium: album }
${GENRES.map(
	([id, albums]) => `      - id: western-classical-${id}
        title: "Western Classical: ${id}"
        kind: study
        medium: album
        tags: [western-classical-${id}]
        childRule: all
        children:
${Array.from({ length: albums }, (_, n) => `          - { id: "${id}-${n + 1}", title: "${id} ${n + 1}", medium: album }`).join('\n')}
`
).join('')}tree:
  id: mucore
  name: "/mu/core"
  nodes:
    - { id: root, name: "Listen Widely", kind: root, icon: ear }
    - { id: ancient, name: "Ancient", icon: building-arch, requires: [ { node: [root] }, { count: { min: 2 } } ] }
    - { id: western-classical, name: "Western Classical", kind: pillar, icon: piano, requires: [ { node: [root] } ] }
${GENRES.map(([id, , unlockAt]) => `    - { id: western-classical-${id}, name: "${id}", icon: piano, requires: [ { node: [western-classical] }, { count: { min: ${unlockAt} } } ] }`).join('\n')}
`

const ALBUM = 'mucore/ancient/1100-ancient'
const RING = 2 * Math.PI * 44

/** A /mu/core node on a board: the skill node's own component, with the little of an editor it reads. */
function mountNode(id: string, kind = 'skill') {
	const props: SkillNodeProps = { ...skillNodeDefinition.defaultProps(), treeId: 'mucore', nodeId: `mucore/${id}`, name: id, kind }
	const shape = { id: `shape:${id}`, type: SKILL_TYPE, x: 0, y: 0, rotation: 0, props: { ...props, w: 120, h: 120 }, meta: {} }
	const Node = skillNodeDefinition.component
	return render(<Node shape={shape as never} isEditing={false} editor={editor as never} />).container
}

const editor = { getCurrentPageShapes: () => [] }
const mountAncient = () => mountNode('ancient')

/** Ticks the `n`th album of a Western Classical genre. */
const tick = (genre: string, n = 1) => act(() => void setDone(`mucore/western-classical-${genre}/${genre}-${n}`, true, '2026-11-23'))

/** Ticks an album and writes it up, or takes both back, as the list and its write-up note do. */
function listenTo(itemId: string, done: boolean) {
	act(() => {
		setDone(itemId, done, '2026-11-21')
		if (done) putEvidence({ itemId, boardId: 'board-1', shapeId: 'shape:note', written: true, method: '' })
		else removeEvidence('board-1', 'shape:note')
	})
}

const fill = (node: HTMLElement) => node.querySelector('.lb-skillnode__fill')
/** How full the ring is drawn, 0 to 1. */
const drawn = (node: HTMLElement) => {
	const ring = fill(node)
	return ring ? Number(ring.getAttribute('stroke-dasharray')!.split(' ')[0]) / RING : 0
}
const caption = (node: HTMLElement) => node.querySelector('.lb-skillnode__caption')!.textContent

beforeEach(() => {
	const parsed = parseSyllabus(MUCORE)
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
	const merged = mergeDoc(parsed.doc, {}, {}, '')
	putItems(merged.items)
	putTracks(merged.tracks)
	keepTreePlans(parsed.doc.trees, ['mucore/chart'], 'board-1')
	confirmTreePlans('board-1')
	makeTrees([makerId('mucore/chart')])
})

afterEach(() => {
	cleanup()
	resetSyllabus()
	resetTreePlans()
	replaceTreeDefs({})
})

describe("a /mu/core genre's ring", () => {
	it('is empty with nothing done, fills as albums are, and empties again when one is taken back', () => {
		const node = mountAncient()
		// In reach, its prerequisite met, and still nothing drawn: not a part ring, not a dot.
		expect(node.querySelector('.lb-skillnode--available')).toBeTruthy()
		expect(caption(node)).toBe('0/3')
		expect(fill(node)).toBeNull()

		listenTo(ALBUM, true)
		expect(caption(node)).toBe('1/3')
		expect(drawn(node)).toBeCloseTo(1 / 3)

		listenTo(ALBUM, false)
		expect(caption(node)).toBe('0/3')
		expect(fill(node)).toBeNull()
	})

	/*
	 * DARK-14: Romantic at 1 of its albums ticked showed nothing, because only a written-up note
	 * counted and a tick no longer files one. A tick alone is progress; a prerequisite still is not.
	 */
	it('fills from a tick alone, with no write-up, and only from what is done', () => {
		const node = mountAncient()
		expect(fill(node)).toBeNull()

		act(() => void setDone(ALBUM, true, '2026-11-22'))
		expect(caption(node)).toBe('1/3')
		expect(drawn(node)).toBeCloseTo(1 / 3)

		act(() => void setDone(ALBUM, false))
		expect(caption(node)).toBe('0/3')
		expect(fill(node)).toBeNull()
	})
})

describe('DARK-15: a ring above a genre', () => {
	it('fills Romantic by its own list, 1 album of 25, and Western Classical by an eighth of that', () => {
		const romantic = mountNode('western-classical-romantic')
		const western = mountNode('western-classical', 'pillar')
		expect(caption(western)).toBe('1 tree · 0%')
		expect(fill(western)).toBeNull()

		tick('romantic')
		expect(caption(romantic)).toBe('1/25')
		expect(drawn(romantic)).toBeCloseTo(1 / 25)
		expect(caption(western)).toBe('1 tree · 0.5%')
		expect(drawn(western)).toBeCloseTo(1 / 8 / 25)
	})

	it('adds a Classical and a Baroque album by their own lists: 1/25, 1/10 and 1/20, each an eighth', () => {
		const western = mountNode('western-classical', 'pillar')
		const root = mountNode('root', 'root')
		tick('romantic')
		tick('classical')
		tick('baroque')
		const expected = (1 / 25 + 1 / 10 + 1 / 20) / 8
		expect(expected).toBeCloseTo(0.02375)
		expect(drawn(western)).toBeCloseTo(expected)
		expect(caption(western)).toBe('1 tree · 2.4%')
		// A level up, the same again: the root's two shares are Ancient and Western Classical.
		expect(drawn(root)).toBeCloseTo(expected / 2)
		expect(caption(root)).toBe('1.2%')
	})

	it('keeps counting toward the whole list once the genre unlocks at 5 albums', () => {
		const romantic = mountNode('western-classical-romantic')
		for (let n = 1; n <= 4; n++) tick('romantic', n)
		expect(romantic.querySelector('.lb-skillnode--available')).toBeTruthy()
		tick('romantic', 5)
		expect(romantic.querySelector('.lb-skillnode--unlocked')).toBeTruthy()
		expect(caption(romantic)).toBe('5/25')
		expect(drawn(romantic)).toBeCloseTo(5 / 25)
	})
})
