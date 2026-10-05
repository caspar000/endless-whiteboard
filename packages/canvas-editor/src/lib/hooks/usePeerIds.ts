import type { TLUserId } from '@tldraw/tlschema'
import { useComputed, useValue } from '@tldraw/state-react'
import { useMemo } from 'react'
import { uniq } from '../utils/uniq'
import { useEditor } from './useEditor'

// TODO: maybe move this to a computed property on the App class?
/**
 * @returns The list of peer UserIDs
 * @internal
 */
export function usePeerIds() {
	const editor = useEditor()
	const $presences = useMemo(() => {
		return editor.store.query.records('instance_presence', () => ({
			userId: { neq: editor.user.getId() as TLUserId },
		}))
	}, [editor])

	const $userIds = useComputed(
		'userIds',
		() => uniq($presences.get().map((p) => p.userId)).sort(),
		{ isEqual: (a, b) => a.join(',') === b.join?.(',') },
		[$presences]
	)

	return useValue($userIds)
}
