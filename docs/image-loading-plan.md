# Pictures that show at once

PLAN-32. Pictures on a board and the previews on the home screen's cards should appear at once as a
small blurred version of themselves, then sharpen when the full picture has loaded, the way Next.js
`<Image placeholder="blur">` does it. Pictures near the screen should load before they are needed.

Decisions agreed with the user on 2026-10-26: ThumbHash; extension pictures only fade in; existing
boards get ThumbHashes written into them (a server backup is taken). Phase 1 is built.

## How it works today

- **Storing.** A dropped picture is re-encoded to WebP at most 2048 px on its long edge
  (`persistence/downscale.ts`), hashed, and kept in the blob store under its SHA-256
  (`persistence/assetStore.ts`). The asset record holds `src: asset:<hash>`, its size and its mime
  type. A server board's blobs also live on the server (`apps/server/src/assets.ts`), served from
  `/api/assets/:hash` with an immutable cache header.
- **Resolving.** `useImageOrVideoAsset` (`canvas-editor/src/lib/hooks/useImageOrVideoAsset.ts`) asks
  the asset store for a URL at the picture's on-screen scale, stepped in powers of two. The store reads
  the blob from IndexedDB, or fetches it from the server and keeps a copy, and turns it into an object
  URL. A picture drawn smaller than its own size gets a scaled copy, made once per session by decoding
  the full blob (`scaledUrl`, docs/fork-parity.md P6).
- **Drawing.** The image shape (`canvas/src/lib/shapes/image/ImageShapeUtil.tsx`) draws nothing until
  that URL arrives, then an `<img>`. The GPU layer copies the decoded `<img>` into its atlas
  (`canvas-editor/src/lib/gpu/snapshots.ts`, `imagePicture`), keyed by the image's URL. Markdown
  notes (`MarkdownView.tsx`) and item cards (`ItemNodeComponent.tsx`) use the same hook. Book covers,
  skill pictures and other extension pictures go through node-kit's `useAssetUrl`, which has no asset
  record behind it, only an `asset:<hash>` string in the node's props.
- **Off screen.** Shapes outside the viewport are not rendered. Pictures already render ahead
  (`rendersAhead`): they mount half a screen past each edge rather than 100 px, so a pan doesn't bring
  them in blank. Nothing loads further out than that.
- **Home cards.** `BoardThumbnail` (`app/BoardCard.tsx`) shows the board's initials, then a 600 px WebP
  preview: from the KV store for a local board, from `/api/boards/:id/thumbnail/:theme?v=…` (immutable)
  for a server board. Every card loads its image straight away, wherever it is in the grid, and each
  one also fetches its other-theme picture a second later.

So a picture is blank, then appears in one step. When the blob is local that gap is short (an
IndexedDB read and a decode). It is long on a device that hasn't seen the board before, where every
blob comes from the server, and for big photos on a phone. Those are the cases this plan targets.

## The approach

**A ThumbHash per picture.** [ThumbHash](https://evanw.github.io/thumbhash/) (Evan Wallace, MIT,
about 2 KB, no dependencies) encodes a picture of at most 100×100 px into roughly 25 bytes. It keeps the
aspect ratio and transparency, which BlurHash does not, and decodes to a blurred RGBA image in well under
a millisecond. Base64, that is about 35 characters per picture, small enough to keep in the asset
record. A tiny WebP data URL would need no library but costs 400 to 800 bytes per picture in every
board snapshot.

**Kept in the asset record's `meta`, not its props.** The upload path already allows this:
`TLAssetStore.upload` returns `{ src, meta }` and `defaultExternalContentHandlers.ts` merges the `meta`
into the record. `meta` needs no schema migration and travels with the board, so a device that has
never seen the board gets the blur in the snapshot, before a single blob arrives. That is where it helps
most.

**One component draws both.** A small `<BlurUpImage>` in canvas-editor takes the full URL and the
ThumbHash. It shows the decoded ThumbHash as a plain `<img>` at once, loads the full picture, waits for
`img.decode()`, and swaps the `src`, as Next.js does. A picture with no ThumbHash fades in over 200 ms
instead (no fade under reduced motion). A crossfade between the two would need a second element or a
background image under every picture, which the GPU layer can't draw. The blur is baked into the
ThumbHash image, so there is no CSS `filter`, which the GPU layer refuses (`Unsupported('effect')`).
The GPU layer re-reads a shape when anything inside its element changes, so the swap and the end of
the fade (its class coming off) both give it a fresh snapshot. The image shape, markdown images and
item images all use it.

## Phases

Each phase ends with its specs run alone and a check in the app on a throttled network. Stop and report
after each.

### Phase 1: blur-up for new pictures (built)

- `assetStore.upload` encodes a ThumbHash from the downscaled bitmap (drawn at ≤100 px, which it
  already has in hand) and returns it as `meta.thumbhash`. SVG and GIF get none.
- `useImageOrVideoAsset` also returns the asset's placeholder, decoded once per hash and cached as a
  data URL.
- `<BlurUpImage>` in the image shape, `MarkdownView` and `ItemNodeComponent`.
- Check the GPU layer: its atlas is keyed by URL, so the swap from blur to full picture must produce a
  new snapshot rather than keep the blurred one. The fade must not leave the snapshot taken mid-fade.
- Remove background replaces the ThumbHash with the cut-out's own.
- Tests: `assetStore.test.ts` checks that an upload returns the ThumbHash in `meta`. `assets.spec.ts`
  imports a picture, deletes its blob, reloads, and sees the blur at the picture's proportions. The
  e2e suite has no server, so the server-board case was not tested end to end.

### Phase 2: existing pictures

Pictures dropped before phase 1 have no ThumbHash. When one is resolved and its blob is at hand, encode
it in idle time and write `meta.thumbhash` with history ignored, so it is not an undo step. Only on
boards this account can edit. A server board then carries it to every device on the next sync. Boards
nobody opens keep blank-then-picture until they are opened once.

### Phase 3: home cards

- When a preview is drawn (`saveBoardThumbnail`), encode its ThumbHash too. Keep it locally beside the
  preview (`thumbHash:<theme>:<id>` in the KV store). For a server board, send it with the preview;
  the server keeps it beside the file and the board list returns it with the preview versions it
  already returns (`previews`).
- The card shows the ThumbHash at once, then fades the preview in. Boards with no preview keep the
  initials placeholder, since that means the board is empty.
- `loading="lazy"` and `decoding="async"` on the card image, so a long grid fetches what is near the
  viewport first. The other-theme prefetch runs only for cards that have been on screen.

### Phase 4: loading ahead on the board

Rendering ahead mounts pictures half a screen out; this warms the next ring without mounting anything.
After a board opens and the user has been idle for a moment, walk the board's image assets nearest the
viewport first, out to about two screens, and for each one:

- fetch its blob into IndexedDB if it is a server blob this device lacks;
- make the scaled copy for the current zoom, so mounting it later is an object-URL lookup.

At most four at a time, cancelled when the board closes, paused while the user is panning or zooming.
Pictures beyond that ring load as they come into range, with their blur already showing.

### Not in this plan, worth measuring later

Scaled copies are made again every session, and each one decodes the full 2048 px blob. A board with
many large photos pays that on every reload. Keeping them in the blob store under their own keys
would remove it, at the cost of storage and GC work. Worth doing only if phase 4's numbers show it.

## Decisions for you

1. **ThumbHash or a tiny WebP?** ThumbHash: 35 characters per picture and one 2 KB dependency.
   A 16 px WebP data URL: no dependency, 400 to 800 bytes per picture in every snapshot. I recommend
   ThumbHash.
2. **Extension pictures (book covers, skill pictures).** They have no asset record, so a stored
   placeholder means a new prop and a migration per node type. I recommend a fade-in only for these
   for now, plus a placeholder cached by hash on this device once a picture has been seen.
3. **Writing ThumbHashes into existing boards (phase 2).** It changes stored data on open: a `meta`
   field on asset records, outside undo, synced to the server. Harmless to older clients, which ignore
   unknown `meta`. I recommend doing it, after a server backup as with any change to stored data.
