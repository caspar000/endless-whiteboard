import { Section, type SectionProps } from '../kit'

/**
 * Self-hosting, from the user's side. No demo: the interesting part is where a board lives, which a
 * picture of a board can't show. Command names are written out because they are the palette titles in
 * `appCommands.ts`; change them together.
 */
export function Server(_props: SectionProps) {
	return (
		<>
			<Section title="Two places a board can live">
				<p>
					Without a server, every board lives in this browser, and nowhere else. That is how Lifeboard
					works out of the box, and it keeps working that way.
				</p>
				<p>
					With your own server, boards can live there instead. A server board opens in any browser you
					log in from, and edits show up on every open copy as they happen, including its images and
					book files. New boards go to the server whenever it is reachable. Boards still on this device
					are marked with a drive icon in the sidebar.
				</p>
			</Section>

			<Section title="Moving boards">
				<p>
					The first time this browser reaches a server, the home screen offers to move your boards
					there. After that, each board card has <strong>Move to server</strong> or{' '}
					<strong>Move to this device</strong>, and so does ⌘K for the board you have open (
					<em>Move board to server</em>, <em>Move board to this device</em>). A board keeps its name,
					star, dates, tabs and preview when it moves. Its files go first, so a board never arrives
					without its pictures.
				</p>
				<p>
					Boards move one at a time. Each card shows how far its move has got, and the sidebar shows the
					whole batch. Reloading or closing the tab doesn’t lose a move: it carries on from where it
					stopped next time. If a board can’t move, its card says why and offers <strong>Retry</strong>{' '}
					or <strong>Dismiss</strong>, and the rest carry on.
				</p>
			</Section>

			<Section title="What else follows you">
				<p>
					Saved queries and the extensions you have switched off belong to the server too, so a new
					device starts with them. Theme, grid, keyboard shortcuts and the sidebar stay per device.
				</p>
			</Section>

			<Section title="Limits worth knowing">
				<p>
					Server boards need the server: offline, they don’t open. Boards on this device work offline
					as always.
				</p>
				<p>
					The server holds the only copy of its boards. Settings → Storage has{' '}
					<strong>Download server backup</strong>, which saves every server board and its files as a
					zip that imports like any backup. It reminds you after a week.
				</p>
			</Section>
		</>
	)
}
