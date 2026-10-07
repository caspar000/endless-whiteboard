import { ArrowUpDown, Crop, Grid2x2, Hand, LockOpen, Magnet, Scaling, ZoomIn } from 'lucide-react'
import type { CanvasPrefs, GridStyle } from '../canvasPrefs'
import { AuraAdvanced } from './AuraAdvanced'
import { Segmented, Toggle } from './controls'
import { useUserPreference } from './useUserPreference'

const GRID_STYLES: { value: GridStyle; label: string }[] = [
	{ value: 'lifeboard', label: 'Lifeboard' },
	{ value: 'native', label: 'Classic' },
]

const PIXEL_RATIOS = [
	{ value: '1', label: '1×' },
	{ value: '2', label: '2×' },
	{ value: '3', label: '3×' },
] as const

const WHEEL_BEHAVIORS: { value: 'pan' | 'zoom'; label: string; icon: typeof Hand }[] = [
	{ value: 'pan', label: 'Scrolls', icon: Hand },
	{ value: 'zoom', label: 'Zooms', icon: ZoomIn },
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

			<Controls />

			<Export />

			<AuraAdvanced />
		</section>
	)
}

/** How pictures of the board come out: Export as PNG or SVG, Copy as PNG. */
function Export() {
	const [pixelRatio, setPixelRatio] = useUserPreference('exportPixelRatio')
	const [trimmed, setTrimmed] = useUserPreference('isExportTrimmed')
	return (
		<>
			<h2>Export</h2>
			<div className="lb-appearance__card">
				<Segmented
					label="Picture size"
					value={String(pixelRatio ?? 2) as (typeof PIXEL_RATIOS)[number]['value']}
					options={[...PIXEL_RATIOS]}
					onChange={(value) => setPixelRatio(Number(value))}
				/>
				<Toggle
					label="Trim to the drawing"
					hint="No margin: the picture ends where the shapes do, arrowheads and labels included."
					icon={Crop}
					checked={trimmed ?? false}
					onChange={setTrimmed}
				/>
			</div>
		</>
	)
}

/** How the mouse moves around the board, and what a click can pick up. */
function Controls() {
	const [wheelBehavior, setWheelBehavior] = useUserPreference('wheelBehavior')
	const [inverted, setInverted] = useUserPreference('isZoomDirectionInverted')
	const [selectLocked, setSelectLocked] = useUserPreference('canSelectLockedShapes')
	const [dynamicSize, setDynamicSize] = useUserPreference('isDynamicSizeMode')
	return (
		<>
			<h2>Controls</h2>
			<div className="lb-appearance__card">
				<Segmented
					label="Mouse wheel"
					value={wheelBehavior ?? 'pan'}
					options={WHEEL_BEHAVIORS}
					onChange={setWheelBehavior}
				/>
				<Toggle
					label="Invert wheel zoom"
					hint="Wheeling up zooms out. ⌘-wheel and pinching follow it too."
					icon={ArrowUpDown}
					checked={inverted ?? false}
					onChange={setInverted}
				/>
				<Toggle
					label="Dynamic size"
					hint="New shapes keep their size on screen: drawn zoomed out, they come out bigger."
					icon={Scaling}
					checked={dynamicSize ?? false}
					onChange={setDynamicSize}
				/>
				<Toggle
					label="Select locked shapes"
					hint="A click or a drag can pick them up, to copy or unlock. They still don't move."
					icon={LockOpen}
					checked={selectLocked ?? false}
					onChange={setSelectLocked}
				/>
			</div>
		</>
	)
}
