import type { Editor } from '@lifeboard/canvas'
import { MASTERY_NODE } from '../board'
import { confirmDraft, importSyllabus } from '../syllabusIO'
import { parseSyllabus } from '../syllabusYaml'
import { getTreeDef, updateTreeMeta } from '../treeDefs'
import { syncBoard } from '../treeSync'
import { layoutReach } from './ops'

/**
 * Mastery, five pillars (Physical, Mental, Spiritual, Practical, Social) and a starter tree on each,
 * as one syllabus document: the shape of a whole self-education laid out on one board. Every node
 * past a tree's root asks for one written-up item tagged to it, so the demo starts in reach rather
 * than lit. Rename, extend or delete any of it; it is ordinary vault data once inserted.
 */
export const MASTERY_DEMO = `goal: mastery
name: Mastery
trees:
  - id: mastery
    name: Mastery
    nodes:
      - { id: root, name: Mastery, kind: mastery, icon: trophy }
      - { id: physical, name: Physical, kind: pillar, icon: barbell, requires: [ { node: [root] } ] }
      - { id: mental, name: Mental, kind: pillar, icon: brain, requires: [ { node: [root] } ] }
      - { id: spiritual, name: Spiritual, kind: pillar, icon: leaf, requires: [ { node: [root] } ] }
      - { id: practical, name: Practical, kind: pillar, icon: hammer, requires: [ { node: [root] } ] }
      - { id: social, name: Social, kind: pillar, icon: users, requires: [ { node: [root] } ] }

  - id: body
    name: Body
    mount: physical
    nodes:
      - { id: move, name: Move Every Day, kind: root, icon: run }
      - { id: strength, name: Strength, icon: weight, requires: [ { node: [move] }, { count: { min: 1 } } ] }
      - { id: mobility, name: Mobility, icon: stretching, requires: [ { node: [move] }, { count: { min: 1 } } ] }
      - { id: endurance, name: Endurance, icon: heart-rate-monitor, requires: [ { node: [move] }, { count: { min: 1 } } ] }
      - { id: recovery, name: Sleep and Recovery, icon: moon, requires: [ { node: [move] }, { count: { min: 1 } } ] }

  - id: mind
    name: Mind
    mount: mental
    nodes:
      - { id: focus, name: Deep Focus, kind: root, icon: focus-2 }
      - { id: reading, name: Reading Practice, icon: book, requires: [ { node: [focus] }, { count: { min: 1 } } ] }
      - { id: memory, name: Memory, icon: brain, requires: [ { node: [focus] }, { count: { min: 1 } } ] }
      - { id: writing, name: Writing to Think, icon: pencil, requires: [ { node: [reading] }, { count: { min: 1 } } ] }

  - id: spirit
    name: Spirit
    mount: spiritual
    nodes:
      - { id: stillness, name: Daily Stillness, kind: root, icon: sun }
      - { id: meditation, name: Meditation, icon: yoga, requires: [ { node: [stillness] }, { count: { min: 1 } } ] }
      - { id: gratitude, name: Gratitude, icon: heart, requires: [ { node: [stillness] }, { count: { min: 1 } } ] }
      - { id: reflection, name: Reflection Journal, icon: notebook, requires: [ { node: [meditation] }, { count: { min: 1 } } ] }

  - id: craft
    name: Craft
    mount: practical
    nodes:
      - { id: play, name: Play Critically, kind: root, icon: device-gamepad-2 }
      - { id: film, name: Study Film, icon: movie, requires: [ { node: [play] }, { count: { min: 1 } } ] }
      - { id: theatre, name: Study Theatre, icon: masks-theater, requires: [ { node: [play] }, { count: { min: 1 } } ] }
      - { id: prototype, name: Ship a Prototype, kind: keystone, icon: rocket, requires: [ { node: [film, theatre] }, { count: { min: 1, kind: ship } } ] }

  - id: people
    name: People
    mount: social
    nodes:
      - { id: show-up, name: Show Up, kind: root, icon: users }
      - { id: listen, name: Listen Well, icon: ear, requires: [ { node: [show-up] }, { count: { min: 1 } } ] }
      - { id: host, name: Host a Gathering, icon: confetti, requires: [ { node: [show-up] }, { count: { min: 1 } } ] }
      - { id: mentor, name: Mentor Someone, icon: school, requires: [ { node: [listen] }, { count: { min: 1 } } ] }
`

/**
 * Puts the demo on this board, confirmed (it is a sample, not something to review), and hangs the
 * Adler tree under Mental if the vault has it and it hangs from nothing yet. Then lays the whole
 * view out around Mastery.
 */
export function insertMasteryDemo(editor: Editor, at: { x: number; y: number }): void {
	const parsed = parseSyllabus(MASTERY_DEMO)
	if (!parsed.ok) throw new Error(`The Mastery demo does not parse: ${parsed.errors.join('; ')}`)
	importSyllabus(editor, parsed.doc, at)
	confirmDraft(editor)
	if (getTreeDef('adler') && !getTreeDef('adler')!.mount) updateTreeMeta('adler', { mount: 'mastery/mental' })
	// Bring in what the view now reaches (Adler) before the one layout, so it is placed with the rest.
	syncBoard(editor)
	layoutReach(editor, MASTERY_NODE, 'lay out Mastery')
}
