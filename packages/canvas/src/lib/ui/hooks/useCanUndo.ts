import { useEditor, useValue } from '@lifeboard/canvas-editor'

/** @public */
export function useCanUndo() {
	const editor = useEditor()
	return useValue('useCanUndo', () => editor.getCanUndo(), [editor])
}
