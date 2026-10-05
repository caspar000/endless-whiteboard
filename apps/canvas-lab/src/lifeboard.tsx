import { Tldraw, type Editor, type TLAnyShapeUtilConstructor } from '@lifeboard/canvas'
import { deleteRelationsWithShapes, placeViewMembers, watchViewDragOut } from '@lifeboard/node-kit'
import { STORE_MIGRATIONS, nodeShapeUtils, registerShippedExtensions } from '@lifeboard/schema'
import { loadFixtureSnapshot } from './fixtures'

/**
 * Lifeboard's own nodes on the fork: the shipped extensions registered as the app registers them, a
 * reference board loaded through the app's store migrations, and the app's stylesheet. Phase 5 of
 * docs/canvas-fork-plan.md, before the app itself moves (phase 7).
 */
export async function renderLifeboard(
	name: string,
	props: { assetUrls: object; onMount(editor: Editor): void }
) {
	registerShippedExtensions()
	await import('../../web/src/styles.css')
	const snapshot = await loadFixtureSnapshot(name)
	const shapeUtils: TLAnyShapeUtilConstructor[] = nodeShapeUtils()
	return (
		<Tldraw
			snapshot={snapshot}
			migrations={STORE_MIGRATIONS}
			shapeUtils={shapeUtils}
			assetUrls={props.assetUrls}
			onMount={(editor) => {
				props.onMount(editor)
				// The board behaviour the app turns on when a board mounts (Board.tsx): views place
				// their cards, relations go with their shapes, cards can be dragged out of views.
				const stops = [
					placeViewMembers(editor),
					deleteRelationsWithShapes(editor),
					watchViewDragOut(editor),
				]
				return () => stops.forEach((stop) => stop())
			}}
		/>
	)
}
