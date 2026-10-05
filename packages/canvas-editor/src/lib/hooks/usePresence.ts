import type { TLUserId } from '@tldraw/tlschema'
import { useValue } from '@tldraw/state-react'
import { TLInstancePresence } from '@tldraw/tlschema'
import { useMemo } from 'react'
import { useEditor } from './useEditor'

// TODO: maybe move this to a computed property on the App class?
/**
 * @returns The list of peer UserIDs
 * @internal
 */
export function usePresence(userId: string): TLInstancePresence | null {
	const editor = useEditor()

	const $presences = useMemo(() => {
		return editor.store.query.records('instance_presence', () => ({
			userId: { eq: userId as TLUserId },
		}))
	}, [editor, userId])

	const latestPresence = useValue(
		`latestPresence:${userId}`,
		() => {
			return $presences
				.get()
				.slice()
				.sort((a, b) => (b.lastActivityTimestamp ?? 0) - (a.lastActivityTimestamp ?? 0))[0]
		},
		[]
	)

	return latestPresence ?? null
}
