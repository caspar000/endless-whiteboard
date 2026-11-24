import { Section, type SectionProps } from '../kit'

/**
 * The daily page (DARK-17), from the user's side. No demo: it is a screen of its own, one click away in
 * the sidebar. Command names are the palette titles in `appCommands.ts`; change them together.
 */
export function Daily(_props: SectionProps) {
	return (
		<>
			<Section title="A page a day">
				<p>
					<strong>Daily</strong> in the sidebar (or ⌘K → <em>Open today’s daily page</em>) opens today’s
					page in a tab of its own, beside the boards': an A5 sheet with the week running across the top. The arrows and <strong>Today</strong>{' '}
					move between days, and each day in the week strip shows its focus and how much of it is done.
					Every day has its own page, kept in your vault, so it follows you to every device.
				</p>
				<p>
					The page is built from widgets, as a dashboard is. While <strong>Editing layout</strong> is on,
					the Library on the left holds them: drag one onto a free cell, or press + to put it in the first
					gap. Drag a widget by its grip to move it, and drag its bottom edge (or use the Inspector) to
					change its height. Select one to change it in the Inspector on the right. <strong>Done</strong>{' '}
					puts the editor away, and <strong>Print</strong> prints the page on one A5 sheet. A change to the
					layout applies from the day you make it on; earlier days keep theirs.
				</p>
			</Section>

			<Section title="Blocks, icon tasks and templates">
				<p>
					An <strong>icon task</strong> is a recurring task drawn as a tile you cross out: brushing teeth,
					a shower, an album. Make them in the Library’s <em>Icon tasks</em> tab and give each an icon. A{' '}
					<strong>block template</strong> (MORNING, HABITS, EVENING) is a set of icon tasks with a checklist
					under them, either one optional, made once and put on any page. Changing a template changes every
					page that uses it; Detach in the Inspector makes a copy for one block alone.
				</p>
				<p>
					A block’s icons sit on a grid that fills the room its checklist leaves, and grow or shrink with
					the block. Set its rows and columns in the Inspector (2 × 4, 1 × 4, 2 × 2), or leave them on Auto
					for the largest tiles that fit. Turn off <em>Show the heading</em> to fit a row of icons into a
					single row of the page.
				</p>
				<p>
					The <strong>Tasks</strong> widget is the day’s own checklist. What you leave unticked shows on the
					next page, marked with the day it was first written; turn that off in the page settings.
				</p>
			</Section>

			<Section title="Cycles and the focus of the day">
				<p>
					The <strong>areas</strong> you rotate through (Music, Game dev, Art…) and the{' '}
					<strong>cycles</strong> made of them (W1: Music &amp; Game dev) are your own: change them in the
					Inspector’s page settings, with no widget selected. Pick each week’s cycle by hand from the week
					strip; it never moves on by itself. A week’s days take its areas in turn, unless its evenings
					were planned in the review, and the page header changes one day’s focus.{' '}
					<strong>Focus of the day</strong> shows that area’s tasks, the ones every day of it has and the
					day’s own.
				</p>
			</Section>

			<Section title="Physical, and the daily pick">
				<p>
					<strong>Physical</strong> holds icon tasks, the numbers you track (weight, pages read, any you
					add, each optional), what kind of fast the day was, and a food log: take or choose a photo and
					it is kept with the time it was taken, shrunk to a size that is quick to load. Tap a photo to see it
					full size.
				</p>
				<p>
					The <strong>daily pick</strong> draws one thing a day from any list a randomizer could use, such
					as a backlog of albums, and draws the same one on every device. <em>Another one</em> draws again,
					never something drawn in the last 30 days or already stamped. <em>Search</em> looks through the
					list for one you choose yourself, say an album you heard apart from the draw. Liked, Disliked and Unsure are kept
					on the page, and filed on the board you choose to save to, as a randomizer’s stamps there are, so
					its rankings and randomizers count them. Choosing a list that belongs to a board saves to that
					board. Write a one-line impression under it, and the review gathers them.
				</p>
			</Section>

			<Section title="The weekly review">
				<p>
					On the review day (Sunday unless you change it), the week strip’s last cell opens the{' '}
					<strong>weekly review</strong>, an A4 page built from widgets the same way (⌘K →{' '}
					<em>Open the weekly review</em>). It plans first: next week’s cycle, and what each evening goes to
					(click an evening to change it). Then it gathers the week from the daily pages: a habit grid
					whose rows you choose, each with a target and a total, the week’s numbers against the week
					before, how the evenings were shared between areas, your log lists, creative progress per area,
					your own reflection questions and the week’s picks with their impressions.
				</p>
			</Section>
		</>
	)
}
