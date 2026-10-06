# Upstream

Imported from tldraw `2.0.0-alpha.19` (Apache-2.0), commit `64dce02ba3d8a2e7babf4e88864ddc5153a52a16`.
See the repository's `NOTICE` and `docs/canvas-fork-plan.md`.

The import commit holds these files exactly as upstream had them. Diff against it to see every change:

    git diff $(git log --format=%H --grep='Import tldraw 2.0.0-alpha.19' -1) -- packages/canvas-assets

## Fonts added since the import

The bold and italic faces, so formatted labels draw in their own faces as they do in tldraw 5. Taken
from the fonts' own releases, not from tldraw, under the SIL Open Font License 1.1 (each family's
licence is next to it in `fonts/`):

- Shantell Sans 1.011 (github.com/arrowtype/shantell-sans): `Normal-ExtraBold`, `Normal-SemiBold_Italic`,
  `Normal-ExtraBold_Italic`. Regular stays the imported `Normal-SemiBold`. ExtraBold and SemiBold
  Italic are the weights whose widths match tldraw 5's bold and italic.
- IBM Plex Sans, Serif and Mono (`@ibm/plex-*` 1.1.0): `Bold`, `MediumItalic`, `BoldItalic`.
