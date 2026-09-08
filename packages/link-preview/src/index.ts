/**
 * Link previews — reading what a page says about itself.
 *
 * This entry point is **isomorphic and dependency-free**: types and the parser, nothing else, so the
 * browser, a Node server and a future native shell can all import it. The fetching half lives in
 * `@lifeboard/link-preview/node`, which reaches for `node:` builtins and must never end up in the
 * app bundle — see the note there for why the fetch cannot happen in a tab at all.
 */
export { decodeHtmlEntities, parseLinkPreview } from './parse'
export { emptyLinkPreview, type LinkPreview } from './types'
