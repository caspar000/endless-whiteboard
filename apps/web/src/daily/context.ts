import { createContext, useContext } from 'react'
import type { BoardMeta } from '../boards/boardIndex'
import type { BlobStore } from '../platform/PlatformAdapter'
import type { DailySetup, Day, DayPage, WeekPlan } from './model'

/** What every widget on a page reads: the day, its page and week, and where to go from there. */
export interface DailyContextValue {
	setup: DailySetup
	day: Day
	/** The page the day shows (stored, or new with carried tasks): not stored until changed. */
	page: DayPage
	pages: Readonly<Record<string, DayPage>>
	plans: Readonly<Record<string, WeekPlan>>
	plan: WeekPlan | undefined
	/** The day's focus, an area id or ''. */
	focus: string
	editing: boolean
	blobs: BlobStore
	boards: readonly BoardMeta[]
	updatePage: (change: (page: DayPage) => DayPage) => void
	openDay: (day: Day) => void
	openReview: (day: Day) => void
	openBoard: (board: BoardMeta) => void
}

export const DailyContext = createContext<DailyContextValue | null>(null)

export function useDaily(): DailyContextValue {
	const value = useContext(DailyContext)
	if (!value) throw new Error('useDaily must be used inside the daily page')
	return value
}
