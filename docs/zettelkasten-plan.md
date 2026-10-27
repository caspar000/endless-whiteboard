# Zettelkasten — implementation plan

Status: **Phases 0 and 1 built** (2026-10-26). Settled with the user over two rounds of questions on
PLAN-35; the parent issue, PLAN-34, has the mockups. Each phase gets its "as built" notes here when it
ships, the way `dice-plan.md` and `skill-tree-plan.md` do.

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

## Phases 0 and 1, as built (2026-10-26)

- **The seam** is `BoardKind` in node-kit (`boardKinds.ts`), as sketched below, plus a `name`, and a
  `newName` and `boardIcon` for the board a kind starts as. The app: `CanvasToolbar` draws the kind's `Dock` on a
  phone too; *New box* is on the home screen and in ⌘K (`registerBoardKindCommands`); a new board's
  kind waits in `boards/pendingKind.ts` until its first open hands `create` an editor; and
  `holdBoardToKind` keeps the rules. Two things the sketch didn't have: other extensions' overlays (the
  dice tray) are off on a board of a kind, and the rules hold only this device's own changes, so an
  older build's shapes arriving from another device aren't deleted behind its back. Tests:
  `boardKinds.test.ts`.
- **Two new `NodeDefinition` fields.** `offered: false` keeps a type out of the dock's picker, the
  generated "Add …" command, the context menu and the agent's `node.create`: a card only exists at a
  place in its box. `resizable: false` takes the handles off. The card is also `pinned`.
- **No title prop.** A note's title is its first line when that line is a heading (`# ` in the text),
  which keeps one editor per card. The sticky note's editor focuses an input field back whenever it
  blurs, so a separate title field beside it could never keep the caret. Labels, ⌘K's `@` and later
  the graph use the title, or else the first line (`card/text.ts`).
- **The card's props are `zid` and `richText` for now.** `keywords`, `links` and `cites` arrive in
  phase 3 with a migration, rather than sitting unused until then.
- **The table layout came forward from phase 2.** Cards need somewhere to stand from the first note,
  so `tableLayout` (pure, tested) runs on every write and delete, and *Table* shows it, framed. Phase 2
  still owns the index column and the view switcher's other two views.
- **The stack's keys.** While it is open the editor counts a menu as open (`addOpenMenu`), which is
  what silences every board key under it at once: tool letters, the dock's digits, Backspace deleting
  the selection, tldraw's own. The stack then binds its own in a capture-phase `window` listener, only
  for the board on screen (a background tab keeps its editor). ⌘Z and ⇧⌘Z are among them, since the
  app's undo is a board command and is silenced with the rest.
- **Editing in the stack** is the sticky note's own `RichText` (now exported from `@lifeboard/canvas`),
  mounted on the front card while the shape is in tldraw's editing state. Only one place may draw a
  card's text live, or two TipTap editors would fight over one note, so the canvas draws it static
  while the stack is open. The editor starts with all its text selected (right for a label, a way to
  lose a paragraph on a note), so `placeCaret` puts the caret where the card was clicked, or at the end.
- **Undo.** Writing, deleting and each editing session are one ⌘Z each. The board's history undoes
  shape commands and not the document record, so undoing a delete brings the card back but leaves its
  number on the retired list. That errs the safe way: the number is in use again and still never
  given to a different note.
- **The table's own ways of deleting and copying.** The selection toolbar's delete and ⌫ retire the
  number as the stack's delete does, and the cards close up; ⌘Z taking back a note just written is a
  delete too, so the retiring waits a microtask and is dropped if undo or redo announced itself
  meanwhile. A duplicate, or a paste of a card whose number is taken, is taken off as it arrives: a
  copy has no place of its own (`watch.ts`).
- **`{…}` expressions** can be typed (the editor is the sticky note's) but a card draws them as typed
  rather than evaluated. Stickies get their evaluation from the app's own shape utils; a node type
  would need the same seam. Not asked for, so left.
- **Checked in a browser** (Playwright against the dev server, desktop and a phone-sized dark run):
  New box, the first note, N and ⇧N giving 1 → 2 → 3, 1a, then 1b behind 1; the flip, wheel, swipe,
  jump by number and "no such note"; delete with its confirmation, and its undo; a duplicate `2` merged
  in as from another device, renumbered to `4` with the notice; double-click editing on the table;
  dragging a card leaving it in place; a sticky made on a box taken off again; a tool key put back to
  Select.

### The card's look and the flip, reworked (2026-10-26)

After seeing pictures of phase 1, the user asked for a 5 × 8 index card, the note card's own font, the
board's design, and a flip that isn't flaky.

- **5 × 8.** `CARD_W` 560, `CARD_H` 350 (`layout.ts`), and the stack and the Help demo hold 8 : 5.
- **The sticky note's paper.** A card is drawn as a white sticky is (`canvas/shapes/note/paper.ts`):
  the canvas theme's `white.noteFill` and `black.solid` (the `--lb-zcard-*` tokens repeat them, so the
  Help page, which has no editor, draws the same paper), square corners, the sticky's hairline edge and
  its own shadow element (`tl-note__shadow`). The handwritten face (`--tl-font-draw`) at a label's size
  and leading: 22 px on a 560 px card, measured in `cqw` of the card's frame so it scales with the card.
  The card on the table now draws outside its box like a sticky does, for the shadow: a new
  `NodeDefinition.clip: false`.
- **The board's paper behind the stack**: the canvas colour and its dots, not a flat grey.
- **The flip.** Frame-by-frame captures (the animation slowed tenfold) showed what was flaky. The pile
  was one 3D space, and in one the browser stacks by depth, not z-index: a card swinging back through
  the pile was drawn behind the card it was passing, with the sticky's shadow showing through. Each
  card now carries its own `perspective()`, and every slot spells out the same list of transform
  functions so each interpolates cleanly. The swinging card no longer fades; it is gone by itself once
  its back is turned (`backface-visibility`). And a fast riffle used to take a card that had just flipped
  off the page mid-swing: the stack now keeps four cards either side mounted, held at the edge slots,
  in box order so none is ever moved in the document (moving one restarts its transition).
- **Smaller things the pictures showed:** a card being written on wears the selection blue; the
  canvas's formatting bar, placed over the card's spot on the canvas under the stack, is hidden while
  the stack is up (⌘B and the rest still work); on a phone the pile sits higher and the count gives
  way to the board pill.

### The flip, the pile, the type (2026-10-27)

The second round of pictures brought five asks: a different flip, justified text, type that shrinks
instead of scrolling, the id out of the way, and a deeper pile.

- **The flip** is the user's sketch: the front card swings round a pivot just off its top right corner,
  up and over to the right, fading as it goes (440 ms, at an even pace); going back plays it in
  reverse and lands like the pile's own moves (380 ms, quick then settling). It turns in the page's
  plane, so there is no 3D at all and nothing for the browser to depth-sort. Each slot's transform is
  one list, `translateY scale translate(pivot) rotate translate(−pivot)`, so the rotation interpolates
  as an arc round the pivot. With the longer swing the stack keeps eight flipped cards mounted, so a
  riffle never takes one off mid-swing.
- **The pile** follows a bounded exponential (`stack/pile.ts`): card k behind the front sits
  `0.4 · (1 − 0.68^k)` of a card's height above it, narrows and darkens the same way. Eight cards show,
  each strip a third smaller than the one before; the first two strips carry their numbers, the rest
  are too thin for one. The slot geometry is computed and set inline, and the Help demo uses the same
  function.
- **Justified text**, with hyphenation; a title stays left.
- **Shrink to fit** (`card/fit.ts`): a note longer than its card is set smaller, down to half size,
  until it fits; only past that does it scroll. A first guess from the overflow ratio, then a few
  halvings, run between layouts (so a card is never painted at a size it doesn't keep), again whenever
  the text or the card's width changes, and once the handwriting face has loaded. The same on the table.
- **The id** is small in the card's top-left corner, out of the text's way; the text starts higher.

### Phase 3, as built (2026-10-27): links, keywords, the index, sources

- **Links are plain text, not a TipTap node.** `[[25a]]` is written into the note as typed, the way
  `{…}` expressions are. The plan's inline node would have been a schema addition: search, plain-text
  export and copy would each have needed teaching, and a board with the extension off would lose the
  links from its text. As text they cost nothing anywhere. While a card is written on, a tint marks
  each finished link; otherwise the card draws its own text (not through `RichText`) and turns each
  link into a chip that goes to the note, struck through when the number isn't in the box. A link can
  point at a source too (`[[c1]]`).
- **`[[`** opens a menu of the box's notes and sources, by number first, then by words, using
  node-kit's `{…}` menu. It reaches the board's text editors through a new seam,
  `Extension.textExtensions` (node-kit), which `Board.tsx` collects once per board; the plugin acts
  only while a `node.zettel` is being edited.
- **The card's footer** holds the chips: links (written or added), keywords (green), citations
  (brown), at most two rows, and under them, dimmed, "Linked from 26a, 31". One **+** on the card in
  front opens a single field that finds notes, keywords and sources at once, and offers a new keyword
  or a new source made from what was typed. A chip added with **+** shows a small × on hover (always on
  touch screens) to take it off. Links written in the text are only removed from the text.
- **`node.zettel` gained `keywords`, `links`, `cites`** (string arrays, migration `AddChips`). There is
  no `title` prop: the title stays the first heading (Q3).
- **The index** is `node.zettelIndex`, one per box under a fixed shape id, so two devices that each
  make one make the same record. Made with the box, and put back on open (and after a delete on the
  table) if missing. It draws keywords A to Z with their notes, worked out from the cards, case
  folded, spelled as the first note in box order spells it. It sits first in the box's order and on
  the table, but a box still opens on its first note; `Home` and `I` go to it. Pressing a keyword chip
  goes to the index and picks that keyword out.
- **Sources** are `node.zettelSource` `{ zid: 'c1', author, title, year, note }`, a series of their
  own (`isCiteId`, `nextCite`), after every note in the order and in their own column on the table.
  Enter (or a double-click on the table) opens the fields on the card in the stack; Enter steps
  between them and Escape leaves. "Cited by" lists the notes that cite or link to it. Deleting one
  retires its number like a note's.
- **Not `canLeavePage`** any more for any of the three types: each now shows things other cards say.
- Writing a note while the index or a source is in front starts a new train of thought.

## What was decided

| # | Question | Decision |
|---|---|---|
| Q1 | Where a box lives | **A box is a board.** Each note is a shape on it. |
| Q2 | Note ids | **Folgezettel**: given from where the note is placed, never changed. |
| Q3 | Titles | Optional. The id always shows; the title under it if there is one. |
| Q4 | What a note holds | **The sticky note's rich text** (bold, italics, lists, `{…}`), on a 5 × 8 index card (asked for after phase 1) drawn as the board draws a sticky note. Not markdown. Justified. Longer text is set smaller to fit, and scrolls only past half size. |
| Q5 | The chips in a card's footer | Three kinds: **note links**, **index keywords**, **citations**. Clicking one goes to it. |
| Q6 | The index | Luhmann's: a keyword chip on a note files that note under the keyword. The index lists keywords A–Z with their entry notes, and is the front of the box. |
| Q7 | Citations | Cards with fields (author, title, year, a free note), ids `c1`, `c2`…, after the last note. |
| Q8 | The flip | The front card swings round a pivot off its top right corner, up and over, fading, while the next comes forward; back is the reverse (the user's sketch, after phase 1). Under half a second, interruptible; a fast scroll riffles. Eight cards show behind, on a bounded exponential. Type an id to jump. Reduced motion cuts. |
| Q9 | Folders, inbox | Neither. Placing a note when you write it is the point. |
| Q10 | How many boxes | As many as you like. |
| Q11 | Placing a note | **N** new note behind the front card, **⇧N** branch, and *New train of thought*. Rules below. |
| Q12 | Moving, deleting | No moving. Deleting asks first; the id is never reused and the note's branches stay, leaving a gap. |
| Q13 | Making a link | Type `[[` in the text (written as plain `[[25a]]` text, drawn as a chip), or **+** in the footer. Not by drawing arrows. |
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

*As built, a link is plain `[[25a]]` text instead (see "Phase 3, as built"). The design below was the
plan.*

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
