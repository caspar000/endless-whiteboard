import { Grid2x2, Magnet } from 'lucide-react'
import type { CanvasPrefs, GridStyle } from '../canvasPrefs'
import { AuraAdvanced } from './AuraAdvanced'
import { Segmented, Toggle } from './controls'

const GRID_STYLES: { value: GridStyle; label: string }[] = [
	{ value: 'lifeboard', label: 'Lifeboard' },
	{ value: 'native', label: 'tldraw' },
]

/** The paper every board is drawn on: whether it shows, what it looks like, and whether it pulls. */
export function CanvasPanel({ canvas }: { canvas: CanvasPrefs }) {
	return (
		<section className="lb-settings">
			<h2>Grid</h2>

			<div className="lb-appearance__card">
				<Toggle
					label="Grid"
					hint="The dotted paper behind every board."
					icon={Grid2x2}
					checked={canvas.showGrid}
					onChange={canvas.setShowGrid}
				/>
				{canvas.showGrid && (
					<Segmented
						label="Grid style"
						value={canvas.gridStyle}
						options={GRID_STYLES}
						onChange={canvas.setGridStyle}
					/>
				)}
				<Toggle
					label="Snap to grid"
					hint="Dragging and resizing land on grid steps. Hold ⌘ to override."
					icon={Magnet}
					checked={canvas.snapToGrid}
					onChange={canvas.setSnapToGrid}
				/>
			</div>

			<AuraAdvanced />
		</section>
	)
}
