import { useValue } from '@tldraw/state-react'
import { useEditor } from './useEditor'

/** @public */
export function useIsDarkMode() {
	const editor = useEditor()
	return useValue('isDarkMode', () => editor.user.getIsDarkMode(), [editor])
}
