import { useState } from 'react'
import { dataUrlFor } from '../agent/images'
import type { TranscriptRow } from '../agent/chat'
import { shouldCollapseMessage } from '../agent/transcript'
import { AgentMarkdown } from './AgentMarkdown'
import { CopyButton } from './AgentMarkdown'

/**
 * The user's own turn.
 *
 * Collapsed past a threshold, because a pasted brief is a wall: a 900-character request rendered whole
 * pushes the reply — and everything before it — off the panel, and the request is the one thing in the
 * transcript the reader already knows. T3 Code's thresholds and treatment, including the mask fade,
 * which is what tells you there is more without spending a line saying so.
 */
export function AgentUserMessage({
	row,
	onExpandImage,
}: {
	row: Extract<TranscriptRow, { kind: 'user' }>
	onExpandImage: (dataUrl: string, alt: string) => void
}) {
	const [expanded, setExpanded] = useState(false)
	const collapsible = shouldCollapseMessage(row.text)
	const collapsed = collapsible && !expanded

	return (
		<div className="lb-agent-user">
			<div className="lb-agent-row lb-agent-row--user">
				{row.images?.length ? (
					<div className="lb-agent-row__images">
						{row.images.map((image, index) => {
							const src = dataUrlFor(image)
							const alt = `Attached image ${index + 1}`
							return (
								<button
									key={index}
									type="button"
									className="lb-agent-row__image"
									title="Expand"
									aria-label={`Expand ${alt}`}
									onClick={() => onExpandImage(src, alt)}
								>
									<img src={src} alt={alt} />
								</button>
							)
						})}
					</div>
				) : null}
				{/* The mask is inline rather than a class because it is the one thing that has to switch
				    with the collapsed state, and a two-state gradient in CSS reads worse than this. */}
				<div
					className="lb-agent-user__body"
					data-collapsed={collapsed || undefined}
					style={
						collapsed
							? {
									maskImage: 'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)',
									WebkitMaskImage:
										'linear-gradient(to bottom, black calc(100% - 1.75rem), transparent)',
								}
							: undefined
					}
				>
					{/* `remark-breaks` is on here and off for the assistant: a person's newlines are where
					    they pressed Enter, a model's are prose wrapping. */}
					<AgentMarkdown text={row.text} breaks />
				</div>
			</div>

			<div className="lb-agent-user__footer">
				{collapsible && (
					<button
						type="button"
						className="lb-agent-user__more"
						aria-expanded={expanded}
						data-scroll-anchor-ignore
						onClick={() => setExpanded(!expanded)}
					>
						{expanded ? 'Show less' : 'Show full message'}
					</button>
				)}
				<span className="lb-agent-panel__spacer" />
				{row.at > 0 && (
					<time
						className="lb-agent-user__time"
						dateTime={new Date(row.at).toISOString()}
						title={new Date(row.at).toLocaleString()}
					>
						{new Date(row.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
					</time>
				)}
				<CopyButton text={row.text} label="Copy message" />
			</div>
		</div>
	)
}
