// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RANDOMIZER_TYPE, randomizerNodeDefinition, type RandomizerProps } from '@lifeboard/randomizer'
import { useMemo, useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// The barrel, as the app loads it: this is what registers syllabi with the randomizer.
import './index'
import { putItems, putTracks, resetSyllabus } from './syllabus'
import { mergeDoc } from './syllabusMerge'
import { parseSyllabus } from './syllabusYaml'

/*
 * DARK-8, as a person does it: /mu/core dropped into the vault, a randomizer card on the board pointed
 * at it, shuffled, and the album it lands on shown with its cover. Nothing is stubbed between the two
 * extensions: the card finds the syllabus through the registration the barrel makes.
 */

const MAPFUMO = 'https://coverartarchive.org/release-group/1795f337-7004-3d35-a995-f7e1b0c9146e/front-500'
const RAMEAU = 'https://coverartarchive.org/release-group/a41e3a0a-413f-3abc-afd0-5e3ca68f0936/front-500'

/** Two of /mu/core's albums, as the file in syllabi/ writes them. */
const MUCORE = `goal: mucore
name: Music listener
tracks:
  - id: chart
    name: "/mu/core"
    state: active
    items:
      - id: sub-saharan-african-southern
        title: "Sub-Saharan African: Southern"
        kind: study
        medium: album
        childRule: all
        children:
          - { id: "0008-chimurenga", title: "Chimurenga: Thomas Mapfumo - The Chimurenga Singles (1976-1980)", medium: album, cover: "${MAPFUMO}" }
      - id: baroque
        title: "Baroque"
        kind: study
        medium: album
        childRule: all
        children:
          - { id: "0531-late-french-baroque", title: "Late French Baroque: Jean-Philippe Rameau- Hippolyte et Aricie (1733)", medium: album, cover: "${RAMEAU}" }
`

/** A randomizer on a board: the editor writes the card's props and opens its editor, as the real one does. */
function Board({ onProps }: { onProps: (props: RandomizerProps) => void }) {
	const [props, setProps] = useState<RandomizerProps>(() => randomizerNodeDefinition.defaultProps())
	const [editing, setEditing] = useState(false)
	const shape = { id: 'shape:rand', type: RANDOMIZER_TYPE, x: 0, y: 0, rotation: 0, props: { ...props, w: 360, h: 520 }, meta: {} }
	const latest = useRef(shape)
	latest.current = shape
	onProps(props)
	const editor = useMemo(
		() => ({
			run: (fn: () => void) => fn(),
			updateShape: ({ props: next }: { props: Partial<RandomizerProps> }) => setProps((p) => ({ ...p, ...next })),
			getShape: () => latest.current,
			select: () => {},
			setEditingShape: (id: string | null) => setEditing(id !== null),
			addOpenMenu: () => {},
			deleteOpenMenu: () => {},
			getShapePageBounds: () => ({ x: 0, y: 0, w: 360, h: 520 }),
			getViewportScreenBounds: () => ({ x: 0, y: 0, w: 1440, h: 900 }),
			pageToScreen: (p: { x: number; y: number }) => p,
			getContainer: () => document.body,
		}),
		[]
	)
	const Card = randomizerNodeDefinition.component
	return <Card shape={shape as never} isEditing={editing} editor={editor as never} />
}

let props: RandomizerProps
const mount = () => render(<Board onProps={(p) => (props = p)} />)
const card = () => screen.getByLabelText('Randomizer')
/** The picture in the card's window: the top half of the split flap. */
const coverOnShow = () => (card().querySelector('.lb-rand__half--top .lb-rand__img') as HTMLImageElement).src

beforeEach(() => {
	const parsed = parseSyllabus(MUCORE)
	if (!parsed.ok) throw new Error(parsed.errors.join('\n'))
	const merged = mergeDoc(parsed.doc, {}, {}, '')
	putItems(merged.items)
	putTracks(merged.tracks)
	// Reduced motion: the pick fades in rather than flipping through two dozen timed flaps.
	vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
})

afterEach(() => {
	cleanup()
	resetSyllabus()
	vi.unstubAllGlobals()
})

describe('a randomizer shuffling /mu/core', () => {
	it('offers /mu/core among its sources, and shows the album it lands on with its cover', async () => {
		mount()
		fireEvent.click(within(card()).getByRole('button', { name: 'Choose what to shuffle' }))

		const picker = screen.getByLabelText('Shuffle from') as HTMLSelectElement
		const mucore = Array.from(picker.options).find((o) => o.textContent === '/mu/core')
		expect(mucore?.parentElement?.getAttribute('label')).toBe('Syllabi: Music listener')
		fireEvent.change(picker, { target: { value: mucore!.value } })
		expect(props.source).toBe('syllabus:mucore/chart')
		expect(screen.getByText(/2 albums from \/mu\/core/)).toBeTruthy()
		fireEvent.click(screen.getByRole('button', { name: 'Done' }))

		// The first album is on show before any shuffle, as album and artist, on its own cover.
		expect(within(card()).getByText('2 albums')).toBeTruthy()
		expect(within(card()).getByRole('img', { name: 'Album cover: The Chimurenga Singles by Thomas Mapfumo' })).toBeTruthy()
		expect(coverOnShow()).toBe(MAPFUMO)

		fireEvent.click(within(card()).getByRole('button', { name: /^Shuffle/ }))
		await waitFor(() => expect(props.picks).toEqual([{ source: 'syllabus:mucore/chart', id: 'mucore/baroque/0531-late-french-baroque' }]))
		expect(within(card()).getByText('Picked Hippolyte et Aricie by Jean-Philippe Rameau, 1733.')).toBeTruthy()
		await waitFor(() => expect(coverOnShow()).toBe(RAMEAU))
	})
})
