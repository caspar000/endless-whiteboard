# Property display plan

Agreed 2026-10-14. Replaces the `name … value` strip with a property **card** that hangs under every
node, shown in one of two modes you toggle per node.

## What was decided

**The card.** Properties always render as a separate card below the node, never inside it, notes and
quotes included. The card follows the node, but arrows, snapping, the selection box and zoom-to-fit
see the node alone. It draws above shapes, centred under the node, 240 board units wide by default
(`fit` for arrows). Width options: fixed, `fit`, `full` (the node's width). Clicking or dragging the
card selects and moves its node; links on it stay clickable. Kanban and calendar lanes reserve the
card's height when they stack nodes. A card with nothing to show is not drawn.

**Two modes, per node.** Stored in shape meta as `lifeboard:propView`. Absent means display mode.

- **Source**: every property as a labelled `name … value` row, the strip as it was.
- **Display**: the node's layout. A node with no layout uses the automatic one: select and status
  as badges, one value-only meta line (names in the tooltip), multiSelect as chips, progress as a bar,
  in panel order. Empty values are hidden all the way up: element, row, card.

Toggle with ⌘K ("Show property source / display"), `alt+shift+p`, or the shape's context menu. It
acts on the whole selection. The panel's per-node hide eye applies to source mode and the automatic
layout; an explicit layout ignores it.

**Layouts are per node.** Each node owns a copy of its layout. Nothing is shared by reference.

- A layout is a stack of **rows**. A row's height follows its content. Each row has `left`,
  `center` and `right` slots and a vertical alignment (`middle` by default; `top`, `bottom`,
  `baseline`).
- A slot holds one element or a list that flows inline:
  - **property**, shown as text, badge, chip, icon, bar, stars or checkbox where the type allows.
    Options: size `s`/`m`/`l`/`xl`, weight `regular`/`bold`, show name (default off), format
    (currency symbol, decimals, date style). A link shown as an icon uses the favicon and opens the URL.
  - **table**: chosen properties as a labelled two-column table.
  - **separator**: a horizontal line.
  - **text**: a fixed label.
- Properties are referenced by name in YAML and stored by id, so renames don't break layouts.
- In YAML, formatting keys sit on the element (`{ property: Price, decimals: 0, symbol: false }`),
  show name is `showName: true`, and a row can be shorthand: `separator`, `table: [A, B]`, or a bare
  element meaning its left slot. Stored as JSON in shape meta under `lifeboard:propLayout`.

```yaml
width: 260            # or: fit, full
rows:
  - center: { property: Price, size: xl, weight: bold }
    right:  { property: Link, as: icon }
  - left:   { property: Description, size: s }
  - separator
  - left:
      - { property: Type, as: badge }
      - { property: Status, as: badge }
  - table: [Weight, Colour, Material]
```

**Editing.** A Display tab in the properties popover (the current list becomes the Data tab) builds
layouts by hand. A YAML editor opens from the same tab and edits the same data; the node's real card
updates live. Invalid YAML keeps the last valid layout and shows the error with its line number.
Phones render cards but don't edit layouts in v1.

**Reuse.** A vault-wide layout library. Saving snapshots a layout; applying copies it onto every
selected node. Copy and paste layout between nodes. Selecting several nodes with identical layouts
edits them all; differing layouts show "Mixed layouts" with "Use this node's layout on all".

## Phases

Stop and report after each. Phase 1 done 2026-10-14 (d682a67). Phase 2 done 2026-10-14.

1. **The card.** Every node's properties move into a card below it (the note and quote lose their
   inline strips, the `strips` option on node definitions goes away). Card styling, placement, width
   240 centred (`fit` on arrows), drawn above shapes, hidden when empty. Pointer events on the card
   act on the node. Lanes reserve the card's height. The source/display toggle (⌘K, `alt+shift+p`,
   context menu). Display mode uses the automatic layout.
2. **Layouts.** The rows/slots/elements model in node meta, validation, the renderer, and the YAML
   editor with live updates.
3. **The Display tab.** The layout panel, editing several nodes at once, "Mixed layouts".
4. **Reuse and reach.** The vault-wide library, apply to selection, copy and paste layout, a `layout`
   field on the agent's tools, and the Help, README and ⌘K entries.

## Not in v1

Shared layouts by reference. Free positioning. Images, spacers and per-element colour. Cards drawn at
their node's depth (they overlap shapes below for now). Thinning out when zoomed out: the card
renders the same at every zoom.
