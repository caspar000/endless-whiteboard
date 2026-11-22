/**
 * The extension's page in Settings. Sources and categories belong to each board (DARK-14), so they are
 * kept beside the board's feed card, not here.
 */
export function FeedSettings() {
	return (
		<div className="lb-feeds-settings">
			<p className="lb-feeds-panel__hint">
				Each board has its own channels, feeds and categories. Double-click a feed card, or use its ⋯ menu, to add, file and remove that board’s. A board that had a feed card before keeps a copy of the
				ones you had then.
			</p>
		</div>
	)
}
