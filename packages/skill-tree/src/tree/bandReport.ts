import { atom } from '@lifeboard/canvas'
import type { BandReport } from './bands'

/** The last band layout's report, for the band guides (tree/BandGuides.tsx): set wherever the layout ran. */
export const lastBands = atom<BandReport | null>('lifeboard:skill-tree-bands', null)
