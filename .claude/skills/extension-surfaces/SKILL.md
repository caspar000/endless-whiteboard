---
name: extension-surfaces
description: Use when adding or substantially changing a Lifeboard extension, node type, command, operation, file import, or shape action — anything that gives the user a new thing to do. Lists every surface a contribution has to reach (composition root, ⌘K palette, Help page, README) so none is silently skipped, and says which ones are generated and need no work.
---

# Wiring an extension into every surface it should appear in

A contribution that works but is undiscoverable is half done. The app has several places that answer
"what can I do here?", and only some of them are generated from the registries — the rest are written
by hand and go stale the moment someone forgets them. This is the list.

Work through it in order. Skip a step only when the reason is written down in the PR, not because it
felt optional.

## 1. The extension itself

- The package lives in `packages/<name>/` and reaches the host **only** through `@lifeboard/node-kit`'s
  barrel. An extension importing from `apps/web` is a bug, not a shortcut — this is the same door a
  third-party plugin comes through later.
- Export one `Extension` (`packages/node-kit/src/extensions.ts` has the type). Fill in `description`
  **and** `details`: the card in Settings → Extensions shows the first, the extension's own page shows
  the second, and a missing `details` leaves that page thin.
- Node types need their `shape-types.ts` side-effect module imported from the package barrel, or
  tldraw's schema never learns the type.

## 2. Register it — `apps/web/src/extensions.ts`

One `registerExtension(...)` line, above the `registerNodeCommands()` call that projects the finished
node registry onto the command table. Nothing about the extension exists until this line does.

## 3. ⌘K — `packages/node-kit/src/commands.ts` is the one table

**Generated for free:** an `Add <node>` command per registered node type (`canvas/insertNode.ts`), and
every command's keybinding row on the Help page's shortcut list. Do not hand-write either.

**You must write:** anything generation cannot know — how content arrives from *outside* the app (a
file picker, an import), and any verb that only means something with a shape selected. Put them on
the extension's `commands`; they are hidden with it when it is disabled.

- `group` is a **string by value** (`'Insert'`, or your own), because a package must not import the
  app's `paletteItems.ts`. An unrecognised group renders as its own trailing section, which is fine.
- `when` decides whether the command is *offered*, not whether it works. A verb that needs one
  selected shape must check for exactly that.
- If agents should be able to drive it too, that is an `operation` (`node-kit/src/operations.ts`), not
  a command. Contributing an operation contributes an MCP tool — the server needs no edit.

## 4. The Help page — `apps/web/src/app/help/`

The one surface with no generation behind it at all. A new extension gets:

- A section file in `sections/<Name>.tsx` and an entry in `sections.tsx` under the `Extensions` group.
  The `id` is the URL (`#/help/books`), so treat it as public.
- **`sections/Overview.tsx`** — its `DOCK_GROUPS` mirrors `canvas/CanvasToolbar.tsx`. A node type with
  a `toolbarIcon` is in the real dock; if it is not in the tour, the tour is now wrong.
- **`sections/Shortcuts.tsx`** — command bindings appear by themselves. Add rows only for keys that are
  *not* commands: keys a full-screen surface of yours binds, gestures, an editor's own keymap.
- Prefer real values over retyped ones: import the package's own constants (`BOOK_FILE_SUFFIXES`,
  `HIGHLIGHT_TAGS`) rather than writing the list out, so the page cannot drift. The exception is
  anything whose module drags weight into the eagerly-loaded help chunk — say so in a comment when you
  hardcode for that reason.
- Reuse `help/kit.tsx` (`Section`, `Tabs`, `Keys`, `Jump`, `useDemo`, `Cursor`) and the existing
  `lb-demo__*` classes before adding CSS. Demos are mock-ups built from the app's tokens — never
  screenshots, never a mounted editor.

## 5. `README.md`

The extension table under **Nodes & extensions**, and the `packages/` line in **Layout**. Both are
read by someone deciding whether this repo does what they need.

## 6. Check it

```
pnpm typecheck
pnpm test
```

Add unit tests in the package for anything with a parsing or geometry rule. An e2e test
(`apps/web/e2e/`) is worth it when the contribution adds a user-visible flow that spans app and
package.

## Two rules that are easy to get wrong

- **Disabling hides, never removes.** An extension switched off stops contributing tools, commands,
  imports and actions — its shapes on existing boards keep rendering, and its types stay in the
  schema. If your code deletes or migrates something on disable, it is wrong.
- **Reading is not editing.** State that belongs to how the user is working (a scroll position, a view
  mode, a font) should not spend an undo entry or land on the shape unless it is genuinely data about
  the thing. Write with `history: 'ignore'` where it does need persisting.
