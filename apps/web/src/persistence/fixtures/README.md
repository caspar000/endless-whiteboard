# Snapshot fixtures

One JSON snapshot per released props schema, loaded by `snapshot-fixtures.test.ts`. This is the §7
guardrail: **"keep fixture snapshots from each release and a test that `loadSnapshot`s all of them."**

Its job is to fail loudly when a node's props change without a migration — the failure mode that
would otherwise silently corrupt every existing board on upgrade.

## Adding a fixture

Do this whenever you change any node's props, *before* shipping:

1. Open a board containing at least one of every node type.
2. In the console: `copy(JSON.stringify(getSnapshot(editor.store), null, 2))`
   (`getSnapshot` is exported from `tldraw`; `editor` is on `window`.)
3. Save it here as `v<N>-<short-description>.json`, where `<N>` is the app version it came from.
4. Leave every older fixture in place. They are the regression suite — the point is that today's
   code can still open the boards yesterday's code wrote.

Fixtures are small and text; they are meant to be committed.
