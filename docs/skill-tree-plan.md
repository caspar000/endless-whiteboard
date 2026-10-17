# Skill trees and syllabi: implementation plan

Agreed 2026-10-17. Status: **Steps 1 to 5, and step 6 except the visuals**, are built and checked
on a running board: layout, trees in the vault, views across boards, pillars and the Mastery demo.
Step 6b (lit edges, the pulse, hover history) and Phase B remain. The "as built" notes below say
where the build diverged from the plan and why.

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
  (`EvidenceEntry`), persisted as `syllabusItems`, `syllabusTracks` and `syllabusEvidence`. The index
  every evaluator reads is now derived from them, so it is never out of date and is no longer stored.
  A parent's tick and day are worked out from its works.
- **Ticks are vault data**, so ⌘Z does not untick: ticking again does. The write-up note a tick files
  is an ordinary note, beside what you ticked from, and undoes like one.
- **Import** merges a document into the vault (`syllabusMerge.ts`, pure) and puts only the tree and
  habit cards on the board: /mu/core imports in 0.4 s instead of 6, and the board holds 101 nodes, not
  2,500 shapes. New items and tracks are drafts of the importing board (`draft` holds its id) until
  Confirm draft; Discard removes them.
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
- **Shape:** one track, "/mu/core", of 84 family units in chart order ("Rock: Metal"), each holding
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

### Pillars and the Mastery demo, as built

- **YAML:** `trees:` holds several trees in one document (each after the first needs an `id`), and
  any tree can say `mount: <node>` (qualified with the goal unless it has a `/`). A tree mounted on a
  node of the same document gets no header; its name, goal and mount travel on its draft nodes
  (meta `lifeboard:skillTreeMeta`) and reach the vault on Confirm. The document is laid out whole
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
- **Commands:** Import syllabus YAML from the clipboard, Copy a syllabus as YAML, Confirm draft,
  Discard draft. A dropped `.yaml` or `.yml` file is imported where it lands.
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
        title: Plato, Dialogues
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
