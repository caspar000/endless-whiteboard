/**
 * `@lifeboard/zettelkasten` — a Zettelkasten box: notes on index cards, in Luhmann's order.
 *
 * Reaches the host only through `@lifeboard/node-kit`'s barrel, like every extension package.
 */
// Registers `node.zettel` with tldraw's *type* system (see shape-types.ts). Must stay above the exports.
import './shape-types'

export { zettelkastenExtension, boxKind } from './extension'
export { CARD_TYPE, BOX_META, isBox, type CardProps } from './box'
export { compareZids, isZid, placeBehind, nextTrain } from './ids'
