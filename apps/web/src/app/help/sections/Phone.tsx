import { Section, type SectionProps } from '../kit'

/**
 * The phone layout (docs/mobile-plan.md), from the user's side. No demo: what matters is what a tap
 * does, which a picture of the chrome can't show. Kept in step with canvas/PhoneDock.tsx and
 * canvas/phoneMode.ts.
 */
export function Phone(_props: SectionProps) {
	return (
		<>
			<Section title="Looking around without changing anything">
				<p>
					On a phone, a board opens in <strong>Hand</strong>. Dragging moves you around the board and
					pinching zooms; nothing on it moves, however a thumb lands. Links still open. A double tap on a
					book opens it to read, and on any other shape opens it in Quick look, filling the screen;
					tap beside it to close. A double tap on empty board zooms in.
				</p>
				<p>
					To change the board, tap the hand at the left of the dock. It becomes the arrow,{' '}
					<strong>Select</strong>, and tapping a shape selects it. Tap the arrow to go back to Hand. A
					long press on a shape is the quick way in: it switches to Select, selects the shape and opens
					its menu.
				</p>
				<p>
					Placing a sticky, a shape or some text puts you back where you were once you are done with it:
					in Hand, unless you had chosen Select.
				</p>
			</Section>

			<Section title="The dock">
				<p>
					Hand or Select, Sticky, Pen, Shapes, Text and More. A button with a small triangle in its corner
					switches its kind when tapped again: the sticky to a pinned note, the pen to the eraser, the
					shapes from one to the next. <strong>More</strong> holds the rest: frames, relations, images, the
					node picker, the two ways of looking at relations, comments and the dice. Once you pick a tool
					from it, the More button shows that tool.
				</p>
				<p>
					With something selected, its toolbar sits just above the dock, in reach of your thumb, rather
					than over what you selected.
				</p>
			</Section>

			<Section title="Getting around the app">
				<p>
					The board’s name at the top lists the boards you have open: tap one to switch, the pencil to
					rename it, × to close it, or start a new one. The button at the top left opens the menu, with
					every board, Settings and Help, and a search button that does what ⌘K does on a computer. The
					button at the top right opens the agent. Under All boards, the ⋯ on a card holds its actions:
					star, rename, share, move and delete.
				</p>
			</Section>
		</>
	)
}
