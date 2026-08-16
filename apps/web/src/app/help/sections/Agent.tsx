import { getVisibleOperations, subscribeToOperations } from '@lifeboard/node-kit'
import { useSyncExternalStore } from 'react'
import { Hint, Jump, Keys, Section, useDemo, type SectionProps } from '../kit'

/**
 * The agent panel, explained.
 *
 * The demo is built from the panel's own classes rather than `lb-demo__*` mock-ups, which is the one
 * place this page departs from the others and is worth the exception: the thing being described *is*
 * a piece of chrome, so showing it in its real styling is more honest than approximating it — and it
 * cannot drift, because it is the same CSS.
 *
 * The operation count is read from the live registry for the reason the skill gives: a number typed
 * out here would be wrong the first time anyone adds an operation or toggles an extension.
 */

const TURN_STEPS = [1400, 1200, 1400, 1400, 3200] as const

function TurnDemo() {
	const { step, ref } = useDemo(TURN_STEPS)

	return (
		<div
			className="lb-demo lb-demo--short"
			ref={ref}
			role="img"
			aria-label="The agent panel running a turn: a request, two tool calls, then a reply"
		>
			<div className="lb-help-agent">
				<div className="lb-agent-row lb-agent-row--user">Add a note for each city on our route</div>

				{step >= 1 && (
					<div className="lb-agent-row lb-agent-row--tool" data-state={step >= 2 ? 'ok' : 'running'}>
						<span className="lb-agent-row__tool-name">node.find</span>
						{step >= 2 && <span className="lb-agent-row__tool-summary">3 nodes</span>}
					</div>
				)}

				{step >= 2 && (
					<div className="lb-agent-row lb-agent-row--tool" data-state={step >= 3 ? 'ok' : 'running'}>
						<span className="lb-agent-row__tool-name">node.insert</span>
						{step >= 3 && <span className="lb-agent-row__tool-summary">shape:kQ2…</span>}
					</div>
				)}

				{step >= 4 && (
					<div className="lb-agent-row lb-agent-row--agent">
						Added four notes down the left, one per city.
					</div>
				)}
			</div>
		</div>
	)
}

export function Agent({ go }: SectionProps) {
	// Live, and it moves: switching an extension off withdraws its operations from the agent too.
	const operations = useSyncExternalStore(subscribeToOperations, getVisibleOperations)

	return (
		<>
			<Section title="Where it is">
				<p>
					The panel opens from the icon at the right of the tab strip, or with <Keys keys={['⌘⇧A']} />.
					It sits beside the board rather than over it, so you can keep working while it does — and
					you watch every change land on the canvas as it happens.
				</p>
				<TurnDemo />
				<p>
					There is nothing to set up. The agent signs in with the Claude Code login already on your
					machine, and the app starts it for you.
				</p>
			</Section>

			<Section title="What it can do">
				<p>
					It drives the board through the same {operations.length} operations an external agent gets
					over MCP — creating boards, adding and editing nodes, setting properties, drawing
					relations, configuring a table's source and columns, and querying what is already there.
					Ask for an outcome rather than a sequence:
					“work out which of these is cheapest per night and mark it” is a better request than a list
					of steps.
				</p>
				<p>
					It can also search the web, which is what makes research requests work end to end: it will
					look something up, then put what it found on the board as notes and pictures rather than
					only describing it back to you.
				</p>
				<Hint>
					Everything it does is an ordinary undo step, one per operation. If a turn goes somewhere
					you did not want, <Keys keys={['⌘Z']} /> walks back through it exactly as if you had
					done the work by hand.
				</Hint>
			</Section>

			<Section title="What it cannot do">
				<p>
					It has no shell and no access to your files. The only tools it is given are the board
					operations and web search — everything else is refused, so leaving the panel open is not
					the same as leaving a terminal open.
				</p>
				<p>
					You can narrow it further in <strong>Settings → Agents</strong>. Read-only withholds every
					operation that would change a board, which is the setting to use when you want it to
					answer questions about a board rather than edit one. The same switch governs an external
					agent connected over MCP — there is one place that decides what any agent may do.
				</p>
			</Section>

			<Section title="When it goes wrong">
				<p>
					A turn that names a node type the board does not have, or asks for an operation an
					extension provides while that extension is switched off, comes back as a refusal the agent
					can read and work around — it is told what is available rather than left guessing. If the
					panel says it is waiting for the agent, the process that runs it is not up; restarting the
					dev server starts it again.
				</p>
				<p>
					Images are fetched by the browser, so a host that does not allow that will fail. Direct
					file links from Wikimedia and most CDNs work; a link to the page an image sits on does
					not.
				</p>
				<p>
					What the agent can reach is exactly what the board offers, so{' '}
					<Jump to="properties" go={go}>properties</Jump> and{' '}
					<Jump to="relations" go={go}>relations</Jump> are worth reading first — they are the
					vocabulary it works in.
				</p>
			</Section>
		</>
	)
}
