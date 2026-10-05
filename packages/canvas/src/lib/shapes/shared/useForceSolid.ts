import { useEditor, useValue } from '@lifeboard/canvas-editor'

export function useForceSolid() {
	const editor = useEditor()
	return useValue('zoom', () => editor.getZoomLevel() < 0.35, [editor])
}
