# Skill trees and syllabi: implementation plan

Agreed 2026-10-17. Status: **Steps 1 to 5, and step 6 except the visuals**, are built and checked
on a running board: layout, trees in the vault, views across boards, pillars and the Mastery demo.
Step 6b (lit edges, the pulse, hover history) and Phase B remain. The "as built" notes below say
where the build diverged from the plan and why.

## Trees are made, not imported (2026-10-26)

Asked for after trying the lists: importing a syllabus still put its tree in the vault, and the
tree turned up anyway. Film, Theatre and Games hang theirs under `mastery/practical`, so with
Mastery on the board the tree grew straight into it, and a board already showing a tree redrew it.
Deleting the syllabus in Settings left the tree in the vault and on the board, with nothing that
could delete a whole tree (`removeTreeDef` was never called, and would only have let boards adopt
the nodes back). Settings › Syllabi listed syllabi while the Mastery builder listed trees, so a
syllabus whose file had no tree had nothing to hang. Decided with the user:

- **An import never touches the skill tree.** The board gets its lists; a `tree:` or `trees:` block
  is kept with the syllabus, unused, in the vault key `syllabusTreePlans` (`treePlans.ts`), with the
  file's tracks and the import's draft mark. A tree already made from one of the file's syllabi is
  updated in place, as its items are. A file with no tracks is a tree and still shows as one.
- **A tree is made when asked**, in Settings › Skill trees (`TreeList.tsx`) or with
  `skill.tree.make` (⌘K: Make a skill tree), from what a source offers: a source's `makers()`
  (`sources.ts`) lists them, and the syllabus offers one per confirmed track (`syllabusTrees.ts`).
  None picked makes an empty tree, a named root. Made, a tree is on no board and under no pillar.
- **What a syllabus makes:** the tree its file came with (made once for every track it feeds); else a
  tree an old import left under the goal's id, taken over; else a **path**: a root named for the
  syllabus and one node per entry, each growing from the one before. The path asks nothing:
  `after` (vault only, beside `draft`) draws and lays out like a prerequisite but gates nothing, and
  each node asks `done:` (the entry done by its works' rule, no write-up needed; `item:` asks for the
  write-up, so an entry with works could never meet it). A node's `item` (vault only) is the entry it
  stands for: a view hangs the entry's works from the node, each as an entry hangs, instead of
  drawing the entry beside it, and right-click › Mark as done on the node ticks an entry without works.
- **Several at once** make a tree each, or with a shared root (named), a root-only tree with each of
  theirs hung from it, made from all of them.
- **`madeFrom`** on a tree lists the makers it came from. Deleting a syllabus (`deleteSyllabus`) takes
  it off every tree, and deletes those left made from nothing (`forgetMaker`): a tree several feed
  goes with the last, a shared root with its last branch. Empty trees and old imports have no
  makers and never go this way. One syllabus making a tree shares its name with it (`treeNames.ts`
  pairs by `madeFrom` now, the old id-prefix rule kept for trees from before).
- **Deleting a tree** (`skill.tree.delete`, ⌘K: Delete a skill tree, or × in Settings) leaves a
  tombstone, as a deleted node does: `deleted`, no nodes, every node in `removed`. A board that shows
  it drops every shape of it, ones the vault never heard of included, and its header (`treeSync.ts`),
  so nothing can write it back. Trees made together with it and hung only from it (a shared root's
  branches) go too; a tree hung there by hand is unhung. Making it again brings it back.
- `skill.tree.show` and `skill.tree.mount` take a tree's name as well as its id, and a shown tree
  goes right of what is on the board, as Mastery does, rather than over it.

## Imports arrive as lists (2026-10-26)

Asked for after trying it: dropping `adler.yaml` drew the skill tree at once, when a syllabus should
arrive as something to read, its tree a view you then ask for. An import now puts one list per track
on the board; its trees go to the vault as before (with Skill trees on) and wait for "Show a skill
tree on this board". A document with no tracks, only a tree, still shows its tree, since there would
be nothing else to see. Confirm draft and Discard draft left ⌘K: a board holding a draft shows a bar
fixed over it, with the two as buttons, until one is pressed. The syllabus's Settings page lists and
edits every track and its entries.

## Cleanup (2026-10-25)

Agreed in a grilling round, the second of four phases: a git change came first, then this, then the
split below and a Mastery builder in Settings. Removed:

- **Habits**, all of them: the habit card (`node.habit`, deleted from old boards by the
  `removeHabitNodes` store migration), the `habit:` requirement, Up Next's habit rows, the YAML
  `habits:` block and the `skillHabits` vault key. They come back as an extension of their own. The
  syllabi's habits, for that extension to bring back: Adler's "Write Up an Entry" (one analytical
  write-up a week) and "Read for 30 Minutes" (daily); /mu/core's "Three Albums a Week"; Film's "Two
  Film Weeks" a month; Theatre's "Two Theatre Weeks" a month; Games' "Play a Game as a Director" and
  "Build One Exercise" (weekly) and "Finish One Playable Stage" (monthly). Adler's "The Reading
  Habit" node asked for four weeks of the first; it now asks for four analytical write-ups.
- **The game director curriculum**: Film, Theatre and Games replaced it. The lists Film and Games
  still read from it are `syllabi/director_lists.py`.
- **The Mastery demo** and **Adler's sample tree**, with their commands.
- **Built-in syllabi**: the YAML files and their generators moved to `syllabi/` at the repo root,
  and the per-syllabus import commands went. A syllabus comes in by dropping its file on a board.

The sections below are the history as it was built, and still mention what is gone.

## The split (2026-10-25)

The third phase: one extension became two, so a skill tree can be used without a syllabus and a
syllabus without a tree.

- **`lifeboard.skill-tree`** (`packages/skill-tree`): skill nodes, tree headers and the entries a
  view draws, the layout, views and mounts, Settings › Skill trees, the tree commands and the
  `skill.tree.*` operations. A node's requirements know `node:` (prerequisites) and `manual:` (ticked
  by hand: right-click › Mark as done; the tick is kept on the tree definition, `ticked`, by node).
- **`lifeboard.syllabus`** (`packages/syllabus`): items, tracks, lists, Up next, cards, write-up
  templates and evidence, the YAML import and export, and the other `skill.*` operations.
- **Sources** (`packages/skill-tree/src/sources.ts`) are how one meets the other. A source gives
  kinds of requirement (`key`, `parse`, `qualify` for YAML ids, `evaluate`), evidence (pieces of
  finished work, each tagged to nodes; mastery counts them), and items a view draws beside the nodes
  they are tagged to, with how each looks. The syllabus registers one with `item:` and `count:`. A
  key no source registered doesn't parse, so it is an error on the node rather than met.
- The syllabus depends on the skill tree's package, never the other way. With Skill trees off, a
  syllabus keeps its lists, Up next and cards, and an import leaves the document's trees out.
- The YAML is still one file per syllabus: the skill tree parses the `tree:`/`trees:` part
  (`treeYaml.ts`) and puts it on a board (`treeIO.ts`); the syllabus parses the rest.
- Shape types, vault keys, command ids and operation ids are unchanged, so nothing on a board or in
  the vault moves.

## Mastery (2026-10-25)

The fourth phase. Mastery is one tree per vault, `mastery`, built in Settings › Skill trees
(`packages/skill-tree/src/mastery.ts`, `MasteryBuilder.tsx`):

- **You** (`mastery/root`, kind `mastery`) at the root, and the **pillars** (kind `pillar`, each
  requiring You) in their order round you. *Set up Mastery* starts with Physical, Mental, Spiritual,
  Practical and Social; pillars can be renamed, reordered, added and removed. You exists only as
  Mastery's root: the node editor no longer offers the kind, and YAML turns it into `skill` anywhere
  else. (`pillar` stays a kind any tree can use, as /mu/core's categories do.) Mastery's own nodes
  aren't edited on the board beyond name, icon and picture. Removing a pillar takes it off the trees
  hung under it.
- **Hanging:** a tree has `mounts`, a list (it was one `mount`; an old one is read as a list of
  one). YAML takes `mount:` or `mounts:`. A tree under two pillars is drawn once: it grows from the
  first, as its last child when the other pillar comes next round You and its first when it comes
  before, so it sits on the side facing the other (`towardOtherParents`, `wholeLayout.ts`). Both
  pillars draw a line to it.
- **Lighting:** a pillar is lit once any node in a tree under it is unlocked, and its ring is the
  share of those nodes unlocked; You is the same across all of them. Until then they draw as in reach.
- **On a board:** *Add Mastery to this board* (⌘K) makes Mastery if the vault has none and puts its
  view right of what is on the board. Settings has no board open, so the builder points there.
- **Gone:** *Gather every tree around a Mastery node*, and the `mastery` option of the layout
  operation.

Changed 2026-10-26 (PLAN-29):

- **The builder shows what hangs where:** each pillar lists the trees under it beneath it, as
  branches, with their node counts. A tree with no nodes left is not offered to hang.
- **One name for a syllabus and its tree:** when exactly one confirmed track feeds a tree (its id is
  `<tree id>/…`), the two share a name (`packages/syllabus/src/treeNames.ts`). Renaming either
  renames the other; when they first meet, or both changed, the track's name wins, as Settings ›
  Syllabi is where syllabi are named. A goal with several tracks keeps its tree's own name. Adler's
  and /mu/core's files now name track and tree alike.
- **The demo's trees are gone:** Body, Mind, Spirit, Craft and People, which the removed Mastery demo
  left in vaults, are deleted on load (`retireDemoTree`, `treeDefs.ts`) when they hold only the
  demo's nodes. Every node is tombstoned, so a board still showing the demo drops it.

## Rebuild: one syllabus, many views (agreed 2026-10-17)

Using Adler and /mu/core on real boards showed three problems. An import made three separate
representations at once (a track, a card per entry and work, a tree). The tree couldn't show the
entries. And 2,500 shapes made a board heavy. Agreed in a grilling round:

- **Items live in the vault**, like tree definitions. Every view reads and writes the same items, so a
  tick anywhere is a tick everywhere. Nodes stay real board shapes; no separate renderer.
- **Write-ups stay notes on the board for now:** beside the node or card you ticked on, found from
  other boards through the index. (To be reworked later, toward an AFFiNE-style document.)
- **Import** writes the syllabus into the vault as a draft and puts one tree view on the board, folded
  to skill nodes. "Show as list" and "Add Up Next" add the other views.
- **The list** is the track card as a full outline in reading order. Every entry folds and unfolds to
  its works, and shows progress. It ticks in place, has a height you set and scrolls inside.
- **The tree view** has three sizes: skill nodes, entries (about 60 px) and works (dots with labels).
  Double-click is focus mode, a local graph: the node sits in the middle with everything below it
  unfurled, its parent and siblings stay visible but folded, and the rest leaves the board. Right-click
  › Focus here does the same; editing is right-click › Edit or Enter. The header has Show all, Back,
  Re-calculate and a live-simulation toggle. Folded nodes come back where you left them.
- **Dragging is springy** (the branch follows, neighbours make room, it settles); live simulation is a
  setting. New nodes settle near their parent by themselves.
- **Settings:** defaults in Settings › Skill trees, overridable per tree in its header.
- **Up Next:** one card per track, the current step lit and the next five greyed.
- **Cards** are pop-out views of a vault item (right-click › Put a card on the board), with works as a
  checklist inside and no child shapes. Deleting a card deletes nothing.
- **Old boards** are not migrated; the content is re-imported.

Build order, each phase committed on `develop` and checked in the browser: (1) items in the vault, the
list outline, the split import; (2) the tree view with entries and works, focus mode, Show all,
remembered positions, settings; (3) springy drag, live simulation, Re-calculate; (4) the Up Next card;
(5) pop-out cards. Then the director content.

### Rebuild feedback round (node sizes, author and work, compact layout, focus), as built

From the user's first go with the rebuilt Adler, 2026-10-18:

- **Sizes.** Skill nodes are 150 px. An entry is a 110 px disc with its name inside, then its count
  or tick, so a line from it starts at the disc's centre like a skill node's.
- **Author and work.** Adler's entries are the author ("Herodotus", "Plato", "Virgil") with the works
  as children ("History"; the dialogues; "Works"). Ids are unchanged, so re-importing merges.
  Anonymous entries (Old Testament, Song of Roland) stay single entries.
- **Drafts are vault data.** An imported tree and its new nodes carry `draft` (the importing board's
  id) in the vault, like items. The import writes only the definitions and a header; the view makes
  the node shapes and can therefore hide them. Shapes read their dashed outline from the vault.
  Confirm clears the marks; Discard removes draft trees and draft nodes, with their shapes, and
  leaves no tombstones. This replaces the draft node shapes and their `lifeboard:skillTreeMeta`.
- **Compact Show all and focus.** A view with entries is laid out in clusters: each skill node with
  its entries and works close around it, then the skill nodes placed as discs as big as their
  clusters. A disc sits just beyond the one it hangs from (`layoutGraph`'s `balloon`), not on a ring
  spaced by the biggest cluster at its depth. On Adler that doubled how much of Show all's area the
  nodes fill.
- **Focus** now leaves only the neighbourhood on the board: on Greek Philosophy, 4 skill nodes and
  23 entries and works, nothing overlapping, the header included. Back restores every position.
  Checked with a Playwright run in a fresh profile on an unconfirmed import: focus, Back, Show all,
  Confirm (no dashes left), and Discard (no shapes or trees left).

### Compact layout (asked for 2026-10-18)

Show all was unreadable on big trees: nodes covered about 2% of the area, and arrows ran through
nodes. The user wants it as compact as Path of Exile's passive tree, keeping the tree's flow, with no
arrow over a node, and no imposed structure (a first try stacked works in columns beside their
entry; the user rejected it as against the Path of Exile look).

**As built** (`tree/compact.ts`, replacing the cluster pass of `layoutView`). The tree is grown from
its start, each node placed in turn at the cheapest free spot around what it hangs from: close to
it, a little to its outer side, close to its skill node. A skill node's entries go first, each
followed by its works so a family stays together, then its child skill nodes, each just outside
the cluster toward its share of the branch's way out. The moment a skill node is placed, room for
its cluster and a clear way out to each of its children are kept, so no cluster grown first can
close it in. A last pass slides each branch whole toward the node it hangs from as far as it fits.

Arrows between skill nodes are hard: nothing is placed over one. Light lines to entries and works
are soft (a crossing costs 70 px of distance): a list of 30 works close around its entry can't give
every line a clear path, so the lines are drawn under the nodes (`linesUnderNodes`). The canvas
lifts an arrow above the shapes it joins; an arrow with `ARROW_STAYS_BEHIND_META` (canvas-editor,
`ArrowBindingUtil`) stays where it is put.

Measured on Show all (`compact.test.ts`, `showAll.fixture.ts`), before → after:

| | Bounding box | Fill | Tree arrows through a node | Time |
|---|---|---|---|---|
| Adler | 14341×14167 → 5083×4983 | 1.8% → 14.5% | 53 → 0 | 0.1 s |
| Director | 17962×14436 → 5509×4165 | 2.1% → 23.9% | 57 → 0 | 0.5 s |
| µ/core | 15993×17777 → 6778×6164 | 2.7% → 18.7% | 78 → 0 | 1.2 s |

Checked in the app on a fresh Director import, with the habit cards on the board as obstacles.
Sizes from the canvas come back as 150 × 149.99999999999994, so round shapes are compared with a
tolerance; compared exactly, three skill nodes counted as boxes and one branch landed 4000 px out.

Not yet: cross-links between branches (2 on Adler, 3 on Director) can still pass over nodes; the
layout depends on the order of children (shuffled, Director's fill ranges 17–24%); µ/core takes
1.2 s against the old layout's 0.55 s.

Dead ends worth not repeating: requiring every light line to be clear (a parent's lines shadow
everything behind its children, so a list of 20 spreads into a ring 1000 px wide); hard wedges per
entry (they force fans and columns); unbounded reserved lines (they fence the board off, and a
child that finds no spot jumps 6000 px away); and landing a child only where its whole reserved
room is free (slow, and children land far out).

### Rebuild phases 4 and 5 (Up next per track, pop-out cards), as built

- **Up next** (`node.upNext`, migration `PerTrack`) shows one track: `trackId`, or the first active
  track when empty. Its current step is lit and ticks in place; the next five (`upcomingSteps`, pure,
  depth first through each entry's works) are greyed. Below, the habits of the track's goal still due
  and the twelve-week heatmap of what the track's entries finished. Checked: Adler's card showed the
  Iliad then five greyed, and a tick moved it on to the Odyssey and filed the note beside the card.
- **Pop-out cards** came in along the way: the arrow on a list row (phase 1) and right-click › Put a
  card on the board on an entry or work (phase 2) put a card for that vault item beside it, clear of
  what is there; the card shows its works as a checklist and deleting it deletes nothing.

### Rebuild phase 3 (springy drag, live physics, Re-calculate), as built

- **`tree/physics.ts`** listens to the editor's frame tick. When the select tool starts translating a
  skill node or an entry, it takes the view the node is in: the held nodes stay where the pointer puts
  them, each held node's branch (its descendants, edges pointing away from the view's start) follows
  at the offset it had, on damped springs, and every other node of the view is pushed out of the way
  of anything moving. After release it eases for up to 1.4 s, then a last pass separates anything still
  overlapping.
- **Live physics** (Settings, or a tree's header) makes the whole view take part: every pair repels,
  every line pulls its two ends to a rest length, cooling after release.
- **Undo:** the moves are ordinary updates made while the drag's own undo step is open, so one ⌘Z
  puts the dragged node and everything it pulled back. Checked: a 300 px drag in focus on Greek Epic and
  Drama took Homer and the Iliad within 30 px of the same move, left nothing overlapping, and one undo
  restored every position; live, all 21 nodes moved and came to rest with no overlap.
- **Re-calculate** shipped in phase 2.

### Rebuild phase 2 (entries in the tree, focus mode, Show all), as built

- **`node.skillEntry`** draws a vault item in a tree view: an entry as a 60 px disc with a ring for its
  works done, a work as a tick dot with its title (`entry/`). The view puts them on the board and takes
  them off; they are not in the dock. Light grey lines (arrows, meta `lifeboard:skillEdge: line`) join a
  skill node to its entries and an entry to its works. Skill nodes are 110 px now.
- **What a view shows** (`views.ts`, `viewContents`, pure): the overview is its skill nodes; all adds
  every entry tagged to one of them and every work; focus on a skill node is it, its entries unfurled,
  and its neighbours within the depth folded; focus on an entry (or a work) is the entry unfurled among
  its node's other entries, folded. An entry hangs from the first of its tags in the view's reach.
- **The header is the view's state:** `mode`, `focus`, `depth` and `live` overrides, and `places`, the
  positions of every node in each arrangement it has shown (`overview`, `all`, `focus:<id>`). The
  board records the current arrangement in header meta; switching saves the one left and restores the
  one entered (`tree/viewSync.ts`). An arrangement never seen, or mostly new, is laid out whole around
  its start, which stays put; a few new nodes slide in beside their nearest neighbour. All of it is
  history-ignored; the switch itself (double-click, Show all, Back) is the one undo step.
- **Double-click** is a new node-kit hook (`NodeDefinition.onDoubleClick`, from the select tool's own
  double-click handler); a skill node keeps `canEdit`, so Enter and right-click › Edit still edit it.
  New shape actions: Focus here, Edit, Put a card on the board.
- **Layout** spaces each node by its own size (a ring of work dots sits close, a ring of skill discs
  wide), orients edges away from the start so a focused entry is the middle, and lays the header out
  as a leaf of the start instead of above it.
- **Settings** (`treePrefs.ts`, device-local like the dice's): what an import opens on, focus reach,
  live physics; the panel is on the extension's Settings page.
- Checked in a fresh profile on Adler: focus on Greek Epic and Drama (5 entries, 13 works, no overlaps),
  on Homer (his 2 works, siblings folded), Back to the exact earlier positions, Show all (137 entries,
  273 works, 410 lines, no overlaps, about 2 s), a tick on a work's dot.

### Rebuild phase 1 (items in the vault, the list, the split import), as built

- **`syllabus.ts`** holds items (`ItemDef`: title, kind, medium, tags, core, child rule, parent, works
  in order, a leaf's tick and day, draft), tracks (`TrackDef`) and the write-ups boards have seen
  (`EvidenceEntry`), persisted as `syllabusItems`, `syllabusTracks` and `syllabusEvidence` (and since
  2026-10-26 the trees their files came with, `syllabusTreePlans`). The index
  every evaluator reads is now derived from them, so it is never out of date and is no longer stored.
  A parent's tick and day are worked out from its works.
- **Ticks are vault data**, so ⌘Z does not untick: ticking again does. The write-up note a tick files
  is an ordinary note, beside what you ticked from, and undoes like one.
- **Import** merges a document into the vault (`syllabusMerge.ts`, pure) and puts only a list per
  track on the board (the tree waits in the vault; since 2026-10-26, see below): /mu/core imports in
  0.4 s instead of 6. New items and tracks are drafts of the importing board (`draft` holds its id)
  until Confirm on the board's draft bar; Discard removes them.
- **The list** (`node.track`) is a resizable card for one vault track: the outline in reading order,
  every entry folding to its works (folding is the board's view state, kept on the card and out of
  undo), a parent's box ticking its next work, an arrow on each row putting a card on the board. It
  scrolls while edited, which is when this canvas lets a shape scroll.
- **Cards** (`node.skillItem`) show one vault item with its works as a nested checklist; a card made
  from the dock makes a new item. Old cards and lists migrate to the new props; their content was not
  migrated (the old boards were test boards, re-imported).
- **Gone:** item shapes holding children, collapsing, Arrange children, Make a track from selected
  items, Add selection to track, Insert Adler's reading list (sample). Kind, Medium, Done and Done at are
  no longer board properties, so a table or calendar over them no longer sees syllabus items; Up next's
  heatmap is the log for now.

### Phase B, /mu/core, as built

- **`content/mucore.yaml`** is musicgenretree.org's "1111 Essential Recordings of Music" (Classics
  edition), the chart the /mu/ wiki calls New /mu/core: one recording per genre. The recordings come
  from the site's text list; their category and family from the chart's image map (each cover's
  `title`), so nothing was transcribed from the image.
- **Shape:** one track, "/mu/core" (its tree has the same name), of 84 family units in chart order ("Rock: Metal"), each holding
  its recordings as a collapsed checklist ("Thrash Metal: Metallica - Master of Puppets (1986)").
  The tree is a root, 16 categories as pillars (their rings show how much below is unlocked), and a
  node per family asking for a fifth of its recordings written up. The four categories with one
  family (Prehistoric, Ancient, Central Asian, Indigenous American) are one node. A habit asks for
  three albums a week. "Import /mu/core (1111 recordings)" brings it in as a draft.
- **What it took at this size** (about 2,500 shapes in one import, timed in a fresh profile):
  - The canvas built its sorted list of every shape on each create to look for a frame to drop the
    shape in, even when the shape named its parent: quadratic. `canvas-editor` now builds it only
    when a shape needs a parent found (a fork change), and items, nodes, headers and relation arrows
    created in bulk name the page.
  - The index and the tree sync reacted to every one of the creates, and saw the import's shapes
    before it marked them as drafts, so a draft's nodes reached the vault at once and stayed there
    after Discard. Imports, confirms and discards now run in `whileImporting` (importing.ts): both
    wait, and catch up once at the end, drafts left out.
  - Confirming wrote the vault once per node, and each write made every node on the board parse
    every requirement of its tree again. Writes are batched per tree (`upsertNodeDefs`) and parsed
    requirements are cached by their text.
  - Result: import 40 s to 6 s, confirm 6 s to 2 s; panning stays at 20 ms a frame.
- **New trees go into clear space.** A tree an import puts on the board for the first time is laid
  out whole to the right of everything else, since its width is only known once it is laid out.

### Phase B, Adler, as built

- **`packages/skill-tree/content/adler.yaml`** is the whole list: 137 entries in their order as one
  track, and a 49-node tree of fields by era (literature, philosophy, science, history and politics,
  theology; ancient to twentieth century), each era's node needing the same field's node before it,
  with cross-links where the reading does (Ptolemy before the Scientific Revolution, Kant after
  both Rationalists and Empiricists). Hand-editable; `content.test.ts` checks that it parses, that
  every entry is tagged to a node, that every node is reachable from the root and that no count asks
  for more written-up works than its node can get.
- **Source:** the list as printed on tosummarise.com, checked against the book; its typos are
  corrected (Aristotle, Bacon, Galileo, Nicomachean, Journal to Stella, Burnt Njal).
- **Merges with the sample:** the first fifteen keep the sample's ids, titles and children, and the
  eight sample nodes their ids and requirements, so importing on a board with the sample updates it
  in place and keeps ticks and notes.
- **"Import Adler's full reading list (137 entries)"** imports the bundled file as a draft (loaded on
  demand, so the board bundle does not carry it).
- **Two import fixes it needed:** a long track's new items wrap into columns past 2400 px, and a tree
  an import grows past its own size is laid out again whole, in clear space to the right of the
  board (new item cards have not been measured yet when it runs, so fitting the tree among them
  went wrong). Smaller additions slide in beside their nearest ancestor.

### Phase B, the game director curriculum, as built

`content/director.yaml`, generated by `content/gen_director.py` from the page "A game director's
self-education" (docs.darkroomlab.net/541a35-a-game-director-s-self-education). The lists live in
the script; edit them there and run it again. "Import the game director curriculum (196 entries)"
brings it in as a draft.

- **Twelve tracks, 196 entries, 854 items with their works:** Game Design, Western Film, Soviet
  Film, Georgian Film, Film Weeks, Western Theatre, Russian Theatre, Georgian Theatre and Arts,
  Stagecraft, Theatre Weeks, Literature and the Arts, Practice. Narrative design is folded into
  Game Design. Adler's list stays its own goal and tree, under Mental; Literature and the Arts holds
  Bauer, the curriculum's literature spine.
- **Real lists, fetched:** Mark Brown's 100 from his GMTK post, in his order, in eight chronological
  clusters. Scorsese's 39 from his note to Colin Levy. The Sight & Sound 2022 directors' poll from
  the BFI, all 104 (twelve tie at 93), in four bands of rank. Schreiber's twenty Levels from the
  2009 syllabus, one per dated topic.
- **Units.** Each of sixteen film weeks (the school-of-the-month rotation, run twice) is an entry
  with the film week's seven steps. Theatre weeks are the three the page pairs (Three Sisters, the
  Caucasian Chalk Circle, the Government Inspector). Each stagecraft discipline is an entry with its
  book, bridge, three games and exercises; the page's "Do" is core.
- **A book in two tracks** (Aristotle's Poetics, Ball, Hodge & McLain, Michael Chekhov, McCloud) is
  listed in the second by reference, not copied.
- **The tree,** Game Director, has 30 nodes: a root (Keep One Journal), branches for games, film,
  theatre and literature, the eight disciplines, and two keystones (Ship a Stage, A Small Finished
  Game) that count ship items. It hangs from `mastery/practical`, beside Craft, once the Mastery demo
  is on a board.
- **Habits:** Play a Game as a Director (weekly, five passes), Two Film Weeks and Two Theatre Weeks
  (monthly, film sheets and Ball), Build One Exercise (weekly, practice), Finish One Playable Stage
  (monthly, ship). Habits have no quarter or year, so the quarterly jams and the yearly game are
  ship entries in the Practice track.
- **Checked** with a Playwright run in a fresh profile: the import makes 30 skill nodes, a header and
  five habit cards; on a Mastery board the tree hangs from Practical (57 nodes). Not fixed, as
  layout is on hold: the header and habit cards land over the middle of the tree.

**Gaps, for a later research pass** (not filled by guessing):

- The Video Game Canon's top 100, which the curriculum checks Brown's list against: only its top 7
  is on the page.
- Aleksei German's late trilogy, Pudovkin's, Muratova's, Gaidai's, Ptushko's and Norstein's films:
  the page names the director, not the films. Each is one entry with no works.
- Directors and years for most Soviet and Georgian films. They are given only where the page or the
  BFI list gives them.
- Books the page marks unverified (Pilbrow, Chion, Landis), and electives nobody has checked for
  reading lists (Schell, Swink, Sylvester, Anthropy & Clark, Lantz, Rogers).
- Film Art's chapters and Fullerton's chapters: each book is one entry, or two parts for Fullerton.
- Pairings for theatre weeks beyond the three the page gives.

### Pillars and the Mastery demo, as built

- **YAML:** `trees:` holds several trees in one document (each after the first needs an `id`), and
  any tree can say `mount: <node>` (qualified with the goal unless it has a `/`). A tree mounted on a
  node of the same document gets no header; its name, goal and mount travel on its draft nodes
  (meta `lifeboard:skillTreeMeta`) and reach the vault on Confirm. (Since the feedback round they go
  straight into the vault, marked as a draft.) The document is laid out whole
  around each headed tree's root, mounted branches included.
- **New branches on a laid-out board** (a tree hung on a pillar from another board) are laid out as
  their own little tree, then slid outward from the middle of the board's nodes until they cover
  nothing. Fitting them in among pinned neighbours did not converge.
- **Insert the Mastery demo (five pillars):** Mastery, Physical, Mental, Spiritual, Practical and
  Social, with a starter tree on each (Body, Mind, Spirit, Craft, People), confirmed at once. If the
  vault has the Adler tree and it hangs from nothing, it is hung under Mental. Checked with a
  Playwright run in a fresh profile: 39 nodes, six mount arrows, no overlaps.

### Step 6c, part one: tree definitions in the vault, as built

Decided 2026-10-17: trees are vault data, and a board's node shapes are views of them.

- **`treeDefs.ts`** holds every tree (name, goal, sectors, rings, `mount`, nodes with their fields
  and requirements) in the vault setting `skillTrees`, persisted like the indexes. Unlike the
  indexes it is the only copy of a tree, so it is what a server backup must keep.
- **Both directions** (`treeSync.ts`): editing, adding or deleting a node shape writes its tree;
  a changed tree is drawn on every open board that has the node, with `history: 'ignore'`, so ⌘Z
  never undoes another board's edit. Deleting a node shape deletes the node from its tree, and undo
  writes it back.
- **Tombstones.** A deleted node is remembered in `removed`. A board that opens with a node its tree
  has never heard of adds it to the tree (an old board, a shape made offline); only a tombstoned
  node is removed. A stale copy of the vault therefore never deletes anything.
- **Old boards** are adopted on open: a tree the vault lacks is written from the board's shapes.
- **Requirements** are evaluated against the definition, not the board's shapes, so a board that
  shows one branch still evaluates against the whole tree. Draft nodes are added to it until
  confirmed.

### Step 6c, part two: views, as built

- **A header is a view.** A `node.skillTree` shape shows its tree from a root (its `root` prop,
  "Show from" in its editor; empty means the tree's root): that node and everything reachable from
  it through prerequisites, the tree's loose nodes, and trees mounted on any of them (`views.ts`).
  Nodes in reach that the board lacks are created; node shapes of a covered tree that fall out of
  reach are removed from this board only. A board without headers has no views and is left alone.
- **Placement.** A view with nothing on the board yet is laid out whole below its header. Nodes added
  to a view later are placed beside their nearest ancestor already on the board, everything else an
  obstacle. Both are vault-following writes, so they skip undo like the rest of the sync.
- **Mounts.** A tree's `mount` names a node of another tree; views of that node include the tree,
  joined by an arrow from the mount node to the tree's root (meta `lifeboard:skillEdge: mount:<id>`).
  Mastery is now an ordinary tree, `mastery`, rooted at `mastery/root`; "Gather every tree around a
  Mastery node" mounts the board's unmounted trees on it and adds a Mastery header. Kinds `mastery`
  and `pillar` show the share of everything below them that is unlocked.
- **Operations:** `skill.tree.show` (a tree and an optional root; a header on this board),
  `skill.tree.mount` (tree, node; vault data). Both are in ⌘K. Export writes a tree from the vault,
  whole, so a board showing a branch still exports the tree.

### Step 6a (layout), as built

- **One layout, not three.** Sectors-and-rings placement is gone; every tree is laid out as a graph
  (`tree/layout.ts`, `layoutGraph`): a radial tidy tree from the root, a short deterministic force
  pass (repulsion, springs on edges, a pull back toward the tidy spot so the shape survives), then
  hard passes until no two boxes overlap and no edge runs through a node. Sectors and rings now only
  set the order nodes fan out in, so a sectored tree keeps its wedges side by side. The `layout` prop
  stays on the header for old data and is not read.
- **The root.** A node hangs from its prerequisite nearest the root; its other prerequisites stay
  edges that pull gently. The tree header has a new `root` prop (migration `AddRoot`), picked in its
  editor; empty means the node of kind root. Nodes with no prerequisites (method nodes) hang from the
  root by an edge nobody draws, and so does the header.
- **The rest of the board is in the way.** Every other shape on the page is a fixed obstacle, so a
  laid-out tree never lands on a card. An edge that would cross one moves its own end instead.
- **Commands:** Lay out tree (on a header or node; on the Mastery node it gathers), Lay out from this
  node (that node and everything depending on it, around where it stands; the rest of the tree is an
  obstacle), Gather every tree around a Mastery node. Operation `skill.tree.layout` (`treeId`,
  `from`, or `mastery`). Each is one undo step, Mastery's creation and edges included.
- **Mastery** is a `node.skill` of kind `mastery` in its own tree `mastery`, with an arrow to each
  tree's root (meta `lifeboard:skillEdge: mastery`). Its ring is the share of every tree on the board
  that is unlocked; it requires nothing and nothing requires it.
- **Not yet:** the same tree shown from different roots on different boards (see "Graph layout and
  roots": it needs tree definitions in the vault, still to be decided). A YAML import into an
  existing tree places its new nodes beside it; run Lay out tree afterwards.

### Step 5, as built

- **One goal per document.** An import gives every track, tree and habit in it the document's goal,
  so a file holding two goals would merge them. Export writes one goal at a time (the selected
  track's, tree's or habit's, or the board's first); `skill.export` takes a `goal` and lists the
  board's goals.
- **Ids.** Short ids are qualified on the way in (`homer` in goal `adler` is `adler/homer`, its child
  `iliad` is `adler/homer/iliad`); tags, default tags, habit filters and requirement references are
  qualified with the tree's id. An id with a `/` is kept as written. Export writes ids in full, so
  importing an export updates in place and creates nothing (checked on a board).
- **Merging.** An id already on the board is updated: titles, tags, kind and medium, child rules,
  requirements, track order (the document's order first, then anything the track already had).
  Ticks, notes and habit logs are never touched.
- **Drafts** are every shape the import made, arrows included, except a prerequisite edge redrawn
  between two nodes that were already there. A draft is dashed, joins no index, and selecting and
  zooming to it is the import's last step. Without a drop point an import lands to the right of
  everything on the board.
- **Problems** are listed, every one with its place ("Track 1 › item 2: kind is one of …", or the
  YAML line). From the palette or a dropped file they arrive as a note on the board, because an
  extension has no toast to reach; an operation returns them to the agent.
- **Commands:** Import syllabus YAML from the clipboard, Copy a syllabus as YAML. A dropped `.yaml`
  or `.yml` file is imported where it lands. Confirm and Discard are buttons on the bar a board with
  a draft shows (`DraftBar.tsx`), no longer commands.
- **Operations:** `skill.import`, `skill.export`, `skill.item.complete`, `skill.tag` (a YAML map of
  item id to node ids, the bulk tagging pass), `skill.read` (tracks, items, habits, and the state of
  every node on the open board), `skill.draft.confirm`, `skill.draft.discard`.
- **Diverged from the spec below:** unknown keys are dropped, not kept; an item's own `method` is
  not read yet (the method comes from its medium's template); a document holds one goal.
- **Fixed on the way:** sweeping orphaned children on board open now takes their hidden arrows too.
  tldraw keeps an arrow whose end shape is deleted, and once it joins nothing it draws again.

### Step 4, as built

- **`node.upNext`** lists the next undone step of every active track (depth first into units, in
  the steps' order), then the habits not yet met this period, then a twelve-week heatmap of days
  with completions. A goal filter narrows it to one goal's tracks and habits.
- **It reads the vault, not the board.** Tracks joined the index (vault setting `skillTracks`), and
  items record their place among their siblings (`position`) so a unit's next step is known without
  opening its board. The habit and track copies share one small store (`entityStore`).
- **Rows tick in place** when the step is on this board; otherwise they say "on another board", and
  clicking any row opens its board through node-kit's `BoardBridge` and selects the item. A habit
  ticked by hand has a + on the card when it lives on this board.
- **The full log** is a calendar view over `Done at` (Tables & views picks the date property by
  itself); the heatmap is the cross-board summary. No separate log shape was needed.
- **Not yet:** habits on another board can't be ticked from the card; the first row is highlighted
  as "the one to do", which is only the first track's step.

### Step 3, as built

- **`node.habit`** holds its period, target, filter (`counts`, a YAML map such as `kind: Ship`, empty
  for a habit ticked by hand), the item that starts it (`startedBy`), the day it was made
  (`startedAt`), its hand ticks per period (`log`, JSON) and its state. Weeks are keyed by their
  Monday, months by `YYYY-MM`.
- **Automatic habits count written-up completions** (done with evidence) matching the filter, by the
  day they were done. Hand ticks add to either kind. An unparseable filter counts as "by hand", so a
  typo never invents progress.
- **The card** shows this period's count with + and −, the last eight periods as dots (filled when
  met, hollow when missed, ringed for now) and the current streak. Nothing is ever red.
- **Habits have an index of their own** beside the item index (`getHabitIndex`, vault setting
  `skillHabits`), so a node on one board can require a habit kept on another.
- **Habit conditions** read Life RPG's rules over periods: `total` (sum of counts), `streak`
  (periods met in a row), `best_week`, and `periods` (alias `days`, periods met). A habit started by
  an item begins the day that item was done.
- **Not yet:** Up next listing the habits due (step 4); a paused habit still counts its past.

### Steps 1 and 2, as built

- **Duplicate property cards.** Every shape with properties gets a card under it, so an item showed
  Study and book twice. The item card hides the properties it already shows (Kind, Medium, Done, Done
  at) with the existing per-shape hidden list, and a card with nothing left isn't drawn. The panel
  can still show them. An evidence note hides `Evidence of` and keeps `Method` visible.
- **Evidence notes** start with `# <item title>` so you can tell which item a note belongs to;
  `hasEvidence` ignores that line. A note goes beside the card you can see (the item, or the
  collapsed parent hiding it) and stacks under the notes already filed there for the same family.
- **Collapsing** needed a seam: `Extension.shapeVisibility` in node-kit, consulted by the app's
  `getShapeVisibility` with one map lookup per shape.
- **No `onShapeDelete` hook after all.** On `onBoardOpen` the extension attaches the store's own
  create, change and delete side effects for its shapes (`skillIndex.ts`, `watchBoard`). They see
  prop changes (title, tags, parent) as well as properties, which the hooks don't.
- **Deleting a parent hides its children instead of deleting them.** A delete issued from a side
  effect is not recorded by this canvas's command-based undo, so one ⌘Z brought the parent back
  without its children (verified on two plain rectangles: the side-effect delete is never undone).
  An item whose parent is gone is hidden and dropped from the index; undo brings the family back
  whole; orphans still there are swept when the board next opens. Node-kit's own relation cascade
  (`deleteRelationsWithShapes`) uses the same side-effect delete and probably has the same undo gap.
- **Tags are inherited from ancestors**, so a dialogue counts for the node its author is tagged
  with. Track default tags are not applied yet.
- **Method nodes** count evidence from every node of their tree, filtered by method, rather than only
  evidence tagged to them: "three books read analytically" is met by any three.
- **Mastery** counts the evidence beyond what the node's `count` conditions used (earliest first),
  instead of evidence dated after the unlock, because completions carry a day, not a time. A node
  with enough evidence for a tier but too few Ships says "needs a Ship".
- **Prerequisite lines** are real arrows marked `lifeboard:skillEdge`, drawn when a tree is inserted
  and by "Redraw prerequisite lines". Never read back.
- **Habit conditions** parse and show, and stay unmet until step 3.
- **The index persists throttled** (one write a second at most), since every keystroke in an
  evidence note changes it. The server accepts it as the vault setting `skillIndex`.
- **Icons on skill nodes** reuse the board icons (Tabler's outline set) through a new node-kit seam,
  `IconBridge` (`setIconBridge`, `getIconBridge`): the app lends an `Icon` and an inline
  `IconPicker`, so an extension never imports the catalogue. `node.skill` gained an `icon` prop with
  a migration (`AddIcon`).
- **Not yet:** template editing in Settings, a key for "Complete item", zoom-to-fit counting hidden
  children (it frames them too, so a board of collapsed parents zooms out further than it looks).

A new extension, `@lifeboard/skill-tree`, that turns any curriculum into two things you can follow
without planning: **tracks** (ordered syllabi you tick off, one item after another) and **trees**
(Path of Exile-style constellations of skills that light up from the evidence your ticks leave). It
is generic by design. The first goals are a game director's self-education, Adler's *How to Read a
Book* list, and a music listener tree built from musicgenretree.org, but nothing in the model knows
about any of them. A music production tree, or anything else, is just more YAML.

The design came out of a long interview (the decisions are summarised below) and borrows two ideas
from Life RPG (`girgvliani/usefulAPP`, `backend/app/services/paths.py`): habits as measured,
periodic targets, and its four chapter rules (`total`, `best_week`, `streak`, `days`) as the
language for "do this repeatedly". It deliberately does not borrow XP, levels, titles, daily decay or
adaptive targets.

## What was decided

| Question | Decision |
|---|---|
| What unlocks a skill | Evidence only. No points to spend, no XP. |
| What a syllabus is | Several **tracks**, each an ordered list. A goal combines tracks. Order guides, it does not gate. |
| Time | None in the syllabus. No dates, no weekdays. Only **habits** have periods (day, week, month). |
| Item kinds | **Study** (go through a work with a set method), **Practice** (an exercise), **Ship** (a made thing). |
| Items | Global. One item can feed nodes in several trees (*Poetics* counts for Adler and for Theatre). |
| Items on the board | Every item is a shape. Items can have children (Plato → dialogues; a unit → its steps). |
| A parent is done | When its **core** children are done, by default. Per parent: `all`, `core`, or `n` of them. |
| Done | A tick plus a note from the item's template. A tick with an empty note is "done, no evidence". |
| Mastery | Endless tiers: Bronze, Silver, Gold at 3, 10, 25 pieces of evidence, each tier needing one Ship. |
| Titles, levels | None for now. |
| Tree layout | One constellation per goal. Three auto-layouts: sectors × rings, lineage, free. |
| Method nodes | Skills of *how* you study (Adler's analytical and syntopical reading, the film sheet) sit in the inner ring and count evidence by `method`. |
| Boards | Built for separate boards joined by a vault-wide index; works the same with everything on one board. |
| Making a tree | By hand, from YAML, or drafted by the agent. One format for all three. Imports are drafts until confirmed. |
| The daily list | One **Up next** card across all goals: the next item of every active track, plus habits due this period. |

## Vocabulary

| Term | What it is | Stored as |
|---|---|---|
| **Goal** | A thing you want to become good at ("Game director", "Western canon reader", "Music listener"). Groups tracks and has one tree. | A field on tracks and trees |
| **Track** | An ordered syllabus inside a goal: Western film, Adler, /mu/core. Active, paused or not started. | `node.track` shape |
| **Item** | One thing to do. Has a kind, a medium, tags, optional children. | `node.skillItem` shape |
| **Unit** | An item whose children are steps across kinds: read the play, watch the production, do the exercise, write it up. Not a separate type. | `node.skillItem` with children |
| **Tree** | A goal's constellation: its axes, layout mode, nodes. | `node.skillTree` shape (the header card) |
| **Skill node** | One perk on the tree, with a requirement and mastery tiers. | `node.skill` shape |
| **Habit** | A periodic target that counts completions or takes hand ticks. | `node.habit` shape |
| **Evidence** | The note a completion leaves: the one-page analysis, the film sheet, the album card. | `node.markdown` with properties |
| **Index** | Every item, completion and habit check-in in the vault, readable from any board. | Vault setting `skillIndex` |

## The model in detail

### Items

An item's identity and structure live in its shape props, and its user-facing facts are ordinary
properties, so tables, the kanban and the calendar work on items with no extra code.

Shape props (`node.skillItem`, schema-versioned, migrations from day one):

- `itemId`: a stable global id (`adler/011-aristotle`). Survives copy, move between boards and
  re-import. A pasted duplicate gets a new id unless the paste is a move.
- `parentId`, `childRule` (`core` | `all` | `{ n: 3 }`), `core: boolean` (this child is core to its
  parent), `collapsed: boolean`.
- `tags`: node ids this item feeds, in any tree (`director/theatre-tragedy`, `adler/greek-drama`).
- `templateId`: overrides the medium's default template.

Properties (named, so a calendar can group by `Done at` and a table can filter by `Kind`):
`Kind` (select: Study, Practice, Ship), `Medium` (select, open set: book, work, film, play, game,
album, talk, exercise, artefact, visit…), `Status` (status: Not started / Done), `Done at` (date),
`Rating` (rating, optional), `Method` (select, the method the evidence used), `Evidence` (checkbox,
derived: set when the linked note is non-empty).

**Children.** Collapsed, the parent shows a progress ring and a checklist (`Plato 3/10 · core 1/2`)
and its children are hidden. Expanded, the children are laid out around the parent and joined to it
by hidden relations (`HIDDEN_RELATION_META`), so dragging, notes and arrows all behave as on any
shape. A parent with `childRule: core` is done when every core child is; its other children count
as extra evidence on the parent's tags.

### Tracks

A track card (`node.track`) holds:

- `trackId`, `goal`, `name`, `state` (`active` | `paused` | `notStarted`).
- `order`: the ordered list of item ids. The track owns the order, so one item can sit in two tracks
  at different positions. Items whose shape is on another board show in the card as linked rows.
- `defaultTags`: tags every item in the track inherits. Per-item tags add to them. A separate AI
  tagging pass (an agent operation, below) fills per-item tags in bulk.

The card is the syllabus view: the list in order, done items struck through with their date, the next
undone item highlighted, a filter to one track's units. Order is a suggestion. You can tick anything;
an item done out of order is logged as such and nothing is blocked. The one hard gate is an item that
names another as a prerequisite (`requires: [item ids]`), for a "Ship a tableau stage" that makes no
sense before the tableau film unit.

### Completion and evidence

Ticking an item:

1. Sets `Status: Done` and `Done at: now`.
2. Creates a note from the item's template next to the item, linked by a relation and carrying the
   properties `Evidence of` (the item's id) and `Method`. If a note already exists it is reused.
3. Writes the completion into the index.

The note's emptiness is checked when it changes. A completion with an empty note shows as "done, no
evidence" (a hollow tick) and counts toward the track, but not toward any node's requirement or
mastery. Unticking reverses all three steps, and leaves the note in place in case it holds writing.

**Templates** are markdown with headings, one per medium, editable and saved with the vault like card
layouts. Shipped defaults: book (Adler's four questions), film (the study sheet from the curriculum
page), play (Ball's backwards analysis), game (the five passes and a Fullerton journal entry), album
(rating, standout track, three lines), exercise (what I built, what happened, what I'd change),
artefact (postmortem). A template can name its `method`, so evidence from the film sheet counts as
`method: film-sheet` automatically.

### Trees and skill nodes

A tree header card (`node.skillTree`) holds `treeId`, `goal`, `layout` (`sectors` | `lineage` |
`free`), and for the sectors layout its `sectors` and `rings`. A skill node (`node.skill`) holds
`nodeId`, `treeId`, `sector`, `ring`, `kind` (`skill` | `method` | `keystone` | `root`), a
`requirement` and an optional `mastery` override.

**Requirements** are a list of conditions, all of which must hold:

```yaml
requires:
  - node: [director/theatre-foundations]          # these nodes are unlocked
  - item: theatre/ball-backwards-forwards         # this item is done (with evidence)
  - count: { kind: practice, min: 3 }             # items tagged to this node
  - count: { method: film-sheet, min: 2 }         # filter by kind, medium or method
  - habit: { id: film-week, rule: total, min: 4 } # Life RPG's four rules
```

`count` counts evidence-bearing completions of items tagged to this node, filtered by any of `kind`,
`medium`, `method`, `track`. `habit` reads a habit's log with one of `total`, `best_week`, `streak`,
`days`. `node` is what makes the list a tree. Prerequisite edges are *derived* from `node`
conditions: the tree draws them as relations on its own board, but they are never read back as data,
so moving a node to another board cannot change what it requires.

**States**, computed from the index, never stored:

| State | When | Drawn as |
|---|---|---|
| Locked | A `node` condition is not met | Dim, requirements greyed |
| Available | Prerequisites met, own conditions not | Outlined, with a progress fraction ("2/3 Practice") |
| Unlocked | All conditions met | Lit |
| Bronze / Silver / Gold | 3 / 10 / 25 pieces of evidence tagged here *after* unlocking, each tier including at least one Ship | A ring that fills toward the next tier |

An edge lights when both its ends are unlocked. The three available nodes closest to unlocking pulse.
The hover card lists the items that would advance the node, and the node's history (each piece of
evidence with its date). Mastery is endless: after Gold the ring keeps counting.

### Habits

A habit card (`node.habit`): `habitId`, `goal`, `period` (`day` | `week` | `month`, weeks Monday to
Sunday), `target` (a number), `counts` (either `manual` or a filter like `{ kind: ship }` or
`{ medium: film, method: film-sheet }`), `startedBy` (an item id: the habit stays hidden until that
item is done), `state` (`active` | `paused`). Its log is stored per period in the index. A period
ends hit or missed; a miss costs nothing and nothing is shown red.

### Up next

One card (`node.upNext`) you can put on any board, showing across every goal (filterable to one):

1. For each **active** track, its next undone item (for a unit, the unit's next undone child), with
   kind, medium and track. Ticking in place does what ticking the item does. Clicking opens the item's
   board and zooms to it.
2. Every active habit not yet met this period, with its count ("film sheet 0/1 this week").
3. A 12-week heatmap of days with any completion.

The calendar view (`node.table` in calendar mode over `Done at`) is the full log, for free.

### The index

Lifeboard cannot read a board without mounting its editor (`BoardBridge.open`), so the index is
written as things change rather than computed on read:

- `onShapeCreate` and `onPropertyChange` (`packages/node-kit/src/hooks.ts`) on any board record item,
  track, habit and evidence changes into the `skillIndex` atom.
- `onBoardOpen` rescans the board and reconciles, which also catches deletions (there is no
  `onShapeDelete` hook today; step 2 adds one to node-kit rather than relying on rescans alone).
- The atom persists like saved card layouts (`apps/web/src/app/cardLayouts.ts`): localStorage as the
  cache, `pushVaultSetting('skillIndex', …)` to the server vault, the server's copy winning on load.

Each entry is small (`{ itemId, title, kind, medium, tags, doneAt, evidence, method, boardId,
shapeId, parentId, core }`). Whole-value pushes are fine for the director curriculum and Adler, a few
hundred entries. **Risk:** a full /mu/ import (about 15,000 albums) is megabytes per push. That is
not a step-1 problem, since /mu/ starts with one chart, but the index needs a per-entry server
endpoint before it holds more than a few thousand items. Flagged under open questions.

## The YAML format

One format for import, export and the agent's drafts. A file can hold any mix of goals, tracks,
items, trees and habits; ids are namespaced by goal.

```yaml
goal: adler
name: Western canon reader

tree:
  layout: sectors
  rings: [method, ancient, medieval, renaissance, enlightenment, nineteenth, twentieth]
  sectors: [literature, philosophy, science, history-politics, theology]
  nodes:
    - id: root
      kind: root
      name: Start with the Greeks
    - id: analytical-reading
      kind: method
      ring: method
      name: Analytical reading
      requires:
        - count: { method: analytical, min: 3 }
    - id: greek-drama
      ring: ancient
      sector: literature
      name: Greek tragedy and comedy
      requires:
        - node: [root]
        - count: { min: 3 }

tracks:
  - id: canon
    name: Adler's reading list
    defaultTags: []
    items:
      - id: 004-sophocles
        title: Sophocles, Tragedies
        kind: study
        medium: book
        tags: [greek-drama]
        childRule: core
        children:
          - { id: oedipus, title: Oedipus the King, core: true }
          - { id: antigone, title: Antigone }
      - id: 010-plato
        title: Plato
        kind: study
        medium: book
        tags: [greek-philosophy]
        children:
          - { id: republic, title: The Republic, core: true }
          - { id: symposium, title: Symposium }
          - { id: phaedo, title: Phaedo }

habits:
  - id: daily-reading
    name: Read 30 minutes
    period: day
    target: 1
    counts: manual
```

A unit from the director goal, the theatre week turned into ordered steps:

```yaml
- id: unit-three-sisters
  title: "Unit: Three Sisters"
  kind: study
  childRule: all
  tags: [russian-theatre, atmosphere]
  children:
    - { id: read,  title: Read Three Sisters with Ball's method, medium: play, method: ball }
    - { id: watch, title: Kulyabin's production (Kanopy), medium: play }
    - { id: film,  title: Iosseliani, Falling Leaves, medium: film, method: film-sheet }
    - { id: game,  title: Pathologic 2, atmosphere lens, medium: game, method: five-passes }
    - { id: read2, title: M. Chekhov, To the Actor ch. 4, medium: book }
    - { id: make,  title: Stage one NPC action in two opposite atmospheres, kind: practice, medium: exercise }
```

Unknown keys are kept and round-trip unchanged, so a later version can add fields without losing
data from an older export. Invalid YAML is refused whole, with the line number, as the card-layout
editor already does (`properties/layoutYaml.ts`).

## Layout

- **Sectors × rings.** The root at the centre; rings outward by `ring`, sectors as angular wedges by
  `sector`. Nodes in the same cell spread along the ring. Used by Adler and the director goal.
- **Lineage.** The root at the centre, each node placed outward from its first `node` prerequisite,
  branches fanning by family. For genre trees (musicgenretree.org: the genre is the node, its parent
  genre the prerequisite, its essential recordings a track).
- **Free.** Nothing is placed automatically.

Layout is a command ("Lay out tree") that writes positions once, as one undo step, then leaves
them to you. It never runs on its own, so a tree you have arranged stays arranged.

### Graph layout and roots (asked for 2026-10-17, for step 6)

The sectors-and-rings sample overlaps: nodes on one axis share lines, and arrows run through the
nodes between them. Step 6 replaces placement with a graph layout in the spirit of Obsidian's graph
view, keeping the tree's shape:

- **Tree first, then separation.** Lay the prerequisite graph out as a radial tidy tree from a root
  (children fanned around their parent, deeper nodes further out), then relax it with a short
  force simulation (node repulsion, edge springs, collision radius from the node's size) so no two
  nodes overlap and no edge passes through a node. Cross-links (a node with two prerequisites) pull
  gently rather than distorting the tree.
- **Any node can be the root.** "Lay out from here" on a node lays out that node and everything
  that depends on it, with it at the centre. A tree header names its default root.
- **One board for everything, or a board per branch.** A "Mastery" node above several trees' roots
  lays every tree out around it on one board. Picking a branch's node as the root shows just that
  branch, so the same tree can be viewed whole on one board and a part of it on another.
- **Open question this raises.** Today a node is a shape on one board, so "the same tree on two
  boards" means two copies of its nodes. Viewing a tree from different roots on different boards
  wants tree *definitions* in the vault (beside the index) and boards that show a *view* of a tree:
  shapes created for the chosen root's subtree, refreshed from the definition. To be decided at the
  start of step 6; YAML import (step 5) should write definitions either way.

## Surfaces

Following `.claude/skills/extension-surfaces/SKILL.md`:

- **Node types:** `node.skillItem`, `node.track`, `node.skillTree`, `node.skill`, `node.habit`,
  `node.upNext`. "Add …" commands are generated.
- **Commands** (on the extension): Complete item (`⌘↵` with an item selected, checked against tldraw's
  bindings first), Expand / collapse children, Lay out tree, Start / pause track, Import YAML…,
  Export as YAML…, Confirm draft, Discard draft.
- **Operations** (and so MCP tools for the agent panel): `skill.import` (YAML in, a draft out),
  `skill.export`, `skill.item.complete`, `skill.tag` (bulk tagging for the AI pass), `skill.tree.layout`,
  `skill.index.read` (read-only).
- **Drafts.** An import creates shapes marked with meta `lifeboard:skillDraft` and drawn with a dashed
  outline. They join no index and no requirement until "Confirm draft". Discard removes them in one
  undo step.
- **Settings page:** templates per medium, mastery thresholds, which goals Up next shows.
- **Help:** a "Skill trees" section; README extension table row.
- **Queries:** not in v1. `Extension.queries` expand into the existing evaluator, whose sources are
  `page`, `frame` and `connected`, so `{…}` cannot see the index. A cross-board source is its own
  piece of work (open questions).

## Build steps

Each step ships something usable, is tested against a real list (an Adler sample of about 15 entries
from the first step on), and ends with typecheck, unit tests and a check on a running board.

1. **Items, tracks, completion, templates.** `node.skillItem` with children, collapse and expand,
   `node.track`, ticking, evidence notes from templates, the hollow tick. Everything on one board,
   no index yet. Unit tests for child rules and completion. *Usable result:* the Adler sample as a
   track you tick through, with Plato's dialogues collapsing into a progress ring.
2. **Skill nodes, requirements, the index.** `node.skillTree`, `node.skill`, the requirement
   evaluator (pure, fully unit tested against fixture indexes), states and mastery, the `skillIndex`
   atom and its persistence, an `onShapeDelete` hook in node-kit. *Usable result:* the Adler sample's
   tree lighting up as you tick, with the track and the tree on different boards.
3. **Habits.** `node.habit`, periods, automatic counting from completions, `startedBy`, the habit
   rules in requirements.
4. **Up next and the log.** `node.upNext`, the heatmap, the calendar view recipe over `Done at`.
5. **YAML, drafts and the agent.** Import and export, drafts, the operations, the bulk tagging pass.
   *Usable result:* the agent drafts a track from a pasted list or a chart image and you confirm it.
6. **Layout and visuals.** The three layouts, lit edges, the pulse, mastery rings, hover history.
   Tuned by use, so this step expects a round of changes after you have lived with it.

## Phase B: content

Written as YAML and imported through step 5, so the content is real data from the start:

- **Director goal**, nine tracks: Game design (Schreiber, Fullerton, MIT CMS.608, Brown's 100, with
  narrative folded in), Western film, Soviet film, Georgian film, Western theatre (narrative folded
  in), Russian theatre, Georgian theatre and arts, Stagecraft (the eight disciplines), and the shared
  Adler track. Theatre and film weeks become units. The curriculum page's weekly, monthly and
  quarterly rhythm becomes habits (film sheet weekly, a finished stage monthly, a jam quarterly).
- **Adler goal**: the 137 entries as one track, the radial tree above.
- **Music listener goal**: the /mu/core chart first, then the genre tree from musicgenretree.org's
  text lists. Other charts are added later, in a separate session.

Gaps in the content (unverified books, missing syllabi) are kept as a list for separate research
passes rather than filled by guessing.

## Open questions

- **Index size.** A per-entry server endpoint before the index passes a few thousand items.
- **Cross-board queries.** Whether `{…}` and `=` should get an `index` source (`count done in
  adler`). Useful, but it touches the evaluator every note uses.
- **Moving an item between boards.** The index follows `itemId`, so a move is safe; a copy must mint
  a new id. Needs a test around paste and the board-move queue.
- **Performance at /mu/ scale.** Collapsed parents and views should keep a board readable; another
  thread is working on canvas performance, so step 6 re-measures before any special-casing.
- **Licence of imported lists.** musicgenretree.org states no licence. Fine for personal use; an
  exported tree containing its lists should not be published.
