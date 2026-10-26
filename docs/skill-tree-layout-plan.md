# Whole-life skill tree layout

Agreed with the user on 2026-10-18, after two generated layouts (stacked columns, then a greedy
compact one) that didn't look cohesive. The reference is Path of Exile's passive tree: a root in the
middle, regions going out from it in a structured way, clusters of small nodes on orbits round their
centre, straight paths outward and arcs along the orbits.

## What it is for

- **The whole-life board**: the user at the centre, five pillars round them (Physical, Mental,
  Spiritual, Practical, Social), every tree hanging from its pillar.
- A board that shows a tree from another root (µ/core, which won't sit under a pillar) uses the same
  algorithm with that root in the middle.
- Node sizes stay as they are; only the layout changes.

## Structure

- Pillars go clockwise in the order the YAML lists them, the first at the top.
- Each pillar owns a slice of the disc in proportion to what it holds, at least about 40°. Practical
  is expected to be the biggest.
- Each tree owns a sub-slice of its pillar's slice.
- Rings: the first levels (the centre, the pillars, the tree roots) are shared across the board;
  beyond them each slice spaces its own rings.
- A skill node is a cluster centre. Its entries sit on up to three orbits round it, each offset half
  a step from the one inside, joined to it by spokes.
- An entry's works chain along a small orbit round it in track order (entry → first work → next).
  To be judged when seen.
- Lines: straight outward, arcs along orbits. Faint guide circles: decided in phase 4.

## Sharing

- A skill node may require nodes of another tree. It sits on the border between the slices it joins.
- An entry tagged to two skill nodes is drawn once, with a faint line to its second node.

## Views

- Two: everything (the default) and skill nodes only. The skill-node view is the same skeleton of
  slices and rings without the clusters, packed tighter.
- Focus mode is removed, to be redesigned from scratch later.
- The header card is hidden on every board (kept as data, with a setting to show it again).
  Switching views is in ⌘K and on a key. The test board has no habit cards.

## Stability

- Adding entries or works lays out only their own cluster again.
- A structural change (a new tree, shared node or pillar, a tree moved to another pillar) marks the
  layout out of date; Re-calculate lays it out again. Nothing reflows on its own.
- A view with nothing left to show is never out of date. Deleting the last of a view's nodes deletes
  its hidden header in the same undo step (`treeSync.ts`, `dropEmptyHeaders`).

`tree/compact.ts` (the greedy layout) is replaced.

## Test board

A dev command, "Insert the whole-life test board": the user at the centre with the five pillars,
Director on Practical, Adler on Mental, and simple test trees: calisthenics, kettlebells and diet on
Physical; meditation on Spiritual, sharing a node with Mental; tabletop campaigns on Social. µ/core
is left out. The user will rewrite the test trees once the layout is right.

Since 2026-10-25 it is a test fixture, not a command: Film, Theatre and Games replace Director on
Practical, and the e2e suite inserts it through `window.lifeboardWholeLifeTest`, which exists only in
a browser under Playwright (`packages/syllabus/src/wholeLifeTest.ts`, `apps/web/e2e/fixtures/fourTrees.ts`). Its
documents are `packages/syllabus/fixtures/whole-life-test.yaml` and the syllabi in `syllabi/`.

## Phases

Stop after each for the user to look.

1. **Data and test board.** Requirements across trees, the test trees and command, the hidden
   header, switching views from ⌘K and a key, focus mode removed.
2. **Skeleton.** The centre, pillars, tree roots and skill nodes on slices and rings, clusters as
   plain discs.
3. **Clusters.** Entries on orbits, works chained.
4. **Lines.** Arcs and straight lines; the guide circles.
5. **Stability.** Laying out only a changed cluster, the out-of-date marker, the faint line for an
   entry's second tag.

## Progress

**Phase 1 done, 2026-10-18.** A prerequisite may name another tree's node (`treeGraph` collects all
nodes before edges; `evaluateTree` asks the owning tree through `outside`; the arrow is the
dependent node's tree's, redrawn with either). `content/whole-life-test.yaml` and "Insert the
whole-life test board (dev)" (`tree/wholeLifeTest.ts`, dev builds only): 9 trees, 116 skill nodes,
1368 entries and works on one view, Mastery's. Headers are hidden by `shapeVisibility` unless
Settings › Show tree headers; a hidden one takes no room in the layout. `Show all nodes or only
skill nodes` (Shift+E) switches every view on the board; an import opens on everything. Focus mode
is gone: `tree/focus.ts` became `tree/view.ts`, migration `DropFocus` turns a stored focus into
everything, double-click on a skill node edits it.

**Phase 2 done, 2026-10-18.** `tree/wholeLayout.ts` lays both views out, replacing `compact.ts`
and the graph layout of the skill-node view. Slices are shared by the angle each branch needs at
its ring (its own width there, or its children's side by side), not by how much it holds: shared by
content, a branch of small leaves got a sliver and was pushed far out. Rings: one each for the
pillars and the tree roots; past them, each node's children share an arc, so one big cluster no
longer drags its whole tree out. A ring moves out only when what is on it doesn't fit its slice,
repeated until all fit. Then `tree/pullIn.ts` slides each branch toward its parent while nothing
overlaps and no arrow crosses more nodes than before. Shared nodes sit between their parents.
Other shapes on the board are no longer worked around.

On the test board: skill nodes 4649×2804 px (15.7% covered), everything 15500×12892 (5.1%), nothing
overlapping. Clusters are still placeholder rings round their node, so arrows run through their
own cluster and the everything view is loose; phase 3.

**Phase 3 done, 2026-10-18.** `tree/orbits.ts` lays a cluster out: entries round the first orbit
in track order, each as close after the last as it fits, with a gap where each of the skill
node's arrows leaves. When they don't all fit, the families with the fewest works stay on the first
orbit and the rest go on a second, one in each gap between two first-orbit families so its spoke
passes between them; the first orbit widens until there are enough usable gaps. An entry's works go
along an arc on its far side (95° either way of straight out), and a long list turns back along a
second arc further out. Arrow directions are only known once the skeleton is placed, so clusters
are packed with gaps spread evenly, the skeleton placed, packed again with the real gaps, and the
skeleton placed again; the pull-in slides along arrows, so their directions survive it.

On the test board: skill arrows through a node 162 → 13 to 19, nothing overlapping, the everything
view about 21000×15500 px (the clusters are rings with empty middles, like PoE's). The light lines
are still drawn from an entry to each work; phase 4 chains them.

**Between phases 3 and 4, at the user's ask:** works are round, a 60 px disc with the icon of its
medium (a dialogue of Plato's takes its entry's) and the title below, in a 120×100 box; the tree's
checkboxes went, and right-click › Mark as done (or not done) ticks a work or an entry without works.

**Phase 4 done, 2026-10-18.** `tree/lines.ts`: a skill node has a spoke to each entry, and an entry's
works hang from it in a chain in track order (entry → first work → next). A link between two works
about as far from their entry bends along the arc round it (`arcBend`, the canvas's bend); a step
out to the next arc stays straight. `tidyLines` sets the bends after a layout, a sync that drew
lines and a drag coming to rest, and runs each line's ends exactly to its disc's middle, under the
node, instead of stopping at the edge of the node's box. Light lines through a node on the test
board: 547 → 1. Arrows between skill nodes are straight; 37 of 124 still cross a node, mostly links
between branches. Guide circles: for the user to decide.

**Phase 5 done, 2026-10-18.** New entries and works lay out only their own skill node's cluster
again where it is (`repackClusters`, orbits.ts); new skill nodes go beside a neighbour. Every full
layout records the view's structure on its header (`structureOf`: its skill nodes and the arrows
between them); when that changes, or a repacked cluster came out bigger than it was, the header is
out of date. The sync and Re-calculate keep the out-of-date headers in a per-board atom
(`staleViews`), which the overlay `tree/StaleLayout.tsx` reads: "The tree's layout is out of date ·
Re-calculate". ⌘K has `Re-calculate the tree layout`. An entry tagged to more skill nodes in view
gets a faint dotted violet line to each of the others (62 on the test board). No guide circles: the
user liked the render without them.

Checked in Chromium: no note after inserting the test board; deleting a skill node brings it up;
Re-calculate (button or ⌘K) clears it; importing an entry with a work puts both in their cluster
(on its first orbit) and moves nothing else.

## Compaction (2026-10-18, after phase 5)

The user found the board still mostly empty space: clusters right, the whole loose. Researched how
others pack a layout tighter without breaking its structure:

- **Overlap removal that keeps the layout**: PRISM (Gansner & Hu, stress on a Delaunay proximity
  graph), VPSC (Dwyer, Marriott & Stuckey, least squares with separation constraints; distorts more),
  GTree (Nachmanson et al., grows a minimum spanning tree of the Delaunay triangulation), FORBID
  (stress on all pairs by stochastic gradient descent, binary search on scale; best balance of
  compactness and preservation in its comparison).
- **Compaction**: Graphviz `overlap=compress` (scale down until the first contact, keeps orthogonal
  order; stops at the tightest pair), and ELK's SPOrE **ShrinkTree**: GTree backwards, contracting a
  spanning tree of the proximity graph so each piece moves toward its nearest neighbour.
- **Packing separate pieces**: polyomino packing (Freivalds, Doğrusöz & Kikusts; Graphviz `pack`,
  fCoSE), irregular nesting with no-fit polygons (SVGnest, Deepnest). Tightest, but they place pieces
  anew, so the tree's structure is lost.
- **Clustered layouts**: IPSep-CoLa / WebCola (stress with non-overlap and cluster constraints; its
  clusters aren't rigid, so ours would be bent out of shape), Group-in-a-Box (treemap boxes; loses the
  radial structure), circle packing (Wang et al.; circles waste the corners).
- **Machine learning**: DeepGD and SmartGD learn general aesthetics (stress, crossings) from
  examples; nothing for rigid clusters or packing, and they need training data. Not a fit.
- **Physics engines** (Matter.js, Planck.js, Rapier): rigid compound bodies under gravity would pack,
  but arrows are invisible to them and the result depends on the run.

**As built** (`tree/pullIn.ts`, after the skeleton): first each branch slides toward its parent;
then **gravity**: every skill node's branch, whole, farthest first, moves toward the start (straight
in, else up to 60° to either side) as far as it fits, never nearer the start than the node it hangs
from; then **ShrinkTree** over whole clusters: a minimum spanning tree of the gaps between their
nearest nodes, rooted at the start, each cluster sliding along its edge toward its neighbour with
everything beyond it, up to four rounds. Every move: nothing overlaps, and no arrow crosses more
skill nodes than before (it may pass under entries and works; arrows between skill nodes are drawn
under the nodes now). In `orbits.ts` each family on a second orbit finds its own distance instead of
all sharing the farthest one.

Test board, everything view: 26113×24341 px (2.8% covered) → 11983×12905 (11.3%); arrows through a
skill node 2. Considered next: FORBID-style stress compaction (scale down, then remove overlaps by
stress) for the last few per cent, at the cost of a slower layout.

## Tuning, and the next algorithm (2026-10-18)

**Built:** every number of the layout is a setting (`tree/layoutConfig.ts`, per device in
localStorage): sizes, skeleton (room round the middle, gap between clusters, narrowest pillar slice,
shared rings), clusters (member space, gate and spoke room, works arc, orbit growth) and compaction
(each pass on or off, least space while compacting, rounds, how far gravity may veer, and which
crossings a move may not make worse). "Add the layout tuner (dev)" puts a card with all of them on
the board; a change lays every view out again, and the card shows the result (`tree/layoutStats.ts`:
size, cover, arrows crossing arrows, arrows through skill nodes, arrow lengths, overlaps, time).
Copy settings puts them on the clipboard as JSON.

**Agreed next** (the user's sketch, refined): measure subtrees bottom-up, order siblings so related
nodes sit together (try every order for small families), place top-down within wedges at no more
than a maximum arrow length, shared nodes on the border between their parents, then repair any
crossings with bounded local moves. Compaction stays, under a minimum spacing. Each view is laid out
on its own by the same algorithm. Each new step joins the tuner as a setting.

## Crossings made visible to the layout (2026-10-18)

The user found arrows over light lines and over orbits of works next to open space. Causes: the
packing counted only arrows through nodes (skill nodes by default), never arrows over light lines or
other arrows; each cluster's gaps faced where its arrows went before compaction moved it; ShrinkTree
could stretch arrows without limit; and the "middle" rule allowed arrows over entries and works.

Built: every compaction move is judged by every crossing (an arrow over a node, a light line or
another arrow; `arrowRule` 'all', the new default) and by the longest arrow (`maxArrow`, 600: a move
may not stretch an arrow past it further than it already is); last, each cluster is laid out again
with its gaps toward its arrows, or turned whole, whichever crosses least (`reorientClusters`). The
grid now walks bigger cells, each once per query.

Adler board, old rules → now: arrows over works 31 → 2, over light lines 37 → 4, arrow over arrow
1 → 1, through skill nodes 0 → 0; 5629×6193 px (17.9%) → 6519×8043 (11.9%); 0.36 s. The full test
board: 2.8 s. Left: 17 of 56 arrows are longer than 600 px, most made by the skeleton itself (it
spaces rings from the middle, not from each parent), and the longest are cross-links. That is phase
B: placement from the parent within wedges, and sibling ordering.


## Phase B, step 2: placing each node from its parent (2026-10-18)

Step 1 (sibling ordering) was folded into this one. The four-tree test board (You, the pillars,
Adler, Film, Theatre and Games) has 2 cross-links among its 132 arrows, so ordering siblings by them
changes next to nothing there. Children keep the YAML's order.

Built: `tree/balloon.ts`, a balloon layout, now the default (`placement`, with the old rings still
there as `rings`). Bottom-up, each branch is laid out on its own, its node at the origin and the
branch growing outward. A node's children are swept round it in order, each at the least angle at
which its whole branch clears what is already placed. All of them sit at one distance, as short as
the fan (`fanSpread`, 240°) allows: it grows only while they don't fit, and past `maxArrow` (here,
space beyond the clusters touching) only if they don't fit at all. Top-down, each branch is turned
to point away from its parent. The pillars stay on one ring round You, the first at the top, at
least `minSlice` apart, sharing the spare angle evenly. Every branch clears its siblings' whole
branches, so nothing overlaps by construction; compaction runs after it as before.

Four-tree board, rings → from the parent: mean arrow 1695 → 788 px, longest 8135 → 5335, total
length 224k → 104k, 6.8 s → 1.8 s, fill 6.1% → 8.9%, overlaps 0 → 0. Crossings went up: arrows over
entries or works 1 → 10, over light lines 3 → 8, arrow over arrow 0 → 3, through a skill node 0 → 1.
Fan spreads from 160° to 320° all come out within a few percent of each other.

Left: the arrow from You to a pillar carrying big trees is long, as that pillar's whole branch has
to clear the middle. Arrows are still at least two cluster radii long, about 700 px between big
clusters, unless compaction nests clusters in each other's gaps. The new crossings are step 3's:
repair with bounded local moves.

## Phase B, step 3: repairing crossings (2026-10-18)

Built, in `tree/balloon.ts` and `tree/pullIn.ts`:

- **Gaps facing the final skeleton.** Most new crossings came from the balloon itself: a node moves
  whenever a cluster before it in the sweep changes size, so clusters packed toward one skeleton had
  their gaps facing where the arrows used to come in. Packing and placing now repeat until no cluster
  grows (at most five rounds). Arrows over items in the bare skeleton: 52 → 13.
- **Sweeps that keep off arrows.** A child's branch is kept off its siblings' arrows and never across
  them, and its own arrow off and never across what is already placed.
- **Sibling order by cross-links** (step 1, after all): two children whose branches a cross-link
  joins are brought next to each other, every order tried for a family of up to seven.
- **The repair pass** (`repairCrossings`), run before compaction while there is room and again at
  the end. For each arrow that runs over a node, a light line or another arrow, it tries, kept only
  if fewer crossings are left and nothing is covered, crowded or stretched past the longest arrow:
  turning a branch at either end, or the branch of what it runs over, up to 40° about its parent; a
  cluster about its skill node; an entry with its works about its skill node, or its works about the
  entry, up to 180°; and an entry swapped round its skill node with another entry's family.
- **Keeping branches off the arrow into them** (`keepWayBack`) is there as a setting, off: it needs
  arrows 600 to 1500 px longer on the families with big branches, for no fewer crossings here.

Four-tree board, rings → from the parent with all of this: arrow over arrow 0 → 2, through a skill
node 0 → 0, over items 0 → 1, over light lines 1 → 2; mean arrow 1791 → 828 px, total length 236k →
109k, longest 7771 → 4502, fill 6.0% → 7.7%, 7.4 s → 2.9 s. The whole-life board: 8/1/1/0 → 7/1/2/1,
fill 5.3% → 8.4%. The skill-node view: 5/1/0/0 → 5/1/0/0.

Left: the two arrow crossings are a branch curling back over the arrow into its own tree (Film's
weeks over You → Practical; Games' close reading over Practical → Games). The repair can't turn them
clear without covering a neighbour, and keeping the way back clear costs more than it saves.

## Bands (2026-10-19, the user's sketch)

The user found the balloon reads as random: families fan up to 240° round their node, so further out
no longer means deeper, and Practical's three trees don't read as three branches. Their sketch:
concentric borders, one per level, clusters filling a band sideways before anything goes outward.

Built as `placement: 'bands'` (`tree/bands.ts`), a radial tidy tree: pillars on a ring round You,
each family on an arc of its own one step further out than its parent, every branch one unbroken
wedge in YAML order, the parent centred over its children (Reingold–Tilford in angles). Outlines are
the angle a branch covers in each 100 px strip round You, nodes and arrows, so neighbours tuck in as
close as the real geometry allows. A family fanning wider than `bandFan` (90°) splits into staggered
rows (`bandRows`, 3). Where a strip is too full, the families on its innermost arcs move out a step.

First tried with one ring per level across the whole board, as sketched: 31,000 × 39,500 px, fill
1.7%, mean arrow 3750 px. One ring per level has to hold every cluster on that level all the way
round, and Adler is about 17 levels deep, so the outer bands reach far for one tree.

Per-family arcs, four-tree board: no crossings at all (0/0/0/0), but 29,500 × 32,800 px, fill 2.1%,
mean arrow 2315 px, and the pillars pushed out to 6700 px. The trees are bushy close to their roots
(the Play List's 10 schools, World Canon's 9, Adler's 8), each a big cluster, and a wedge has to fit
them near the middle, where there is least room round.

For comparison, the balloon with `fanSpread` 150° and no gravity or ShrinkTree: 23,200 × 21,800,
fill 4%, mean arrow 975, crossings 2/0/1/2; with them on: 14,900 × 16,100, fill 8.5%, mean 824.

**Shared bands and the band guides (2026-10-19).** At the user's ask, bands are back to the sketch:
one border per level for the whole board (`tree/bands.ts`), and bands are the default placement;
with them, sliding to the parent, gravity and ShrinkTree stay off, as they would pull nodes out of
their bands. Borders can be set by hand (`bandBorders`): a set border stays where it is, however
crowded its band, and what doesn't fit overlaps; a border left to the layout sits one row of its
band's biggest cluster out from the one inside it, and while the wedges don't fit round, the
innermost band they overrun moves out a row. "Show or hide the band guides (dev)", or the switch in
the layout tuner, draws every border on the board in its own colour with its level, radius and how
full it is (red when over 100% or thinner than its biggest cluster), rings in red the skill nodes
whose clusters overlap, and lets a border be dragged in or out; the board is laid out again as it
moves. "Reset band borders" in the tuner hands them back to the layout.

**Fixed borders (2026-10-19).** The user: the circles are the constraint, they must not grow; nodes
move round inside them. Borders now default to 750, 1000 and 2500 px, then 1500 px more each
(`bandFirst`, `bandSecond`, `bandThird`, `bandStep`), and never move by themselves. Placement
changed with it: each node gets a slice (the pillars' in proportion to what grows from each, every
node's shared among its children the same way) and would like to sit in its middle; band by band
from the middle out, the band's nodes keep their order and move round as little as they can until
none touches the next (least squares, pool-adjacent-violators), each child following its parent's
move. A band too full for one row staggers its nodes over as many rows as its thickness holds
(`bandRows`); what still doesn't fit overlaps, and the guides ring it. In bands nothing turns or
pushes a branch afterwards (it would leave its band); clusters still turn about their own node.
Four-tree board: 19,074 × 13,832 px, fill 7.8%; bands 3, 4 and 5 are 124%, 199% and 123% full,
so 89 skill nodes overlap.

**Regions and expand circles (2026-10-19, the user's second sketch).** Spilling crowded nodes out a
band, tried first, made arrows cross more (447–736 crossings against 250): spilled nodes landed far
round from their parents. Replaced by the sketch: each pillar has a region round You in proportion
to what grows from it; each node's children go inside an expand circle that starts at the node and
reaches straight out from You (`expandRadius`, 1200), on the next band's arc inside it, side by side
and centred on the parent; a family too wide for that arc alternates between it and the next band's
(`bandRows`, 2), never a band further in, and only then does the circle grow, to twice its radius
at most. Band by band, families meeting in a band are then packed round in the tree's order. The
guides draw the region lines and, if asked, every expand circle. Four-tree board at the default
borders: arrow over arrow 248 → 42, through a skill node 26 → 12, over items 59 → 45, over light
lines 309 → 111, no two skill nodes covering each other; 15,241 × 23,155 px.

**Cones (2026-10-19).** The user: Mental and Practical spread round into the empty pillars' regions;
each should stay in its region and widen outward as a cone. Each region's nodes in a band are now
packed only inside its arc (least squares, clipped to the arc); where the arc can't hold them, the
widest family there staggers, every other child moving out a band with its arrow between the
siblings that stay. (Moving out the nodes with least below them first, tried before, put 380 of 402
crossings on arrows that skip a band.) Four-tree board: arrow over arrow 56, through a skill node 12,
over items 44, over light lines 181; 23,339 × 21,534 px; the empty pillars' regions stay empty.

**Cones from every node (2026-10-19, the user's idea).** `placement: 'cones'` (`tree/cones.ts`):
the pillars' regions are the first cones; each node's cone is shared among its children (each its
own cluster's angle at the family's distance, the rest by how much grows below it), the family as
close as fits every child in its slice, and each child's cone starting at the child, looking the way
its slice does. Strictly nested, it can't cross or overlap, but on the four-tree board it came out
396,864 × 790,435 px: deep families got slices of 0.4–10° and had to sit up to 477,000 px out. So a
cone may widen past its slice to what its own family needs at `expandRadius` (up to 150°): 15,524 ×
20,008 px, fill 6.6%, mean arrow 1863 (the most compact yet), but 267 node boxes overlap and 89
arrows cross, as widened cones reach into their neighbours. `coneGrow` then moves the family of
each two colliding skill nodes out until none collide: 24,137 × 33,627 px, 38 overlaps, 102
crossings. Adler, alone in its region, reads as a clean tree; Practical's three trees, close to their
pillar, pile into each other. The default stays bands with region cones.

## Layout algorithms (2026-10-19, after the research pass)

Two new placements, picked in Settings › Syllabus & skill trees › Layout (and the tuner):

- **Cones, compacted** (`compactCones`, `tree/compact.ts`), after Gray et al., "A Scalable Method
  for Readable Tree Layouts" (VIS 2023): start from the strictly nested cones, which can't cross or
  overlap, then compact with every move checked against everything (no cluster on another, no tree
  arrow across another, no arrow through a cluster it doesn't end at, the open ground round You
  kept): each branch pulled in along its arrow, tried turned about its parent, and each family tried
  fanned wider round its parent and brought in together. Four-tree board: 0 overlaps, 1 arrow
  crossing, median arrow 1479 px, but three wide families stay far out (Stagecraft at 91,000 px;
  World Canon and the Play List at 25,000–27,000), so the board is 35,497 × 110,837.
- **Radial wedges** (`wedges`, `tree/wedges.ts`), in the manner of ELK Radial as its documentation
  describes it (written from that, not its code): Eades' wedges by size from You, one ring per level,
  rings moved out until nothing overlaps, then each tree's wedge pulls its own rings in, level by
  level. Four-tree board: 0 overlaps, 0 arrow crossings, but 47,752 × 45,056 px, the Play List's ten
  schools 26,000 px out on long spokes, median arrow 3340.

Bands with region cones stays the default. Both new ones keep their promises (no overlaps, next to no
crossings) but leave the widest families far out; what each needs next is a way for a wide family to
spread sideways instead of out.

**Cones, compacted, node by node (2026-10-19).** After the branch pulls and family fans, a force pass
in the manner of Gray et al.'s refinement: arrows pull their ends toward a short length (the child
harder), near nodes push apart, You and the pillars stay; each node moves alone, a cooling step at a
time, and when the straight way is blocked it slides round at 30° and 60°. Every move is kept only
if it breaks no more rules than before (clusters on each other, tree arrows across each other,
arrows through clusters), so a node already caught on something can still move to get free; the
absolute rule left such nodes stuck for good. Only the final skeleton is compacted (the first,
which only places the clusters' gaps, uses the strict cones): 4.2 s instead of 26. Four-tree board:
27,025 × 36,531 px, mean arrow 1884, 1 arrow crossing, 9 overlapping boxes; the core is compact and
reads as trees, but five leaves (two of the Play List's, three of Stagecraft's) stay far out.

**Jumps (2026-10-19).** After the force pass, a node whose arrow is still twice its resting length
or more jumps with its whole branch to the spot round its parent nearest to it (every 10°, at its
resting distance or ring by ring further out), if that puts nothing on anything and crosses nothing
more than where it is; it may run one more arrow over a cluster if the jump at least halves the
arrow (the Play List's Systems and Horror found no spot that broke nothing). A short force pass then
settles the rest. Four-tree board: 16,004 × 22,812 px, fill 5.6%, mean arrow 1317, longest 6579,
1 arrow crossing, 1 through a skill node, 7 overlapping boxes, 5.8 s; no stragglers left.

**Bubbles (2026-10-19).** Two more placements. `bubbles` (`tree/bubbles.ts`), after Grivet, Auber,
Domenger and Melançon's Bubble Tree (2004), built from its published idea (the paper itself wouldn't
load): every subtree in a circle; a node's children's bubbles packed round it in a fan centred straight
out, each child at the near edge of its own bubble, on the line from the parent to the bubble's
centre; the node's bubble the smallest circle round its cluster and theirs. Planar and overlap-free
by construction, balanced, but loose: 56,328 × 30,889 px at a 330° fan (75,254 × 44,179 at 240°).
`compactBubbles` starts the cones' compaction (tree/compact.ts) from the bubbles instead of the
strict cones, a far better start: 25,215 × 15,423 px, fill 5.3%, mean arrow 1126, longest 7244,
0 arrow crossings, 0 through skill nodes, 20 over items, 15 over light lines, 0 overlaps, 5.4 s —
the best on nearly every count so far.

**Default (2026-10-19).** At the user's word, "Bubbles, compacted" is the default placement. The
test board inserts in about 7.7 s in the app, the progress note showing; bands and the rest stay in
Settings and the tuner to compare.

## Curved arrows (2026-10-19, the user's idea)

Once a view is laid out and its arrows drawn, every arrow between skill nodes that crosses something
straight (another arrow, a light line, a skill node, entry or work it doesn't join) is tried bent,
8% to 50% of its length either way, and keeps the gentlest bend that leaves it crossing least; two
rounds, as bending one arrow can clear or block another. Nothing moves; only the arrows' `bend`
(tree/curveArrows.ts, called from `tidyLines` and again once `syncBoard` has drawn the tree's arrows,
which happens after the views lay out). On the four-tree board with Bubbles, compacted: arrows over
entries and works 15 → 4, over light lines 17 → 6, in 41 ms; 17 of 132 arrows curved on the board.

**Evenly spaced curves (2026-10-19).** After the research's Lombardi drawings (Duncan, Eppstein,
Goodrich, Kobourov and Nöllenburg: arrows as arcs leaving each node at evenly spaced angles), the
curving also bends arrows so that at each skill node they leave as evenly spaced round it as bends
allow, traded against bending (`arrowCurve`, 0.5; 0 is dodging only). Crossings always count first;
evenness alone may bend an arrow to 30% of its length at most, deeper only to clear a crossing. The
nodes don't move, so it is evenness as far as bends allow, not a true Lombardi drawing. Four rounds;
about 0.6 s on the four-tree board, so a drag coming to rest bends again only the arrows touching what
it moved. Four-tree board: about 100 of 132 arrows gently curved, crossings as with dodging alone
(0 arrow over arrow, 0 through skill nodes, 4 over items, 5 over light lines).

**Sibling ordering (2026-10-19).** After Lin and Yen's balloon drawings: `balanceSiblings` puts each
family round its parent in organ-pipe order, biggest bubble in the middle of the fan, smallest at its
ends (the pillars keep their order). It helps plain bubbles (75,254 × 44,179 → 61,747 × 37,976 px;
arrows over items 11 → 4, over light lines 12 → 3) but not the compacted ones, which do best from the
YAML's order: organ pipe 25,358 × 19,431, fill 4.2%, 1 crossing; the reverse (biggest at the ends)
22,843 × 17,183 with 3 crossings and 4 through skill nodes; biggest first 23,149 × 17,354 with 2
crossings; the YAML's order 25,215 × 15,423, fill 5.3%, 0 crossings. So it is a tuner setting, off.

## The layout in a worker (2026-10-19)

The slow placements (compacted cones and bubbles) run in a worker (`tree/layoutWorker.ts`, through
`tree/layoutAsync.ts`): the view is laid out at once with plain bubbles (about 0.2 s, the same
structure), and the compacted layout is applied when the worker answers, with a progress note
("Laying out the board · Drawing the trees in") while the board stays usable; a layout of the view
started meanwhile makes the answer stale. The final move isn't an undo step of its own. Where there
are no workers (tests), the layout runs in place as before. For this the layout's modules no longer
import the canvas: the settings' types and defaults are in `layoutDefaults.ts` (`layoutConfig.ts`
keeps them per device), and the band report is a plain value the board publishes (`bandReport.ts`).

Also: the arrow curving checked every arrow tried against every light line's sixteen pieces, 9.8 s
a call on the test board in the browser (the lines between works are arcs there); light-line pieces
and discs now sit in a grid, 0.3 s. Inserting the four-tree test board: the board in about 5.4 s
(mostly creating its 3,490 shapes), usable from then, the compacted layout landing at about 15 s.
Not yet tried in a production build.

## Bubbles against the paper (2026-10-19)

Read against the full Bubble Tree paper (Grivet, Auber, Domenger and Melançon), four things were
tried on the four-tree test board (Adler-life), plain bubbles at the default 240° fan unless said:

| Tried | Plain bubbles | Kept |
|---|---|---|
| Before | 75.3k × 44.2k px, mean arrow 2339 px, 0 arrows through skill nodes | |
| Parent in the gap the fan leaves (the paper's dummy circle, without its bend) | 70.1k × 42.3k; at 330°, 56.9k × 31.1k, mean 1888; 0 through skill nodes at any fan | yes, plain bubbles |
| The paper's angle sharing (by radius, none past what it needs) | 48.4k × 29.4k at 330°, but 1–2 arrows through skill nodes | no |
| Children out to the same outer edge | 90.1k × 87.7k | no |
| The exact smallest enclosing circle (5,000 steps for 200) | no change | no |

The turn: each subtree is now turned so its parent is straight behind its node, in the gap its own
fan leaves, so the arrow comes in clear of the node's children however wide the fan. Before, it was
turned so the bubble's centre was straight out from the parent, which only keeps the arrow clear while
the fan is narrow (at 330°, 3 arrows went through skill nodes).

Compacted bubbles keep the old turn for their start (`bubbles(input, true)`): on top of the new one
(and of the angle sharing) compaction came out about the same, within the spread small changes to its
start give (Adler-life 22.0k × 18.7k against 25.2k × 15.4k, mean arrow 1149 against 1126), so the
layout already approved stays as it is.

## Crossings in the skill-node view (2026-10-19)

Two causes, both fixed:

- **Stale curves.** `tidyLines` returned at once on a board with no light lines, which is the
  skill-node view, so it never curved the skill arrows there: after the worker's compacted layout
  landed, and after a drag, the arrows kept the curves worked out for where things had been (one made a
  loop round a node). It now curves them either way. On the four-tree test board in the app: arrows
  through skill nodes 10 → 0–1, crossing arrows 1 → 0.
- **Arrows compaction didn't know.** Compaction checked only the tree's own arrows (each node to the
  parent it is laid out under), not a skill's second prerequisite, so it could drag one across an
  arrow it doesn't lay out. Its rules now count every drawn arrow; only the tree's pull. Four-tree
  board, skill-node view: 1 crossing → 0; the whole-life board: 9 → 2 (through skill nodes 4 → 0),
  its skill-node view 15 → 8; the four-tree board with everything about the same.

Then (same day) **arrows out of one node**: the curving never counted two arrows that share a node as
crossing, true for straight ones, but bent apart for evenness they crossed outside it (the user's
screenshots: Stagecraft, Russian Theatre, Literature, Film Craft). They now count when they cross
outside the node they share. Four-tree test board in the app, skill-node view: 8 such crossings → 0
(0 after Re-calculate too, 0 between separate arrows). With everything shown: 1 such crossing left and
7 skill arrows over a cluster's light lines, the cost of the curving trading one against another.

## The view with everything grows out of the skill-node view (2026-10-19)

The two views ran the same compaction; the difference was its input. With everything shown, each
node is its whole cluster (median radius 468 px, the largest 1,264, against 75 for a node alone),
and the rules (no cluster on another, no arrow through a cluster) jam rigid branches behind each
other: Practical → Theatre rested at 7,424 px against the 232 it needs, the whole Theatre tree unable
to come in past Film's clusters, and the jumps, sized for small nodes, couldn't move a 31-cluster
branch.

Now compact bubbles with clusters (`grownBubbles`, tree/compact.ts) is laid out and compacted first
with every node alone, as in the skill-node view, then grown: the clusters to half their size, the
board spread evenly about You just as far as stops anything overlapping (spreading evenly keeps every
angle, so nothing new crosses), compacted again, then the same to full size. Four-tree board (test
copy): 25.3k × 15.2k → 22.7k × 14.9k px, longest arrow 7,244 → 4,354, arrows through cards 23 → 15,
crossings 0 → 0. In the app: 0 crossings, laid out about 25 s after the insert (was about 15 s), in the
worker. The whole-life (Director) board: 2 crossings → 4, inherited from its skill-node view.

## Bubble guides (2026-10-19)

A dev toggle (layout tuner, or ⌘K "Show or hide the bubble guides (dev)") draws every bubble the
plain Bubbles layout reserved: the circle round each node's subtree, a colour per level, with a thin
line from the node to the circle's centre. `bubbles.ts` leaves them behind (`takeBubbleReport`, each
relative to its node, so a circle follows its node when dragged), and `viewSync` publishes them
(`lastBubbles`) when the board's layout is plain Bubbles. With any other layout the guides say so:
compacted bubbles move everything after the bubbles are placed, so the circles would mean nothing.
They show the waste plainly: a chain of single children reserves a circle as wide as the chain is
long, in every direction.

## Radial (Eades) (2026-10-19)

The "tree radial" the Bubble Tree paper compares with: Eades, "Drawing free trees" (1992), as the
Würzburg graph-visualisation lecture gives it (RadialTreeLayout). One ring per level, evenly spaced
(ring t at t·d); each node's wedge shared among its children by how many nodes each subtree holds;
past the start, a node's wedge cut to `arccos(ρ_t / ρ_t+1)` either side of it so no tree arrow
dips inside its ring, so none cross. `tree/radial.ts`, placement `radial`, "Radial (Eades)" in
Settings.

It is big, as the lecture's theorem says (area grows with most children times height): one tight
spot (a fan of 13 siblings on a deep ring) sets the spacing for every ring. Four-tree board, skill-node
view: 87.7k × 81.6k px (Bubbles 12.7k × 7.6k, Compact bubbles 4.5k × 2.8k); with everything 202k ×
188k. 0 crossings. Tried and dropped: each ring as close in as it goes (49k × 29k but feeds back:
moving a ring out narrows the cut, squeezing whole trees into thin cones, 450k × 263k with everything),
and compacting from the even radial (4.5k × 3.9k skill-node view, 21k × 23k with everything in 43 s,
and the empty pillars left far out, since compaction doesn't move pillars).

## The maze is the layout (2026-10-20)

The user chose the maze (variant D: nodes side by side) and asked for everything else to go. Removed:
compact cones and bubbles, bubbles, radial (Eades), wedges, cones, bands, fans from the parent and
rings, with what only they used: the band and bubble guides, the background worker (the maze takes
under a second), the layout stats, `balloon.ts`. The settings are now the maze's (`layoutDefaults.ts`:
hexagon size, cells to an only child, room to start from, how chains wind, cell shape, room round You),
the node sizes, the clusters' and how arrows curve; Settings shows them all under Advanced and the
layout tuner the same ones (`LayoutFields.tsx`). `pullIn` keeps only turning clusters to face their
arrows (`MAZE_PULL`).

Making the maze place every node: a fork's seeds are taken the moment they're chosen (two nodes had
landed in one cell); round You each pillar's piece grows toward its own direction (small pillars were
being wrapped round by big ones); a child left without a cell branches off its parent or its parent's
trunk into the roomiest free cell (repair); and the search tries both fork starts, a wider ring round
You and the pillars started a little further round, coarse then fine. The four-tree board's skill-node
view fits at 3.25; the older whole-life board leaves two of Director's nodes without a cell.

## The view with everything in the maze (2026-10-20, in progress)

For now each cluster takes one cell, the cells as wide as the biggest cluster past the pillars and a
gap (`mazeLayout`): every node placed and nothing overlapping on the four-tree board and the single
trees, but big (four-tree board 56k × 50k px, against 22.7k × 14.9k with compact bubbles).

Tried and set aside: footprints, a cell per middling cluster with a bigger cluster taking every cell
within some rings of its own (its children seeded where their footprints touch its). The idea holds
(the four-tree board's clusters are 73 one-cell and 57 seven-cell), but each run took 46 s and left
29 clusters without room (Theatre's Georgian branch), and the rewrite slowed the skill-node view. It
needs the fork's split to think in footprints, not cells, before it comes back.

## One maze for both views, and nothing cut off (2026-10-20)

The user: the two views follow exactly the same rules. So with everything shown, every entry and
work is a node of the maze too, a cell of its own at the same hexagon size, joined to its parent by a
corridor along the light line drawn (a spoke to each entry, a chain through its works); no clusters,
no orbits, no `pullIn`. Light lines run along their corridors like the arrows.

And no node may be cut off, by construction (`grow` in tree/maze.ts):
- every node placed sets aside a free cell beside it for each child (its door; past the free sides,
  children share a corridor cell that forks again);
- every door keeps a way of its own out to the grid's outer rim, sharing no cell with any other
  door's (vertex-disjoint paths, kept as a flow; a new door is opened only if an augmenting path
  gives it one, rerouting the others' but never dropping one);
- so a door's own cell blocks nobody, and when its node is placed, the first cell of its way out is
  free beside it: its first child always has room, the rest go through it. Only the grid's rim can
  stop a branch, and then it's grown again in a bigger grid.
- Skill nodes grow breadth first (a family gets its doors before anything deeper takes the room
  round its node); cards depth first as soon as their skill node is placed, so they settle round it.
- Two bugs on the way: chains hugging the walls were drawn to the grid's rim (it counted as a wall),
  and the hole round You counted as a way out.

Four-tree board: skill-node view 132 nodes in 13 ms, 3.5k × 3.3k px; everything 1,745 nodes in 1.7 s,
11.5k × 13.4k px; nothing left out, nothing overlapping. Still long skill corridors where a skill
node's own cards took the room before its child skill nodes got theirs.

## Big families: spread or wrap (2026-10-20)

The long skill corridors with everything shown all come from big families (Games' Canon, 11 skill
children) sitting in the knot breadth-first growth makes round You: their shared corridor forks in
turn with everything else, and the cards of the first children placed fill the room it needed.
Tried and dropped: cards waiting for child skill nodes, trunks first on their own, open cells for big
branches, soft wedges per branch. What helped: the shared corridor forking on at once and keeping
close to the family's node. The user liked both, so it's a setting, Settings › Advanced › Maze ›
Big families (`mazeFamilies`):

| Four-tree board | Spread (default) | Wrap |
|---|---|---|
| Everything, longest / 90% / median skill corridor | 52 / 27 / 4 cells | 28 / 17 / 8 |
| Everything, size | 11.5k × 13.4k px | 16.6k × 12.2k |
| Skill-node view, longest / size | 6 cells, 3.5k × 3.3k | 11, 3.8k × 4.0k |

## Arrows and lines apart; unlocked paths (2026-10-20)

An arrow ran along a card's light line wherever a node had more children than free sides: the rest
shared one corridor cell, skill nodes and cards together, so the arrows and lines went the same way
until it forked. 126 lines on the four-tree board ran along an arrow. Now:

- the overflow is bundled by kind: skill nodes onto a skill node's door, cards onto a card's (a door
  of the other kind is handed over when that kind has two);
- a node with both kinds below it keeps a second cell beside it (a spare door, with its own way out),
  held while its doors are found, for the kind that would otherwise find none;
- where a node sits in a pocket with a single way out (about 20 on the board, nothing can split them
  there), the arrow takes a lane of its own beside the lines (`laneArrows`, 12% of a cell), on the
  side it turns off to.

0 lines now run on top of an arrow.

Arrows show the way travelled (tree/arrowStyle.ts): dotted while the node they point at is ahead;
solid accent once it's unlocked; gold and thicker once the node they leave and everything below it
is unlocked. A pillar or Mastery counts as unlocked once anything below it is.

The nodes follow (tree/branch.ts, `lb-skillnode--done`): unlocked ones glow blue; a node whose
branch is finished glows gold, the same look in `--lb-star`. A skill with nothing below it would be
a finished branch as soon as it's unlocked, so it stays blue until its parent's branch is finished
too. Arrows and nodes read the same rule, from the vault's trees (whatever this board shows).

## Lines only (2026-10-20)

The arrowheads made artefacts where a route bent into a node, and tracing relations works as well on
lines. So every connection is a line: between skill nodes `l` (5px), no heads, from centre to centre
under the discs like the cards' lines (sent behind the nodes when styled, `sendLinesBack`; the
tinted discs are now solid underneath). Cards' lines thin out with distance from their skill node
(`lineScale`): an entry's 3px, then each work down its chain 2.1, 1.5, and 1.2 from there. A
finished branch is told by its colour alone now, not a thicker line.

Ahead is grey now, not dotted: where lines leave a shared corridor cell, dotted ones fell apart into
a cluster of dots out of step; solid ones part cleanly, as the cards' lines always did.
With every connection a solid line, the lane beside a card's line (`laneArrows`) went too: two lines
side by side in one corridor looked like a fault, one on top of the other looks like one line.

The lines are stacked by thickness (`sendLinesBack`): the thickest on top, so where a skill line
shares a corridor with cards' lines it covers them; at one thickness gold over accent over grey.
Restacked whenever a line is new or changes look.
The order is checked on every sync and put right when it isn't so (a board styled before a change
kept its old order). Lines kept behind the nodes draw no halo (canvas `ArrowShapeUtil`): a thin line
over a thick one cut dark seams into it, and where lines meet nothing needs one.
