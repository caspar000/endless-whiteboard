import { SourcesPanel } from './SourcesPanel'

/** The extension's page in Settings: the same sources and categories a feed card shows beside it. */
export function FeedSettings() {
	return (
		<div className="lb-feeds-settings">
			<SourcesPanel />
		</div>
	)
}
