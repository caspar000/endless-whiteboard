import {
	ChevronRight,
	Eye,
	Globe,
	Hammer,
	Layers,
	Link2,
	SquarePen,
	Table,
	Wrench,
	type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { TranscriptRow } from '../agent/chat'
import { formatToolInput, prettyToolName } from '../agent/toolRow'

/**
 * A run of tool calls, as one piece of work.
 *
 * The transcript used to list each call as its own row, which is honest about ordering and useless to
 * read: a research turn became a ladder of near-identical pills. Grouping them the way T3 Code does
 * gives the run one heading — "4 tool calls" — and one disclosure, so the transcript stays about what
 * the agent *said* and the work is there when you want it.
 *
 * The group is open while its calls are still running and closes itself once they are all done: you
 * watch work happen, then it gets out of the way.
 */

type ToolRow = Extract<TranscriptRow, { kind: 'tool' }>

/**
 * An icon per operation family.
 *
 * Keyed off the id's first segment rather than a per-operation table, so an extension contributing
 * `node.*` operations gets the right glyph without registering anything. The families are the ones
 * node-kit actually has; anything unrecognised falls back to the generic wrench.
 */
const ICONS: Record<string, LucideIcon> = {
	board: Layers,
	node: SquarePen,
	property: Table,
	relation: Link2,
	view: Eye,
}

function iconFor(name: string): LucideIcon {
	const pretty = prettyToolName(name)
	// The web tools are not ours and are not namespaced, so they are matched by name.
	if (pretty === 'WebSearch' || pretty === 'WebFetch') return Globe
	if (pretty === 'ToolSearch') return Hammer
	return ICONS[pretty.split('.')[0] ?? ''] ?? Wrench
}

export function AgentWorkGroup({ tools }: { tools: readonly ToolRow[] }) {
	const running = tools.some((tool) => tool.state === 'running')
	const failed = tools.some((tool) => tool.state === 'failed')
	// Uncontrolled, seeded from whether the work is live: open while it happens, shut afterwards. A
	// group the user has toggled keeps their choice, which is why this is state and not derived.
	const [open, setOpen] = useState(running)

	// A single call is its own heading — a disclosure around one row costs more than it hides.
	if (tools.length === 1 && tools[0]) return <WorkRow tool={tools[0]} />

	return (
		<div className="lb-agent-work" data-open={open || undefined} data-failed={failed || undefined}>
			<button
				type="button"
				className="lb-agent-work__head"
				aria-expanded={open}
				data-scroll-anchor-ignore
				onClick={() => setOpen(!open)}
			>
				<ChevronRight size={12} aria-hidden="true" className="lb-agent-work__chevron" />
				<span className="lb-agent-work__label">
					{tools.length} tool call{tools.length === 1 ? '' : 's'}
				</span>
				{/* A closed group still has to admit that something in it went wrong. */}
				{failed && !open && <span className="lb-agent-work__failed">failed</span>}
				{running && <span className="lb-agent-work__running" aria-label="Running" />}
			</button>
			{open && (
				<div className="lb-agent-work__body">
					{tools.map((tool) => (
						<WorkRow key={tool.id} tool={tool} />
					))}
				</div>
			)}
		</div>
	)
}

/**
 * One tool call.
 *
 * The same row the transcript used to show at the top level, now also usable inside a group — which is
 * why it keeps its own expander for the arguments rather than deferring to the group's.
 */
export function WorkRow({ tool }: { tool: ToolRow }) {
	const [open, setOpen] = useState(false)
	const detail = formatToolInput(tool.input)
	const Icon = iconFor(tool.name)

	return (
		<div className="lb-agent-tool" data-state={tool.state} data-open={open || undefined}>
			<button
				type="button"
				className="lb-agent-tool__head"
				disabled={!detail}
				aria-expanded={detail ? open : undefined}
				data-scroll-anchor-ignore
				onClick={() => setOpen(!open)}
			>
				<Icon size={11} aria-hidden="true" className="lb-agent-tool__icon" />
				<span className="lb-agent-tool__name">{prettyToolName(tool.name)}</span>
				{tool.summary && <span className="lb-agent-tool__summary">{tool.summary}</span>}
				{detail && (
					<ChevronRight size={11} aria-hidden="true" className="lb-agent-tool__chevron" />
				)}
			</button>
			{open && detail && <pre className="lb-agent-tool__detail">{detail}</pre>}
		</div>
	)
}
