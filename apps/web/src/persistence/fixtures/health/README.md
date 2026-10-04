# Retired health node fixture

`v0.1.0-health.json` is a synthetic board with all thirteen health card types, written while the Apple
Health extension was on main. The extension now lives on the `experiment/health` branch.
`removeHealthNodes.test.ts` loads this board through the current schema and checks that it opens with
every health card gone.

It sits in its own folder because `snapshot-fixtures.test.ts` asserts that no record disappears, and
here every record is supposed to.
