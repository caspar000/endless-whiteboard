import { useEditor, useValue } from '@lifeboard/canvas-editor'

/** @public */
export function useCanRedo() {
	const editor = useEditor()
	return useValue('useCanRedo', () => editor.getCanRedo(), [editor])
}
