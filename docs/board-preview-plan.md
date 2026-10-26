# Board previews that show at once

PLAN-21. The previews on the home screen are slow to appear and sometimes look redrawn on every visit.
The goal: a preview is drawn in the background after a board with changes is closed, kept with the
board in both themes, and shown immediately on every visit and after a theme switch.

Agreed with the user on 2026-10-26: build the three phases in order, verifying each in the app.
Previews that are out of date are shown until redrawn.

## How it works today

- **Drawing.** A board's preview is exported from its live editor once it is off screen and the user has
  been idle for 1.5 s (`app/App.tsx`, the interval near `THUMBNAIL_IDLE_MS`). Boards with no live editor
  and no preview are drawn by the home screen in a hidden editor, one at a time
  (`canvas/ThumbnailBackfill.tsx`): load the whole board, mount it, wait 600 ms, export. Both go through
  `saveBoardThumbnail` (`persistence/thumbnails.ts`): a 600 px WebP of up to 120 shapes, in the theme on
  screen.
- **Storing.** Locally, as a Blob in the KV store under `thumb:<theme>:<id>`. Saving one theme deletes the
  other. A server board's preview is also sent to the server, which keeps it as
  `data/thumbnails/<id>.<theme>.webp` and reports the file's mtime as `x-drawn-at`.
- **Showing.** Each card (`app/BoardCard.tsx`, `BoardThumbnail`) renders the initials placeholder, then
  loads its image: a server board fetches it from the server with `cache: 'no-store'` (the server answers
  `cache-control: no-cache`), falling back to the local copy only if that fails; a local board reads
  IndexedDB.

## Why it is slow

1. **Every home visit downloads every server preview, twice.** The home screen unmounts when a board
   opens, so each return remounts every card, and each card fetches its image again with caching turned
   off at both ends. Then `ThumbnailBackfill` fetches the same image again only to read `x-drawn-at`,
   because the board list doesn't say when a preview was drawn. Its "already checked" set lives in the
   component, so it starts empty on every visit. With 30 server boards that is 60 image downloads (a few
   MB) before the grid has settled, and every card shows its initials until its own request returns.
2. **A board is redrawn after every open, edited or not.** An editor starts out "stale"
   (`isThumbnailStale`), so every board opened in a session is exported and uploaded again once it is
   closed. This is deliberate (an edit made just before a reload would otherwise never reach a
   preview), but it is the redraw the issue describes, and it costs an export (~300 ms of blocked page
   for 120 shapes) plus an upload each time.
3. **A freshly drawn server preview is replaced by the old one.** `saveBoardThumbnail` stores the local
   copy and tells the cards before the upload starts. The card re-fetches from the server, gets the
   previous image, and keeps it until the next visit. So after closing an edited board the card shows
   the old picture first and changes later, which looks like a redraw on load.
4. **A theme switch empties the grid.** Only one theme is kept locally, so after a switch (including the
   OS going dark at sunset with the theme set to System) no local board has a preview in the new theme.
   The cards fall back to initials, and the home screen redraws every board one at a time, about a
   second each. Server boards keep both files, but the other theme is usually older than the board's
   last edit, so it is redrawn too.
5. **Other devices redraw too.** Any change to a server board moves its `updatedAt`. Every device that
   then visits the home screen sees `drawnAt < updatedAt`, downloads the whole board and draws it again,
   even while the device that made the edit still has it open and will upload its own preview when it
   closes it.

Not the cause: the image itself is small (600 px WebP at quality 0.7), and the shape cap keeps export
time bounded.

## The plan

Three phases, each shippable on its own. Stop and report after each.

### Phase 1: show what is already stored, immediately

The biggest win, and it doesn't change when previews are drawn.

- **The board list says which preview is current.** The list returns each preview's drawn-at time per
  theme. The server already had it, as the image file's mtime, so the images stay as files and the
  database is unchanged. (The first draft put the times in new `boards` columns; reading the mtime
  does the same with no schema change and no backup needed.)
- **Versioned, cacheable image URLs.** A card asks for
  `/api/boards/<id>/thumbnail/<theme>?v=<drawnAt>`, which the server answers with
  `cache-control: private, max-age=31536000, immutable`. A new drawing is a new URL, so the browser's
  own cache serves every unchanged preview with no request at all, online or offline. The card renders
  a plain `<img src>`, which drops the fetch, Blob and object-URL handling for server boards.
- **Local boards paint on the first frame.** A module-level map of object URLs by board, theme and
  version survives the home screen unmounting, so returning home shows the images straight away
  instead of the initials for a frame while IndexedDB answers.
- **The backfill reads versions from the list** instead of downloading each preview, and remembers what
  it checked for the whole session rather than per visit.
- **Fix the upload race (cause 3).** For a server board, the card shows the local copy it was just told
  about, and switches to the new server URL once the upload has returned the new version.
- **Measure before and after** with a Playwright spec: a vault of 30 server boards, open one and go
  back home, count preview requests and time until every card has its image. Target: no requests and
  all images within one frame on the second visit.

### Phase 2: draw only after a real change

- **A preview remembers what it was drawn from.** Locally the KV entry gets a `drawnAt` next to the
  bytes; on the server it is the column from phase 1. An editor starts out fresh when its board's
  preview is newer than the board's `updatedAt`, so opening and closing a board without editing it
  draws nothing. An edit made just before a reload still leaves the board newer than its preview, so it
  is still drawn on the next visit.
- **Check that opening a board writes nothing.** If a node tidies itself on mount (measuring its height,
  migrating a prop), that push moves `updatedAt` and makes every preview look stale. An e2e test opens
  and closes a server board and asserts `updatedAt` didn't move; anything it catches gets fixed at
  the source.
- **Other devices wait for the editor.** A stale preview is still a fine picture of the board. The home
  screen shows it and redraws it only once the board has gone a few minutes without a change, so the
  device that made the edit usually uploads first and nobody else draws it.

### Phase 3: both themes at once

- `saveBoardThumbnail` exports twice from the same editor, light and dark, stores both and uploads
  both. The rule that saving one theme deletes the other goes.
- A theme switch then changes only which URL each card shows: no redraw and no placeholders. The
  redraw-every-mounted-board-on-theme-change pass in `App.tsx` (`refreshThumbnails`) goes away.
- Cost: a second export per drawing, in idle time, with a yield between the two so the page doesn't
  block for both in a row; roughly twice the preview storage (tens of KB per board).
- Existing boards with one theme get the other from the backfill once, as they do today.

## Results

- **Phase 1.** Measured with 13 server boards over a simulated 100 ms, 10 Mbit/s connection, leaving a
  board and going back to the home screen three times. Before: every preview showed ~350 ms after
  leaving the board, with 30 preview requests each time. After: ~60 ms, with 2 requests, both from the
  opened board being redrawn (its upload and one download of the new version), which phase 2 removes.
  Unchanged previews make no requests. An edited board's card switches to its new preview without a
  reload.
- **Phase 2.** Opening and closing a board without changing it no longer draws it: returning to the
  home screen made no preview requests at all, and the boards' `updatedAt` stayed put on the server.
  Closing a local board used to move its `updatedAt` even when nothing changed (`trackBoardActivity`);
  now only held-back edits do. With a second browser on the home screen while the first was still
  editing a board, the second drew nothing; the first drew it on leaving. One-off cost: local previews
  stored before this have no drawn-at time, so each is redrawn once in the background.
- **Phase 3.** Every drawing now stores light and dark. The second theme needed two things the plan
  didn't foresee: the fork ignores `toImage`'s `darkMode` (shapes read `editor.user.getIsDarkMode()`,
  which every editor shares), so `UserPreferencesManager` gained a per-editor `setDarkModeOverride`; and
  node cards take their colours from `<html data-theme>`, so the token blocks in styles.css also apply
  to `[data-lb-theme]`, set on the hidden board's container while it is drawn (the one rule that
  picked a colour by `:root[data-theme]`, `.lb-chip`, moved onto tokens). The redraw-on-theme-switch
  pass is gone. A card also warms the other theme's picture (the browser cache for a server board, the
  object-URL cache for a local one), so even the first switch shows previews without waiting. Checked:
  a dark preview drawn while the app is light has dark paper and dark node cards; switching theme
  drew nothing and downloaded only a preview changed seconds before. One-off cost: every board's
  missing theme is drawn once in the background.
