# Zettelkasten — implementation plan

Status: **Agreed, not started.** Settled with the user over two rounds of questions on PLAN-35
(2026-10-26); the parent issue, PLAN-34, has the mockups. Each phase below gets its "as built" notes
here when it ships, the way `dice-plan.md` and `skill-tree-plan.md` do.

A box of index cards, the way Luhmann kept one, rather than a folder of documents. You don't file a
note under a title: you write it and decide which card it goes behind, and it gets an address from
where it went (25, 25a, 25a1, 25b, 26). Reading the box later means flipping through cards in that
order. Links between cards exist, as in Obsidian, but they come second: the order of the box is the
physical fact and everything else is drawn on top of it.

A box is an **index**, then the **notes** in order, then the **citations**. It has four views:

| View | What you see |
|---|---|
| **Stack** (opens first) | The front card, with the next two peeking out behind it. Scroll, swipe or arrow keys flip one card. |
| **Table** | Every card laid out on the table: a column per top-level note, its line running down the column. |
| **Chain** | One path through the box: a note and what follows it, with the cards it links to blurred beside it. Click one to turn down that path. |
| **Graph** | Notes as labelled dots, joined by their order and by their links. |

## What was decided

| # | Question | Decision |
|---|---|---|
| Q1 | Where a box lives | **A box is a board.** Each note is a shape on it. |
| Q2 | Note ids | **Folgezettel**: given from where the note is placed, never changed. |
| Q3 | Titles | Optional. The id always shows; the title under it if there is one. |
| Q4 | What a note holds | **The sticky note's rich text** (bold, italics, lists, `{…}`), on a card of our own design. Not markdown. Fixed card size; longer text scrolls inside it. |
| Q5 | The chips in a card's footer | Three kinds: **note links**, **index keywords**, **citations**. Clicking one goes to it. |
| Q6 | The index | Luhmann's: a keyword chip on a note files that note under the keyword. The index lists keywords A–Z with their entry notes, and is the front of the box. |
| Q7 | Citations | Cards with fields (author, title, year, a free note), ids `c1`, `c2`…, after the last note. |
| Q8 | The flip | **Rolodex**: the front card tips back over the top and drops behind. About 180 ms, interruptible; a fast scroll riffles. Type an id to jump. Reduced motion cuts. |
| Q9 | Folders, inbox | Neither. Placing a note when you write it is the point. |
| Q10 | How many boxes | As many as you like. |
| Q11 | Placing a note | **N** new note behind the front card, **⇧N** branch, and *New train of thought*. Rules below. |
| Q12 | Moving, deleting | No moving. Deleting asks first; the id is never reused and the note's branches stay, leaving a gap. |
| Q13 | Making a link | Type `[[` in the text, or **+** in the footer. Not by drawing arrows. |
| Q14 | Link direction | One way. The footer also shows a dim "Linked from 26a, 31". |
| Q15 | Strictness | A box holds only its cards, which the box places. No dock, no dragging, no drawing. Zoom, pan and Quick Look still work. |
| Q16 | Table layout | A column per top-level note, its line in reading order down it, deeper branches stepped right. |
| Q17 | Chain view | As described in *The four views* below. |
| Q18 | Graph view | Dots with labels, force layout, solid lines for order and dashed for links (each toggleable). |
| Q19 | Editing, phone | Type into the front card in the stack, or double-click a card elsewhere. All four views work on a phone. |
| Q20 | Order of work | Stack and placing notes, table, chain, graph; then the agent, *Cite in box* from Books, and notes on ordinary boards. |

---

## The model

### Ids

An id is a run of segments that alternate between numbers and letters, starting with a number:
`25`, `25a`, `25a1`, `25a1a`. Letters count in bijective base 26 (`a`…`z`, `aa`, `ab`…), so a note can
have any number of branches. Citations are `c1`, `c2`… and are a separate series.

**Order.** Compare segment by segment. A number segment compares numerically, a letter segment by
length and then alphabetically. When one id is a prefix of the other, the shorter comes first. So:

```
25  <  25a  <  25a1  <  25a2  <  25b  <  26  <  …  <  c1  <  c2
```

This order *is* the box. Nothing else is stored to say where a note sits, so two devices can never
disagree about the order once they agree on the ids.

**Placing.** With note X at the front:

- **New note behind X** (N). If X has no next sibling, the new note continues X's line: `25a` → `25b`.
  If the next sibling is taken (`25b` exists), it branches off X instead, taking X's next free branch
  (`25a1`, or `25a3` if `25a1` and `25a2` exist), and so lands after X's other branches.
- **Branch from X** (⇧N). Always X's next free branch, even when the line could be continued.
- **New train of thought.** The next free top-level number, which lands before the citations.

"Free" skips retired ids (see deleting). The new card appears where it belongs, ready to type into.

**Deleting** asks first, removes the card, and adds its id to the box's retired list so it is never
given out again. Branches of a deleted note stay where they are. Where a retired id still has
branches, the stack and the table show a thin empty slot labelled with the id, the way a gap shows
in a drawer when a card is pulled.

**Two devices at once.** Both can press N behind 25a while offline and both make a `25b`. When the
board syncs, the one with the later shape id is renumbered to the next free id, the same answer on
every device because it depends only on the shape ids. This is the only case where an id changes,
and it can only happen to a note seconds or hours old. A toast says so.

### Records

All of it lives on the box's board, so sync, offline use, undo, backups and moving a board to the
server all work without new machinery (Q1).

- **The box marker** is the document record's `meta['lifeboard:box']`: `{ version, retired: string[] }`.
  It travels with the board's content. Making a box also sets the board's icon to Tabler's
  `cards` so tab, sidebar row and card read as a box; the board index and the
  server's `boards` table don't change.
- **`node.zettel`**: one note.
  `{ zid, title, richText, keywords: string[], links: string[], cites: string[], w, h }`.
  `links` holds what was added with the footer's **+**; links typed inline live in `richText` as an
  inline node (below). The chips show both.
- **`node.zettelSource`**: one citation. `{ zid, author, title, year, note }`.
- **`node.zettelIndex`**: the front of the box. One per box, and like the table node it **draws
  derived content**: keyword → entry notes, computed from the cards, never stored. It exists as a
  shape so the table view can show it as the first column.

The card types register through `@lifeboard/schema`, so the server learns them first. A deploy that
carries them must reach the server before any client makes a box (see `docs/deploying.md`).

### Links in the text

A TipTap inline node, `zettelLink { target: '25a' }`, drawn as the `📄 25a` chip. Typing `[[` opens a
picker over the box's cards (by id or title); choosing one inserts the node. The extension is added
to the editor's `textOptions.tipTapConfig`, which is editor-wide, so the `[[` trigger checks that the
shape being edited is a `node.zettel` and does nothing anywhere else. `richTextToPlainText` and the
SVG export must know the node, or a link drops out of search and exports: teach both, and test it.

Backlinks ("Linked from …") and the index are computed from one per-board map of every card's
outgoing links and keywords, rebuilt from the changed cards only, the way `getPageFacts` is.

---

## The four views

Opening a box shows the stack. The box's bar, which takes the dock's place, holds the view switcher
(Stack · Table · Chain · Graph), New note, Branch, New train of thought, and a field to jump by id.
On a phone the bar sits where the phone dock is.

### Stack

A full-screen surface over the board, like the book reader's (`BookReaderOverlay` portals over the
canvas): the front card, and the next two cards' top edges stepping up behind it, as in the mockup.

- **Flip**: wheel, trackpad, ↑/↓ or a vertical swipe. The front card tips back about its top edge
  and drops behind the stack in about 180 ms (CSS 3D transform, `transform`/`opacity` only). A new
  flip during one finishes the old one at once, so a fast scroll chains them into a riffle. One wheel
  "notch" is one card; trackpad deltas accumulate to a threshold so a flick doesn't fly past twenty
  cards.
- **Jump**: start typing an id (`25a`) and Enter goes there, flipping through quickly if it's close
  and cutting if it's far.
- **Edit**: click into the card's text. The surface mounts a TipTap editor with the board's own
  `tipTapConfig` and writes back through `editor.updateShapes`, one undo step per editing session.
  **This is the riskiest part of the plan and is proved first** (phase 1): the alternative, if a
  standalone editor can't be made to match the canvas's, is to hide the surface while editing and
  edit the real shape zoomed to fill the screen.
- **Footer**: the chips, the **+**, and the dim "Linked from" line.
- **Keys** are the surface's own (README, *A full-screen surface binds its own keys*), listed on the
  Help page by hand: ↑/↓ flip, N, ⇧N, ⌫ delete (asks), Esc leaves the text.

### Table

The canvas itself, with the cards as real shapes. Their positions are the **table layout**, written
by the box: the index column first, then a column per top-level note; down each column that note's
line in reading order, a branch stepped right by a fixed indent per level. The layout is a pure
function of the ids, so every device computes the same positions, and it is rewritten in one
`transact` only when a card is added or deleted. Citations are the last column.

The card util refuses to be moved or resized. Double-click edits, as on a sticky. Zoom, pan, ⌘K's `@`
find, and Quick Look (Space) work as on any board.

### Chain

A full-screen surface, like the stack. You start it from a card ("Follow from here", in any view).

- The **middle column** is the path being read: the start note, then the notes that follow it on its
  line, in order.
- At each card's height, the **right-hand column** shows the cards it links to, blurred.
- Clicking a blurred card **turns the path**: that card slides into the middle column and the path
  continues from it.
- A **trail** of ids along the top (`25 › 25a › 31 › 31a`) steps back.

Double-click edits, through the same editor as the stack.

### Graph

A full-screen surface with its own pan and zoom, drawn on a 2D `<canvas>` so a few thousand dots stay
cheap. Layout from `d3-force` (ISC, small), in a chunk loaded the first time the graph opens, settling
in under a second each time. Lines: **order** (a note to the one before it on its line) solid,
**links** dashed, each with a toggle; keyword and citation cards are off by default, with a toggle.
Labels (`25a We Live in a Society…`) show past a zoom level. Hover lights a note and its neighbours;
click opens the stack at that note; Space shows the card over the graph.

### Why the chain and the graph aren't the canvas

Round 1 said the table, chain and graph views would all be the canvas. Only the table is. A shape's
position is board data: it syncs to every device and goes in the undo history. If switching to the
graph moved the cards, two devices looking at the same box in different views would keep moving each
other's cards, and every switch would send a few thousand records to the server. The table layout
doesn't have that problem because it never changes with the view, only with the ids. So the chain
and the graph draw their own layout and leave the shapes where they are. What's lost is small: they
have their own pan and zoom instead of the canvas's, and ⌘K's `@` finds cards in the table, not in
the graph.

---

## The seam: board kinds

Nothing today lets an extension change what a *board* is: it can add shapes, commands and overlays,
but the dock, the new-board button and the board's behaviour belong to the app. A box needs all
three. As with the dice tray's `CanvasOverlay`, the fix is a new optional field on `Extension`, so
existing extensions keep compiling and a future plugin gets the same door:

```ts
export interface BoardKind {
  /** Namespaced like an extension id: `zettelkasten.box`. */
  id: string
  /** Shown in the new-board menu and ⌘K: "New box". */
  label: string
  icon: NodeToolbarIcon
  /** Whether an open board is one of these. Reads the document record; must be cheap. */
  isKind(editor: Editor): boolean
  /** Writes what makes a fresh board one of these (the box marker, the index card). */
  create(editor: Editor): void
  /** Replaces the dock while a board of this kind is open. No props, like an overlay. */
  Dock: ComponentType
  /** Shape types a board of this kind may hold. Anything else is refused. */
  allowedShapes: readonly string[]
}
```

The app's side: `CanvasToolbar` renders the kind's `Dock` instead of its own; the new-board button
gets a menu with each enabled kind; tool keys and tool commands are unavailable on such a board (their
`when` checks it); a clipboard hook stops pastes of other shapes; and a before-create side effect
drops any other shape that still arrives (an agent, a drop), so the rule holds whichever door a shape
came through. The full-screen surfaces are ordinary components the box's dock opens, portalled over
the board as the reader's are.

Switching the extension off follows the usual rule: boxes keep opening and their cards keep
rendering, on an ordinary board, with the ordinary dock.

---

## Phases

Each phase is committed on its own branch off `develop`, checked in the browser, and gets its "as
built" notes here.

**Phase 0: the seam.** `BoardKind` in node-kit, the app's side of it, and tests that a kind's
`allowedShapes` holds for the dock, paste, and an agent's `shape.create`. No visible change until a
kind is registered.

**Phase 1: a box, its cards, the stack.** The `@lifeboard/zettelkasten` package; *New box*; ids and
their order (unit-tested hard: parsing, comparing, next-free with retired ids, the duplicate rule);
`node.zettel` with the card design; the stack with the flip, jump, N / ⇧N / new train of thought,
editing, and delete. The standalone editor question is answered first.

**Phase 2: the table view.** The layout function (tested as a pure function), writing it on add and
delete, the locked cards, the view switcher.

**Phase 3: chips.** Links (`[[` and **+**), backlinks, keywords and the index card, citations and
their cards. Search and export see inline links.

**Phase 4: the chain view.**

**Phase 5: the graph view.**

**Phase 6: the agent.** Operations (which are MCP tools too): read a box in order, read a card, place
a note behind an id or as a branch, link, file under a keyword, cite. "File this as a note behind
25a" in the agent panel.

**Phase 7: *Cite in box*** on a book or a quote card (Books extension): pick a box, and a citation is
made from the book's author, title and year, or the existing one is reused.

**Phase 8: a note on an ordinary board.** A live card on any board that shows a box's note and edits
it in place. Needs a cross-board read like the syllabus's vault items have; its design is the first
thing that phase decides.

Every phase that adds something the user can do goes through `.claude/skills/extension-surfaces`:
⌘K, the Help page (a *Zettelkasten* section, and the stack's keys in Shortcuts), the README's
extension table and `Layout`.

## Not doing

- **Markdown cards.** The user prefers the sticky note's text for now (Q4). The card's text is rich
  text, so a later switch would need a conversion.
- **Folders, an inbox, templates.** They were the Obsidian frame the mockups were drawn in (Q9).
- **Moving a note.** Its id is its place (Q12).
- **Links drawn as arrows on the canvas.** The box lays the cards out; hand-drawn arrows would fight it
  (Q13).
- **Import from Obsidian, export of a box.** Not wanted for now (Q20 d).
