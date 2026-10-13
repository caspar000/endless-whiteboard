# Lifeboard on a phone

Agreed with the user on 2026-10-13, from their wireframe (a menu button, the tabs and an AI button across
the top; a floating action bar at the bottom whose "other" button pops a second bar out above it) and two
reference screenshots to take inspiration from, translated into our own design system.

## Scope

- The phone layout applies **below 768px**, portrait and landscape. Tablets and desktop are unchanged.
- Our tokens and surfaces only (`lb-float`, the accent, light and dark); no new palette.
- The top bar and the dock keep inside `env(safe-area-inset-*)`; the board runs edge to edge beneath.

## Top bar: menu · board · AI

- **Menu** (left circle) opens the sidebar as a **floating card**: inset from the edges, rounded, above the
  dock, the board dimmed behind. Picking anything, or tapping outside, closes it. It has a **search**
  button that opens the palette (⌘K) full width at the top — the only way to it without a keyboard.
- **Board pill** (middle): the open board's badge and name. Tapping it lists the open boards (badge, name,
  ✕ to close), then **+ New board** and **All boards**. It replaces the tab strip and its "+".
- **AI** (right circle) opens the agent panel as the same floating card, from the right. With the
  keyboard up, it shrinks to the visual viewport so the composer stays above the keyboard.

## Dock: [Hand⇄Select] [Sticky] [Pen⇄Eraser] [Shapes] [Text] [More]

- **Hand is the default on phones**, every time a board opens. In Hand nothing on the board changes: pan
  and zoom only, plus taps that only read — links, opening a book, Quick look. Ticking a checkbox,
  editing and moving need Select.
- **Hand⇄Select** is one button showing the mode a tap gives. While a drawing tool is on, a tap returns
  to the mode you were in before it.
- **After creating** a sticky, shape or text (after typing, for sticky and text) the tool returns to the
  mode you came from: Hand, unless you were in Select.
- **Pen⇄Eraser**: tapping Pen while it is on switches to Eraser, and back.
- **Long press** on a shape in Hand switches to Select, selects it and opens its menu: a deliberate way in.
- **More** opens a row above the dock: Frame, Relation, Image, Nodes, Relation view, Tracing lens, Dice.
  Once a tool from it is picked, the More button wears that tool's icon, highlighted.
- **Above the dock, one row at a time**: the More row while open, else the selection bar (pinned there on
  phones while something is selected), else the tool's settings. Rows too long for the screen scroll
  sideways.
- **Dice** open in the More row's place. The **node picker** is a full-width card, two columns.

## Pages

- Home: **two columns** of cards.
- Settings and Help: the side rail becomes a **row of chips** scrolling sideways above the content.
- Help gets an **On a phone** section.

## Phases

Stop after each with phone-size screenshots and phone-size e2e tests.

1. **Chrome**: top bar, board switcher, floating menu with search, AI card from the right, safe areas.
2. **Dock and Hand mode**: the two toggles, Hand by default, back to Hand after creating, reading taps,
   More and its row, dice, the rows above the dock, the node picker, long press. Worth deploying for the
   user to try on a real phone.
3. **Pages**: home grid, Settings and Help chips, the pinned selection bar.

The final deploy needs the full suite green.
