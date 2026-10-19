import { atom } from '@lifeboard/canvas'
import type { TLShapeId } from '@lifeboard/canvas'
import type { BandReport } from './bands'
import type { BubbleGuide } from './bubbles'

/** The last band layout's report, for the band guides (tree/BandGuides.tsx): set wherever the layout ran. */
export const lastBands = atom<BandReport | null>('lifeboard:skill-tree-bands', null)

/** The last plain bubble layout's bubbles, each by the shape of the node it holds the subtree of (tree/BubbleGuides.tsx). */
export const lastBubbles = atom<(BubbleGuide & { shape: TLShapeId })[] | null>('lifeboard:skill-tree-bubbles', null)
