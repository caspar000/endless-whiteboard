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

			<Section title="People, vaults and sharing">
				<p>
					A server can hold more than one person. Each account is in a <strong>vault</strong>: its own,
					or one it was invited into. Everyone in a vault sees and edits all of its boards, like a shared
					drive.
				</p>
				<p>
					New accounts come from <strong>invite links</strong>, made in Settings → Account: one into your
					vault, or, for the server’s owner, one with a vault of its own. A link works once, for a week.
				</p>
				<p>
					To share a single board with someone outside your vault, use <strong>Share</strong> on its card
					or <em>Share this board…</em> in ⌘K. A view-only link lets them follow the board as it changes;
					an edit link lets them change it too. They open the link while logged in, and the board joins
					their list, marked with your vault’s name. Withdraw the link, or remove them in the same dialog,
					and it leaves them again. A board shared with you can be removed from your list, but not renamed,
					moved or deleted.
				</p>
				<p>
					Logging out (Settings → Account) also clears the boards kept on that device for offline use.
				</p>
			</Section>

			<Section title="Working together">
				<p>
					On a server board, everyone who has it open sees the others: a cursor with their name, and what
					they have selected. A shape’s <strong>…</strong> menu says who added it and who changed it last.
				</p>
				<p>
					<strong>Comments</strong> are for talking about the board on the board. Press <kbd className="lb-kbd">C</kbd>{' '}
					and click: on a shape, the thread is pinned to it and follows it; anywhere else, it stays where
					you put it. Reply in the thread, and <strong>Resolve</strong> it when it’s settled (anyone can
					reopen it). You can edit or delete what you wrote, not what others wrote. The comments button in
					the dock, or <kbd className="lb-kbd">⇧C</kbd>, lists every thread, open or resolved. Someone a
					board is shared with to view can comment too. Comments aren’t undo steps, and they come along in
					backups.
				</p>
			</Section>

			<Section title="What else follows you">
				<p>
					Saved queries and the extensions you have switched off belong to your vault, so a new device
					starts with them, and so does everyone else in it. Theme, grid, keyboard shortcuts and the sidebar stay per device.
				</p>
			</Section>

			<Section title="Limits worth knowing">
				<p>
					Server boards work offline once they have been opened on a device: each is kept in the
					browser and opens from there, as you last saw it. What you change offline is kept there too,
					through reloads, and goes up to the server when it’s back; the corner of the board says how
					many changes are waiting. Someone else’s changes to the same shape meet yours field by
					field, and the last one to reach the server wins where both changed the same thing.
				</p>
				<p>
					Offline, new boards start on this device (move them to the server later), and boards you
					have never opened here wait for the server.
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
