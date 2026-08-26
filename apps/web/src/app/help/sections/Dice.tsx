import { DIE_KINDS, DieIcon, MAX_DICE_IN_HAND, toneFor } from '@lifeboard/dice'
import { Cursor, Jump, Keys, Section, useDemo, type SectionProps } from '../kit'

/* ------------------------------------------------------------ loading, then throwing */

const THROW_STEPS = [1300, 900, 900, 1100, 3000] as const

/**
 * The whole gesture: two clicks on the tray, a cursor carrying what it picked up, and the result
 * landing where it was thrown.
 *
 * Built from the app's **real** tray, cursor and readout markup rather than a drawing of them (the
 * `lb-dice-*` classes are the ones the board uses; only their positioning is neutralised for the
 * demo). The counts going up on the buttons is the part worth animating — that is the affordance
 * nobody guesses from a static picture, and the reason clicking the same die twice makes sense.
 */
function ThrowDemo() {
	const { step, ref } = useDemo(THROW_STEPS)
	const thrown = step >= 4
	// The throw spends the hand, so the tray's counts go with it — a demo whose badges survived the
	// roll would be teaching the one thing about this that is easy to get wrong.
	const d6 = thrown ? 0 : step >= 1 ? (step >= 2 ? 2 : 1) : 0
	const d20 = thrown || step < 3 ? 0 : 1
	const held = d6 + d20

	return (
		<div
			className="lb-demo lb-demo--dice"
			ref={ref}
			role="img"
			aria-label="Clicking d6 twice and d20 once in the tray, then clicking the board to roll 2d6 + 1d20"
		>
			<div className="lb-demo__scene">
				{/* The tray, as it really is: one button per die, with a count once it is holding some. */}
				<div className="lb-dice-tray" aria-hidden="true">
					{DIE_KINDS.map((kind) => {
						const count = kind === 'd6' ? d6 : kind === 'd20' ? d20 : 0
						return (
							<span
								className="lb-dice-tray__die"
								key={kind}
								data-loaded={count > 0 || undefined}
							>
								<DieIcon kind={kind} />
								{count > 0 && <span className="lb-dice-tray__count">{count}</span>}
							</span>
						)
					})}
				</div>

				{/* What the cursor is carrying, and then what it threw. */}
				{held > 0 && !thrown && (
					<div className="lb-dice-held lb-demo__diceheld" aria-hidden="true">
						{d6 > 0 && (
							<span className="lb-dice-held__die">
								<DieIcon kind="d6" size={20} />
								<span className="lb-dice-held__count">{d6}</span>
							</span>
						)}
						{d20 > 0 && (
							<span className="lb-dice-held__die">
								<DieIcon kind="d20" size={20} />
								<span className="lb-dice-held__count">{d20}</span>
							</span>
						)}
					</div>
				)}

				{thrown && (
					<div className="lb-dice-readout lb-demo__dicereadout" aria-hidden="true">
						<div className="lb-dice-readout__notation">2d6 + 1d20</div>
						<div className="lb-dice-readout__faces">
							{[
								{ kind: 'd6' as const, value: 1 },
								{ kind: 'd6' as const, value: 5 },
								{ kind: 'd20' as const, value: 20 },
							].map((face, index) => (
								<span className="lb-dice-readout__face" key={index}>
									<DieIcon
										kind={face.kind}
										size={26}
										label={String(face.value)}
										tone={toneFor(face.kind, face.value)}
									/>
								</span>
							))}
						</div>
						<div className="lb-dice-readout__total">
							<span className="lb-dice-readout__totallabel">Total</span>
							<span className="lb-dice-readout__totalvalue">26</span>
						</div>
					</div>
				)}

				{/* Up at the tray while it is picking dice up, beside the result once it has thrown them. */}
				<Cursor x={thrown ? 238 : 334} y={thrown ? 150 : 70} />
			</div>
			<div className="lb-demo__hint">
				{thrown
					? 'the result stays on the spot you threw at, then fades'
					: held > 0
						? `holding ${d6 > 0 ? `${d6}d6` : ''}${d6 > 0 && d20 > 0 ? ' + ' : ''}${d20 > 0 ? `${d20}d20` : ''} — click the board to roll`
						: 'click a die to pick one up, click again for another'}
			</div>
		</div>
	)
}

export function Dice({ go }: SectionProps) {
	return (
		<>
			<Section title="A tray, and a handful of dice">
				<p>
					The tray sits down the right-hand edge of the board, with one button per die:{' '}
					{DIE_KINDS.join(', ')}. Click one to pick it up and click again for another, so{' '}
					<strong>d6, d6, d12</strong> is <strong>2d6 + 1d12</strong>. The count appears on the
					button, and the cursor carries what you are holding — you can always see what you are
					about to throw before you throw it.
				</p>
				<ThrowDemo />
				<p>
					Then click anywhere on the board. Real polyhedra tumble across the paper and come to rest
					where you threw them — measured in the board's own units, so they land at the spot you
					clicked, scale when you zoom and stay put when you pan. The result appears above them once
					they stop, and both fade a moment later. One hand holds up to {MAX_DICE_IN_HAND} dice.
				</p>
				<p>
					If you have asked your system to reduce motion, the dice skip the tumble and are simply
					there, already settled. That costs you nothing: the numbers are decided before the roll is
					ever drawn, so the outcome is identical either way — see below.
				</p>
			</Section>

			<Section title="Reading the result">
				<p>
					Each die is shown as its own shape with what it rolled inside, so a result reads as “a d20
					that came up 17” rather than as a row of numbers. The colour is a{' '}
					<strong>ramp from the lowest face to the highest</strong>: on a d20, a 1 is fully red, a 20
					is fully blue, and the further from the middle a roll lands the stronger the colour gets —
					so a 19 is unmistakably good and an 11 looks like the ordinary number it is.
				</p>
				<p>
					It is read off the die, never off the number. A 6 is the top of a d6 and shows fully blue;
					the same 6 on a d20 is a poor roll and shows red.
				</p>
				<p>
					The dice themselves say it too: once they stop, the face that landed on top is inked in the
					same colour, so the result is the one number on the die that is not black. From straight
					above you can see the top face and the ring of faces around it, all legible, and that
					colour is what tells them apart. It arrives only when the dice settle — a tinted face
					mid-tumble would give the answer away before it landed.
				</p>
			</Section>

			<Section title="Putting them back">
				<p>
					<strong>Right-click a die in the tray</strong> to put one back, or shift-click it.
					Right-clicking the <em>board</em> puts the whole hand down, and so does{' '}
					<Keys keys={['Esc']} />. While your hand is full, right-click means “put these down”, so
					the board's own context menu waits its turn — with an empty hand it behaves exactly as it
					always did.
				</p>
				<p>
					Everything else about the board keeps working while you are holding dice. You can pan,
					zoom and scroll to line up the throw; the only gesture that changes is the click itself.
				</p>
			</Section>

			<Section title="A roll is a moment, not a record">
				<p>
					By default, rolling writes <em>nothing</em> to the board. No shape is created, nothing is
					selected, and the undo stack is untouched — the board you had before the roll is the board
					you have after it. A roll is something that happened, not something you now have to tidy
					up.
				</p>
				<p>
					It also means dice cost you nothing to leave switched on. Turning the extension off in{' '}
					<strong>Settings → Extensions</strong> takes the tray and its commands away and leaves
					nothing behind, because there was never anything to leave.
				</p>
			</Section>

			<Section title="Keeping score">
				<p>
					Switch <strong>Keep results</strong> on in{' '}
					<strong>Settings → Extensions → Dice</strong> and each roll lands as a card instead of
					fading: the notation, every face, the modifier and the total, placed on the dice once they
					stop. One <Keys keys={['⌘Z']} /> takes the whole thing back.
				</p>
				<p>
					Because the card is a real node, its total is a <Jump to="properties" go={go}>property</Jump> —
					so a <Jump to="tables" go={go}>table</Jump> can count your rolls, total them, or show the
					biggest one, exactly as it would for any other card on the board. That is the reason to
					keep a roll at all; anything less and the fading readout was already enough.
				</p>
			</Section>

			<Section title="Fair dice">
				<p>
					Every face comes from the browser's cryptographic random source, and it is{' '}
					<em>sampled</em> rather than taken modulo the number of faces. The obvious way of writing
					this is quietly biased: 256 does not divide by 20, so on a d20 the low sixteen faces
					would come up about 7% more often than the top four. Draws that fall in the short tail
					are discarded and redrawn instead, which makes every face exactly equally likely.
				</p>
				<p>
					The number is drawn <strong>before</strong> the dice are thrown, and the die is then
					renumbered so the face it lands on carries it. That sounds like a cheat and is the
					opposite of one: it means the odds are the random source's rather than whatever a physics
					engine happens to favour, and it is why a die that comes to rest leaning on another is
					quietly re-thrown instead of being read at an angle.
				</p>
			</Section>

			<Section title="From the palette, and from the agent">
				<p>
					<Jump to="shortcuts" go={go}>
						⌘K
					</Jump>{' '}
					offers <strong>Load a d20</strong> and the rest, plus <strong>Roll the dice in hand</strong>{' '}
					— which throws into the middle of the view, since there is no pointer behind a command.
					Both only appear when they mean something: there is no “roll” to offer with an empty hand.
				</p>
				<p>
					You can also type the whole thing:{' '}
					<strong>&gt; roll 2d20 + 10</strong>, or{' '}
					<strong>&gt; roll 1d6 + 2d4 + 1d20 + 4</strong>. That throws immediately into the middle of
					the view rather than loading anything — if you have typed the expression you have already
					decided. It is the only way to add a <strong>flat modifier</strong>, which a shelf of dice
					has no way to express; the bonus is shown as its own term beside the faces, so a total of 27
					from two d20 is checkable rather than baffling.
				</p>
				<p>
					The <Jump to="agent" go={go}>agent</Jump> can roll too. Ask it for “2d6 + 1d12” and it
					throws them on the board you are looking at rather than making a number up, so you watch
					the same roll it reads.
				</p>
			</Section>
		</>
	)
}
