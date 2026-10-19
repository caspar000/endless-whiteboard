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

`tree/compact.ts` (the greedy layout) is replaced.

## Test board

A dev command, "Insert the whole-life test board": the user at the centre with the five pillars,
Director on Practical, Adler on Mental, and simple test trees: calisthenics, kettlebells and diet on
Physical; meditation on Spiritual, sharing a node with Mental; tabletop campaigns on Social. µ/core
is left out. The user will rewrite the test trees once the layout is right.

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
