import { getVisibleOperations, subscribeToOperations } from '@lifeboard/node-kit'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { AGENT_MODELS, DEFAULT_EFFORT, DEFAULT_MODEL_SLUG } from '../../../agent/models'
import { ClaudeMark } from '../../AgentBrandIcons'
import { AgentContextMeter } from '../../AgentContextMeter'
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

/**
 * The cursor, shown with the cursor's own CSS.
 *
 * Same exception as the panel demo above, for the same reason: this is chrome, so drawing it with the
 * real `lb-agent-*` classes is both more honest and impossible to let drift. Only the board under it
 * is a mock-up.
 */
const CURSOR_STEPS = [1800, 2000, 2200] as const

const CURSOR_STAGES = [
	{ kind: 'read', verb: 'Looking at 2 shapes', op: 'node.find', x: 60, y: 44, ring: { x: 60, y: 44, w: 200, h: 62 } },
	{ kind: 'create', verb: 'Adding sticky note', op: 'node.insert', x: 320, y: 60, ring: { x: 320, y: 60, w: 150, h: 92 } },
	{ kind: 'update', verb: 'Setting Price', op: 'property.set', x: 60, y: 44, ring: { x: 60, y: 44, w: 200, h: 62 } },
] as const

function CursorDemo() {
	// The ref is what starts it: `useDemo` only advances while the demo is actually on screen.
	const { step, ref } = useDemo(CURSOR_STEPS)
	const stage = CURSOR_STAGES[step] ?? CURSOR_STAGES[0]

	return (
		<div
			className="lb-demo lb-demo--short"
			ref={ref}
			role="img"
			aria-label="An agent's cursor moving across a board, ringing the shape it is working on"
		>
			<div className="lb-demo__scene">
				<div className="lb-demo__note" style={{ left: 60, top: 44, width: 200 }}>
					Standing desk
				</div>
				<div className="lb-agent-presence" data-kind={stage.kind}>
					<div
						className="lb-agent-ring"
						key={`${step}:ring`}
						style={{
							transform: `translate(${stage.ring.x}px, ${stage.ring.y}px)`,
							width: stage.ring.w,
							height: stage.ring.h,
						}}
					/>
					<div className="lb-agent-cursor" style={{ transform: `translate(${stage.x}px, ${stage.y}px)` }}>
						<svg className="lb-agent-cursor__arrow" viewBox="0 0 20 22" aria-hidden="true">
							<path
								d="M2 1.6 L2 17.4 L6.2 13.6 L9 20 L12 18.7 L9.2 12.6 L15 12.4 Z"
								stroke="var(--lb-canvas)"
								strokeWidth="1.4"
								strokeLinejoin="round"
							/>
						</svg>
						<div className="lb-agent-cursor__label">
							<span className="lb-agent-cursor__verb">{stage.verb}</span>
							<span className="lb-agent-cursor__op">{stage.op}</span>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

/**
 * The composer's model and reasoning controls.
 *
 * Real classes again, and the labels come from the catalog rather than being retyped — a model list
 * written out here would be wrong the first time one is added or dropped. Only the *first* two models
 * are named, because the point of the picture is the shape of the control, not the roster.
 */
function ComposerDemo() {
	const model = AGENT_MODELS.find((entry) => entry.slug === DEFAULT_MODEL_SLUG) ?? AGENT_MODELS[0]
	const effort = model?.efforts.find((option) => option.value === DEFAULT_EFFORT)

	return (
		<div
			className="lb-demo lb-demo--short"
			role="img"
			aria-label="The agent composer, with a model picker and a reasoning picker beside the send button"
		>
			<div className="lb-help-agent">
				<div className="lb-agent-composer">
					<div className="lb-agent-panel__input" aria-hidden="true">
						Find every node with no Status and set it to Todo
					</div>
					<div className="lb-agent-panel__actions">
						<div className="lb-agent-controls">
							<span className="lb-agent-control">
								<span className="lb-agent-control__label">
									<ClaudeMark size={13} />
									{model?.shortName}
								</span>
								<ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" className="lb-agent-control__chevron" />
							</span>
							<span className="lb-agent-control">
								<span className="lb-agent-control__label">{effort?.label}</span>
								<ChevronDown size={13} strokeWidth={2.25} aria-hidden="true" className="lb-agent-control__chevron" />
							</span>
						</div>
						<span className="lb-agent-panel__spacer" />
						{/* The real meter, given a plausible figure — the component is the documentation. */}
						<AgentContextMeter usage={{ used: 42_000, max: 200_000 }} />
						<span className="lb-agent-panel__send">
							<ArrowUp size={15} strokeWidth={2.5} aria-hidden="true" />
						</span>
					</div>
				</div>
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
					It makes the board's plain shapes too, not only typed nodes: a text caption, a sticky, a
					rectangle, a frame around a group. “Give that cluster a title” gets a piece of text, which
					is what you would have drawn.
				</p>
				<p>
					<strong>It already knows what you are looking at.</strong> Every message carries the board
					on screen and whatever you have selected, so “name these” or “tidy this up” works with no
					explaining and no delay — the agent does not have to go and ask which shapes you meant.
					When something is selected, a chip above the box says what is going with your message;
					the <strong>×</strong> on it drops the selection from that one turn.
				</p>
				<p>
					<strong>It can see the board.</strong> Beyond reading positions and property values, it can
					render what is on screen — or the shapes you point it at — and look at the picture. That is
					how it answers questions about images you have put on a board, about a sketch, or about
					whether a layout lines up. It also reads your <em>selection</em>, so “name these” means the
					ones you have selected, with no need to describe them.
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

			<Section title="Choosing what it costs">
				<p>
					The composer carries two pickers: <strong>which model answers</strong>, and{' '}
					<strong>how hard it thinks</strong>. They matter more here than in a coding tool, because
					most requests to a board are a handful of tool calls rather than a problem — and Claude
					Code's own default reasoning level is set for writing code, so left alone it will spend
					longer thinking about “add a note per city” than doing it.
				</p>
				<ComposerDemo />
				<p>
					The panel therefore starts on{' '}
					<strong>{AGENT_MODELS.find((model) => model.slug === DEFAULT_MODEL_SLUG)?.name}</strong> at{' '}
					<strong>
						{AGENT_MODELS.find((model) => model.slug === DEFAULT_MODEL_SLUG)
							?.efforts.find((effort) => effort.value === DEFAULT_EFFORT)?.label}
					</strong>
					, which is enough to build and edit a board. Move up when a turn keeps going wrong; move
					down to <em>Low</em> for bulk edits you have already described exactly. Each menu row says
					what picking it means, and your choice sticks between sessions.
				</p>
				<Hint>
					Changing either mid-conversation does <em>not</em> start over. The turn you are in the
					middle of keeps its context, and the next message runs on the new setting — so reaching
					for a stronger model after a turn goes wrong does not also throw away everything you had
					just explained.
				</Hint>
				<p>
					The cheapest model has no reasoning control at all, so the second picker disappears rather
					than offering a setting that would be ignored. The model list also has a provider rail:
					only Claude has models behind it, because the panel runs Claude Code — the greyed-out
					entry beside it is saying so, not waiting to be configured. Type to filter, or press{' '}
					<Keys keys={['⌘1']} /> to <Keys keys={['⌘4']} /> to jump straight to one.
				</p>
			</Section>

			<Section title="How full the context is">
				<p>
					The ring beside the send button is the conversation's context window. It appears after the
					first turn and updates with every one after it, because that is the only moment the true
					figure is known — hover it for the token count.
				</p>
				<p>
					It matters because a full window has no error message. The model starts forgetting the
					beginning of the conversation, and answers quietly get worse. Past 90% the ring turns red;
					that is the point to start a new chat rather than the point to wonder what went wrong.
				</p>
			</Section>

			<Section title="Following a turn">
				<p>
					While the agent is working there is one line at the foot of the transcript rather than a
					running commentary: three stuttering dots, how long it has been going —{' '}
					<em>Working for 1m 4s</em> — and what it last said it was doing. Runs of tool calls
					collapse into a single <em>4 tool calls</em> row you can open.
				</p>
				<p>
					When the turn finishes, its work folds away behind <em>Worked for 1m 12s</em> and the
					reply stays where it is. That is the rule: a fold hides <em>how</em> something was done,
					never what was said. If you stopped the turn yourself it says so — <em>You stopped
					after 8s</em> — because "worked for 8s" would read as the agent having given up.
				</p>
				<Hint>
					Your own long requests collapse too, behind <strong>Show full message</strong>. A pasted
					brief is the one thing in a transcript you already know the contents of, and left whole it
					pushes the answer off the panel.
				</Hint>
			</Section>

			<Section title="Reading what it says">
				<p>
					Replies are rendered markdown — headings, lists, tables, and code blocks with a copy
					button — so a structured answer reads as one. Hovering a reply offers to copy the whole
					thing.
				</p>
				<p>
					The box you type in grows as you write, up to about a dozen lines, then scrolls — so a
					long request is visible while you compose it without the transcript disappearing behind
					it. <Keys keys={['⇧↵']} /> makes a new line; <Keys keys={['↵']} /> sends.
				</p>
				<p>
					Down the right-hand edge is a tick per question you have asked. Hover one to see the
					question, click it to jump back to that point in the conversation.
				</p>
				<p>
					Tool calls stay collapsed to a name and a result, because the board is the real output:
					you can see what happened rather than read about it. Open one when a turn goes somewhere
					you did not follow, and it shows exactly what the operation was given.
				</p>
			</Section>

			<Section title="Watching it work">
				<p>
					While a turn is running, the agent has a cursor on the board. It moves to whatever it is
					touching and says what it is doing there, and the shapes involved are ringed: green while
					it makes something, red before it removes one, violet while it reads.
				</p>
				<CursorDemo />
				<p>
					This is the difference between “shapes changed by themselves” and watching someone work —
					and it is how you catch a turn heading somewhere you did not intend, early enough to stop
					it. Turn it off in <strong>Settings → Agents</strong> if you are recording the screen.
				</p>
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
					It should not spend turns working out what it can do. “Add a text node” is one action, not
					a look followed by an action: the types a board accepts are part of the tool description
					the agent is handed, so there is nothing to check first. If you see it surveying before a
					simple request, that is a gap in the tool descriptions rather than the model being careful.
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
