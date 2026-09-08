# One health node: plan

Written 2026-09-08. Replaces the thirteen shape types shipped in `packages/health` with a single
configurable `node.health`, and moves the drawing code into a source-agnostic chart kit that a future
data source can reuse without touching health at all.

Decisions already taken with the user (2026-09-08):

- a node holds **a list of series**, not one metric — which retires the separate overview card;
- progress visuals fill towards **a typed target or a personal average**, chosen per series;
- the chart kit is **source-agnostic now**, but the only shape type in this pass is `node.health`;
- **all four visualization bundles** are in scope: core, calendar heatmap, stacked breakdown,
  comparison extras.

---

## 1. What is wrong today

`healthDefinition(metric)` is called once per entry in `METRICS`, so the registry carries
`node.health.steps`, `node.health.sleep`, … thirteen types that differ only in a `defaultProps()`
literal. Consequences:

- adding a metric to a board means adding *a different kind of card*, and the node picker grows a row
  per metric;
- a card can never show two metrics, so "steps against sleep" is two cards and no shared axis;
- `node.health.overview` exists purely because a fixed six-metric grid could not be expressed by the
  metric cards — a second type covering for the first one's rigidity;
- the visualization list (`bars | line | heatmap | stages | number`) is a string union inside the
  health package, with `stages` special-cased to sleep in both the config and `Chart.tsx`;
- `METRICS[metric].summary` fixes how a range collapses to one number. Steps are always a total, HRV
  is always a mean. There is no way to ask for "my best day" or "the minimum".

## 2. The shape

One registered type:

```
node.health
```

The thirteen old types stay registered as `deprecated: true` with their old props and a placeholder
component, for the same reason `node.rollup` did after `rollupsToTables`: unregistering a type turns
a surviving record into a *validation* failure rather than a stale one. The store migration in §9
converts them before validation on every load path, so in practice none ever render.

## 3. Props

```ts
/** One thing drawn on the card. */
export interface HealthSeriesSpec {
  /** Stable id — React keys and reordering, not derived from the metric (two series may share one). */
  id: string
  metric: Metric
  /** '' = automatic, which only resolves when exactly one source recorded the metric. */
  source: string
  /** How a range of days becomes one number. '' = the metric's registered default. */
  summary: '' | 'sum' | 'avg' | 'median' | 'min' | 'max' | 'latest'
  /** What a ring or progress bar fills towards. */
  target: {
    mode: 'none' | 'value' | 'average'
    /** Used when mode is 'value'. In the metric's display unit (hours for sleep, not seconds). */
    value: number
    /** Used when mode is 'average': the baseline is this many days ending the day before the window. */
    baselineDays: number
  }
  /** '' = the metric's registered colour. Otherwise a key into the chart kit's palette. */
  color: string
}

export interface HealthNodeProps {
  datasetId: string
  series: HealthSeriesSpec[]
  range: 'today' | 'yesterday' | 'day' | 'thisWeek' | 'lastWeek' | '7' | '30' | '90' | '365' | 'fixed'
  /** `range: 'day'` uses `start` alone. `range: 'fixed'` uses both. */
  start: string
  end: string
  /** Days per point. 'auto' picks day/week/month from the window length. */
  bucket: 'auto' | 'day' | 'week' | 'month'
  chart: VizKind
  /** Draw the previous window of the same length behind the current one. */
  compare: boolean
  /** 'auto' shares one axis when every series shares a unit, and normalises per series otherwise. */
  scale: 'auto' | 'shared' | 'perSeries'
  title: string
}
```

`series: []` is the created state — §8 covers what an empty card looks like.

Nested object and array validators are already used by `node.table`
(`T.arrayOf(tableColumnValidator)`), so `T.arrayOf(healthSeriesValidator)` needs no new machinery.
A cap of 8 series is validated, so a pasted card cannot ask for 200 lines.

**One privacy note.** `target.value` is a number the user typed — a goal weight, a step target — and
props live in the board, which means ordinary board backups. Readings still never touch props. The
default is `mode: 'none'`, so nothing is written until the user asks for it, and the settings page
copy gains a sentence saying so.

## 4. Period, including a single day

`dateWindow` in `health-core` gains `today`, `day` (the pinned `start`), `thisWeek` and `365`, and
keeps `yesterday`, `lastWeek`, `7`, `30`, `90`, `fixed`. The 730-day ceiling in `daysIn` stays.

The importer accepts **daily summaries only** — this is deliberate and documented in
`health-integration-plan.md` §"Selected scope". So a single-day window has exactly one value per
series, and no visualization can show an intraday curve. What a single day *can* show is the number,
the ring against its target, the sleep-stage breakdown, and a grid when several series are selected.
Everything else is disabled for a one-day window with the reason spelled out in the picker (§8).

`today` is the only window that includes an incomplete day; the card labels it "so far today" rather
than pretending it is comparable to a full day.

## 5. Aggregation and buckets

Two separate collapses, currently conflated:

- **The headline number** collapses the whole window with the series' `summary` op (default: the
  metric's registered one, so nothing changes for an untouched card).
- **A chart point** collapses one bucket. `bucket: 'auto'` chooses `day` up to 92 days, `week` up to
  400, `month` beyond — because 365 daily bars in a 300px card is a texture, not a chart.

Both go through one function in `health-core`:

```ts
export function bucketSeries(
  rows: readonly DailyRecord[],
  days: string[],
  bucket: 'day' | 'week' | 'month',
  op: SummaryOp,
): { key: string; label: string; days: string[]; value: number | null }[]
```

`value: null` means the exporter had nothing for that bucket — never `0`. `Chart.tsx`'s existing rule
that gaps stay gaps is preserved and moves into the kit.

A partial bucket (the current week under a `week` bucket) is marked so the chart can draw it at
reduced opacity instead of reading as a collapse in activity.

## 6. Visualizations

`VizKind` lives in the chart kit, not in health. Availability is a function of the spec, so the
picker greys out what cannot work and says why.

| id | name | series | one day | needs |
|---|---|---|---|---|
| `number` | Big number | 1..n (grid when n>1) | ✓ | — |
| `grid` | Stat grid | 1..n | ✓ | — |
| `ring` | Progress ring | 1..n, concentric | ✓ | a target on at least one series |
| `bars` | Bars | 1..3, grouped | — | ≥2 buckets |
| `line` | Line | 1..n | — | ≥2 buckets |
| `area` | Area | 1..n, overlaid | — | ≥2 buckets |
| `stacked` | Stacked bars | components, or n series | ✓ | components, or ≥2 series |
| `heatstrip` | Heat strip | 1..n, one row each | ✓ | — |
| `calendar` | Calendar heatmap | 1 | — | ≥14 days, `bucket: 'day'` |
| `dots` | Dot plot | 1..n | ✓ | — |
| `band` | Rolling min–max band | 1 | — | ≥7 buckets |

Notes on the four that are not obvious:

- **`ring`** is Apple's activity-ring arrangement when there is more than one series: concentric
  arcs, outermost first, each against its own target. Over 100% the arc keeps going round at reduced
  opacity rather than clamping, so a 130% day is visibly a 130% day.
- **`grid`** is what today's overview card becomes: a responsive grid of label/value/context cells,
  one per series. The migration in §9 turns `node.health.overview` into exactly this with the same
  six metrics, so an existing overview card looks unchanged.
- **`stacked`** covers two things with one renderer: a metric whose points carry `parts` (sleep
  deep/core/REM today, any future composite), and several series stacked into one bar. Which one it
  does is decided by the data, not by a second prop.
- **`band`** draws a rolling min/max envelope (window = 7 buckets) behind the line. Daily data has
  one value per day, so a same-day min–max would be meaningless; the envelope is the honest version.

`compare: true` adds the previous window of equal length behind the current one — a ghost line, ghost
bars, a tick on the ring, and the existing "% vs prior period" on the number. Unchanged from today:
a comparison is only offered when both windows have complete coverage, because a 5-of-7-day total
against a 7-day one is a lie with a percent sign on it.

Scales: with `scale: 'auto'`, series sharing a unit share one axis; series with different units are
each normalised to their own range and the axis labels are replaced by per-series max labels in the
legend. `shared` and `perSeries` force it either way.

Palette and contrast follow the `dataviz` skill at implementation time — including the check that
every series colour is distinguishable in both themes, since the board has a dark mode.

## 7. Targets

Three modes per series:

- `none` — progress visuals are unavailable for that series;
- `value` — the number typed, prefilled from a small per-metric default table (10 000 steps, 8 h
  sleep, 500 kcal active energy, …) that is a *suggestion in the input*, never a silently applied
  goal;
- `average` — the mean of the same metric over `baselineDays` (default 28) ending the day before the
  window starts. The ring then reads "today against my normal", and the tooltip states the baseline
  and how many days of it were actually observed.

`average` returns null when fewer than half the baseline days have data, and the ring says so rather
than filling against a number derived from three days.

## 8. The node's UI

**Empty.** A created card has no series. It shows the extension eyebrow, the words "Choose what this
card shows", and a searchable list of metrics — each row with its label, unit, day count and latest
value, so picking is informed. One click adds the first series and the card starts drawing. This is
in the card itself, not only behind a double-click, because a card that requires you to know about
the popover is the same discoverability problem in a new place.

**Configured.** A flex column: header (title, period, source/coverage), the chart filling the
remaining height, footer (coverage and source). The chart's viewBox is computed from `shape.props.w`
and `h` — no ResizeObserver — so strokes stay uniform at any card size and the chart genuinely grows
with the card rather than being an 88px strip.

**The popover** (`NodeEditorPopover`, widened) gets four sections:

1. **Data** — the series list. Each row: metric, source, colour, target, a drag handle, a remove
   button. "Add metric" appends. The row is collapsed to metric + colour until opened.
2. **Period** — range, the date inputs for `day`/`fixed`, "Pin these dates", bucket, compare.
3. **Visualization** — a grid of icon buttons from the kit's registry. Unavailable kinds render
   disabled with their reason as the title attribute ("needs more than one day", "needs a target").
4. **Data** — the existing `<details>` table, now one column per series.

The card keeps `data-testid="health-node"` plus `data-metrics="steps,sleep"` and
`data-chart="ring"`, which is what the e2e suite will assert against.

## 9. Migration and compatibility

`healthCardsToOneMigrations` — store-scoped, `retroactive: true`, modelled directly on
`nodes/table/rollupsToTables.ts`, living in `packages/health/src/migrate/`. Extensions cannot
contribute store migrations yet (`extensions.ts` lists that as a later contribution kind), so the
sequence is exported from the package barrel and added to `storeMigrations` in `canvas/Board.tsx`
alongside the two existing ones. It declares `dependsOn: [ROLLUPS_TO_TABLES_MIGRATION_ID]` so the
heuristic ordering of independent sequences is not relied on.

Mapping:

- `node.health.<metric>` → `node.health`, one series carrying the old `metric` and `source`, with
  `summary: ''` and `target.mode: 'none'` — which reproduces the old numbers exactly. `chart` maps
  `bars→bars`, `line→line`, `heatmap→heatstrip`, `number→number`, `stages→stacked`.
- `node.health.overview` → `node.health` with the six `OVERVIEW` metrics as series and
  `chart: 'grid'`.
- `range`, `start`, `end`, `datasetId`, `w`, `h` carry over unchanged. `bucket: 'auto'`,
  `compare: false`, `scale: 'auto'`, `title: ''`.

`fixtures/health/v0.1.0-health.json` stays exactly as it is — it is the evidence the migration works
— and `health-snapshot.test.ts` inverts: instead of asserting thirteen types survive, it asserts all
thirteen records arrive as `node.health` with the right series and that no reading reached props. A
new `v0.2.0-health.json` fixture captures the new shape for the next change.

## 10. Where the code goes

```
packages/node-kit/src/viz/          NEW — the source-agnostic chart kit, exported from the barrel
  types.ts                          VizSeries, VizPoint, VizSpec, VizKind, availability rules
  Viz.tsx                           the switch; every kind is a sibling module
  number.tsx grid.tsx ring.tsx bars.tsx line.tsx stacked.tsx
  heatstrip.tsx calendar.tsx dots.tsx band.tsx
  scale.ts                          domains, normalisation, nice ticks
  calendarLayout.ts                 week/day grid geometry — pure, and unit tested
  palette.ts                        series colours that survive both themes

packages/health-core/src/
  index.ts                          + dateWindow cases, bucketSeries, SUMMARY_OPS, target baselines

packages/health/src/
  definition.tsx                    ONE definition; legacy.ts holds the 13 deprecated ones
  spec.ts                     NEW   HealthSeriesSpec, validators, per-metric target defaults
  toViz.ts                    NEW   HealthNodeProps + snapshot → VizSpec. The only health→kit adapter
  HealthNode.tsx                    empty state, card, sizing
  HealthConfig.tsx            NEW   the popover's four sections, split out of HealthNode
  MetricPicker.tsx            NEW   the searchable metric list, used empty and in the config
  migrate/healthCardsToOne.ts NEW
  Chart.tsx                   DELETED — its rules move into the kit

apps/web/src/canvas/Board.tsx        + healthCardsToOneMigrations in storeMigrations
apps/web/src/persistence/*.test.ts   + the same, and the inverted health-snapshot assertions
```

The kit deliberately knows nothing about `Metric`, `DailyRecord` or Apple Health. Its input is:

```ts
export interface VizPoint {
  key: string           // opaque bucket id — a day today, a week or a category later
  label: string
  value: number | null  // null is a gap, never zero
  partial?: boolean
  parts?: { key: string; label: string; value: number; color: string }[]
}
export interface VizSeries {
  id: string
  label: string
  unit: string
  color: string
  format(value: number | null): string
  points: VizPoint[]
  summary: number | null
  previousSummary?: number | null
  target?: { value: number; label: string } | null
}
export interface VizSpec {
  kind: VizKind
  series: VizSeries[]
  keys: string[]        // the full x domain, gaps included
  compare: boolean
  scale: 'shared' | 'perSeries'
  width: number
  height: number
}
```

Anything that can produce that — board properties over time, dice history, pages read per day — gets
every visualization for free.

## 11. Phases

1. **Kit + core.** `node-kit/src/viz` with the eleven kinds and their availability rules;
   `bucketSeries`, the new `dateWindow` cases and summary ops in `health-core`. Unit tests for
   scale, calendar layout, bucketing and availability. Nothing user-visible yet.
2. **The node.** One `node.health` definition, `spec.ts`, `toViz.ts`, the card, the empty state and
   the four-section popover. The old definitions move to `legacy.ts` as deprecated.
3. **Migration.** `healthCardsToOne`, wired into `Board.tsx` and both fixture tests; the new
   fixture; the inverted `health-snapshot.test.ts`.
4. **Surfaces.** The dashboard command rewritten to place four differently-configured cards; the
   extension `description`/`details` rewritten (they currently promise "twelve metric nodes"); the
   `HealthSettings` closing copy; a `help/sections/Health.tsx` and its `sections.tsx` entry; the
   README extension table row and `packages/` lines. **All four of these Help/README surfaces are
   missing today** — the extension shipped without them — so this pass closes that gap rather than
   just updating it.
5. **e2e.** `health.spec.ts` reworked: one card, add a second series, switch visualizations, pin a
   single day, check the ring against a target, then the existing correction and offline-reload
   assertions.

Phases 1–3 are the feature; 4–5 are what make it exist for a user and stay working. Each phase
typechecks and tests green on its own.

## 12. Assumptions I made without asking

- **Summary op is per series, defaulting to the metric's registered one.** An untouched migrated card
  shows the number it showed before.
- **Bucketing is automatic by default.** Nobody has to know the word "bucket" to get a legible
  90-day chart, but it is overridable.
- **Series cap of 8**, chosen so `grid` and `ring` stay legible and a pasted card cannot ask for
  hundreds of arcs.
- **`today` is offered** even though it is an incomplete day, labelled as such.
- **The overview card is not preserved as a type** — it becomes `chart: 'grid'`. If you want "Health
  overview" to remain a distinct thing you can add from the picker, that is a preset in the dashboard
  command, not a shape type.

## 13. Not in this pass

Intraday data (the importer has none), workouts, per-series y-axis units on shared charts, saved card
presets, cross-metric derived series ("steps per hour of sleep"), and a second data source registered
against the kit. The kit's contract is what makes the last one cheap later; building a provider
registry before there is a second provider would be guessing at its shape.
