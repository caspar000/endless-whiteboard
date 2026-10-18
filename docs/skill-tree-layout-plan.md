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
