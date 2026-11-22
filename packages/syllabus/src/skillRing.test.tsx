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
 */

/** Ancient as /mu/core's file in syllabi/ writes it: its three albums, and its node in the tree. */
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
tree:
  id: mucore
  name: "/mu/core"
  nodes:
    - { id: root, name: "Listen Widely", kind: root, icon: ear }
    - { id: ancient, name: "Ancient", icon: building-arch, requires: [ { node: [root] }, { count: { min: 2 } } ] }
`

const ALBUM = 'mucore/ancient/1100-ancient'
const RING = 2 * Math.PI * 44

/** The Ancient node on a board: the skill node's own component, with the little of an editor it reads. */
function mountAncient() {
	const props: SkillNodeProps = { ...skillNodeDefinition.defaultProps(), treeId: 'mucore', nodeId: 'mucore/ancient', name: 'Ancient', icon: 'building-arch' }
	const shape = { id: 'shape:ancient', type: SKILL_TYPE, x: 0, y: 0, rotation: 0, props: { ...props, w: 120, h: 120 }, meta: {} }
	const editor = { getCurrentPageShapes: () => [] }
	const Node = skillNodeDefinition.component
	return render(<Node shape={shape as never} isEditing={false} editor={editor as never} />).container
}

/** Ticks an album and writes it up, or takes both back, as the list and its write-up note do. */
function listenTo(itemId: string, done: boolean) {
	act(() => {
		setDone(itemId, done, '2026-11-21')
		if (done) putEvidence({ itemId, boardId: 'board-1', shapeId: 'shape:note', written: true, method: '' })
		else removeEvidence('board-1', 'shape:note')
	})
}

const fill = (node: HTMLElement) => node.querySelector('.lb-skillnode__fill')
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
		expect(caption(node)).toBe('0/2')
		expect(fill(node)).toBeNull()

		listenTo(ALBUM, true)
		expect(caption(node)).toBe('1/2')
		expect(fill(node)!.getAttribute('stroke-dasharray')).toBe(`${RING / 2} ${RING}`)

		listenTo(ALBUM, false)
		expect(caption(node)).toBe('0/2')
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
		expect(caption(node)).toBe('1/2')
		expect(fill(node)!.getAttribute('stroke-dasharray')).toBe(`${RING / 2} ${RING}`)

		act(() => void setDone(ALBUM, false))
		expect(caption(node)).toBe('0/2')
		expect(fill(node)).toBeNull()
	})
})
