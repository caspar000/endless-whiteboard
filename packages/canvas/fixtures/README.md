# Reference boards

Two boards captured from Lifeboard while it still ran on tldraw 5.5, by
`apps/web/scripts/capture-reference-boards.mjs` (phase 0 of `docs/canvas-fork-plan.md`). They are the
yardstick for the fork: every phase up to cutover must open them and keep them as they are.

| File | What it holds |
|---|---|
| `lifeboard.json` | The first-run demo, plus a book, a quote, a dice roll card, a sticky with bold text, and two relations (one hidden) |
| `default-shapes.json` | Every default shape and every record format in `docs/fork-parity.md` section D: rich text with formatting, arrows bound at both ends (one labelled, one elbow), a freehand stroke and a highlighter stroke (base64 `path`), a flipped geo, a scaled geo, a cropped and flipped image, a note label colour, `textAlign`, a frame with children, a group, a line, a video, an embed, a bookmark, a second page |
| `<board>.png` | The board exported by the app |
| `<board>.screen.png` | The viewport as a person saw it |
| `assets/<sha256>` | The image the boards reference, so they can be shown without this browser's blob store |

Each `.json` is a store snapshot, `{ store, schema }`, the same form as backups and the fixtures in
`apps/web/src/persistence/fixtures/`.

Don't regenerate these after cutover: the script needs the app on tldraw 5.5. Add new boards next to
them instead.
