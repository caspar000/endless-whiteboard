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
					The page is built from widgets, as a dashboard is. After <strong>Edit layout</strong>,
					the Library on the left holds them: drag one onto a free cell, or press + to put it in the first
					gap. Drag a widget by its grip to move it, and drag its bottom edge (or use the Inspector) to
					change its height. Select one to change it in the Inspector on the right; its arrows under{' '}
					<em>Move</em> move it a cell at a time. <strong>Print</strong> prints the page on one A5 sheet.
				</p>
				<p>
					On a narrower window the page has one panel beside it, and a switch over it picks the Library or
					the Inspector. On a phone the editing bar is along the bottom: the switch, and{' '}
					<strong>Save…</strong> (or <strong>Done</strong>). The Library or the Inspector comes up over the
					lower half of the page, and tapping a widget brings up its Inspector.
				</p>
				<p>
					What you change on a page is that page’s until you save it. <strong>Save…</strong> asks, as a
					calendar does about a repeating event: <em>Only this page</em> keeps the change on that day
					alone, and <em>This and all future pages</em> carries it to that day and every page after it,
					days changed on their own included. Earlier pages never change. Moving to another day with
					changes not saved asks the same question first, and <em>Discard changes</em> puts the page
					back as it was.
				</p>
			</Section>

			<Section title="Blocks, icon tasks and templates">
				<p>
					An <strong>icon task</strong> is a recurring task drawn as a tile you cross out: brushing teeth,
					a shower, an album. Make them in the Library’s <em>Icon tasks</em> tab and give each an icon: the picker’s{' '}
					<em>Activities</em> tab holds sport pictograms (swimming, kendo, weightlifting) and <em>Everyday</em>{' '}
					things done around the day (a toothbrush, laundry, the bins). A{' '}
					<strong>block template</strong> (MORNING, HABITS, EVENING) is a set of icon tasks with a checklist
					under them, either one optional, made once and put on any page. A block follows its template until
					you change its tasks on a page in the Inspector: from then on they are that block’s own, and{' '}
					<em>Reset to template</em> undoes it. To change a template itself, open it in the Library’s{' '}
					<em>Block templates</em> tab (or press <em>Edit template</em> in the Inspector): the change
					reaches every block that follows it at once. Deleting a template leaves its blocks as they were,
					and <em>Save as template</em> makes one from a block’s own tasks.
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
					as a backlog of albums, and draws the same one on every device. Each day’s is drawn the day before,
					and today’s widget names tomorrow’s, so its album can be downloaded the evening before.{' '}
					<em>Another one</em> draws again, never something drawn in the 30 days before or on the day after,
					or already stamped. To choose one yourself, say an album you heard apart from the draw, search the
					list in the Inspector. Liked, Disliked and Unsure are kept
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
