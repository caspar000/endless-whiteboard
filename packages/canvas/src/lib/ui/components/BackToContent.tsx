import { useEditor } from '@lifeboard/canvas-editor'
import { useEffect, useState } from 'react'
import { useActions } from '../hooks/useActions'
import { Button } from './primitives/Button'

export function BackToContent() {
	const editor = useEditor()

	const actions = useActions()
	const action = actions['back-to-content']

	const [showBackToContent, setShowBackToContent] = useState(false)

	useEffect(() => {
		let showBackToContentPrev = false

		const interval = setInterval(() => {
			// From the bounds index: the rendering shapes' masked bounds, asked for every second, kept a
			// set of computeds alive for every shape on the board.
			const showBackToContentNow =
				editor.getCurrentPageShapeIds().size > 0 && !editor.hasShapesInBounds(editor.getRenderingBounds())

			if (showBackToContentPrev !== showBackToContentNow) {
				setShowBackToContent(showBackToContentNow)
				showBackToContentPrev = showBackToContentNow
			}
		}, 1000)

		return () => {
			clearInterval(interval)
		}
	}, [editor])

	if (!showBackToContent) return null

	return (
		<Button
			iconLeft={action.icon}
			label={action.label}
			type="low"
			onClick={() => {
				action.onSelect('helper-buttons')
				setShowBackToContent(false)
			}}
		/>
	)
}
