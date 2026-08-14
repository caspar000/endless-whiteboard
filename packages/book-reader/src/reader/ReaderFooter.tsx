/**
 * Where you are in the book, for either engine: how far through, and what to call the place.
 *
 * The bar is a control, not decoration. A reader that shows progress and refuses to let you drag it
 * is a tease — and both engines can seek by fraction, so there is no reason to withhold it.
 */
export function ReaderFooter({
	label,
	fraction,
	onSeek,
}: {
	/** "Page 12 of 340", "Loc 1,204", "48%" — whatever the format can honestly claim. */
	label: string
	/** How far through the book, 0–1. */
	fraction: number
	onSeek(fraction: number): void
}) {
	const percent = Math.min(100, Math.max(0, fraction * 100))

	return (
		<footer className="lb-reader__foot">
			<div
				className="lb-reader__track"
				role="slider"
				tabIndex={0}
				aria-label="Position in book"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(percent)}
				aria-valuetext={label}
				onPointerDown={(event) => {
					const box = event.currentTarget.getBoundingClientRect()
					onSeek(Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)))
				}}
				onKeyDown={(event) => {
					// A step of 1% — a book is long, and arrow keys should not take all afternoon.
					const step = event.key === 'ArrowLeft' ? -0.01 : event.key === 'ArrowRight' ? 0.01 : 0
					if (!step) return
					event.preventDefault()
					onSeek(Math.min(1, Math.max(0, fraction + step)))
				}}
			>
				<div className="lb-reader__track-fill" style={{ width: `${percent}%` }} />
			</div>
			<span className="lb-reader__pos">{label}</span>
		</footer>
	)
}
