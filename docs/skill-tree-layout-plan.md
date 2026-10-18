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

