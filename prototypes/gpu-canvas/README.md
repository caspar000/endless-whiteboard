# GPU canvas prototype

A throwaway prototype, not part of the app: the four-tree test board drawn with WebGL2 in batches,
to measure what a GPU renderer would give the whiteboard. Results and the plan it led to are in
`docs/gpu-renderer-plan.md`.

- `index.html`, `main.js`: the renderer. Plain JavaScript, no build. Instanced discs, rings, line
  segments (capsules) and glyphs from an atlas; `?copies=N` draws N copies of the board in a grid.
- `data/four-trees.json`: the board as the page draws it (discs, rings, text lines, sampled line
  paths), from `export.mjs`.
- `export.mjs`: makes that file from a dev server.
- `bench.mjs`: frame times at N copies, on the GPU.

Run it:

```sh
python3 -m http.server 5400 --bind 127.0.0.1 --directory prototypes/gpu-canvas
# then open http://127.0.0.1:5400/?copies=287
```

Drag to pan; Ctrl or Cmd and scroll to zoom. The corner shows fps, draw calls and what's skipped.

Measure from `apps/web` (where Playwright is installed): copy the script there and run it, e.g.
`cp ../../prototypes/gpu-canvas/bench.mjs . && node bench.mjs 1 29 287 && rm bench.mjs`.
Headless Chromium renders in software unless launched with the GPU flags in `bench.mjs`.
