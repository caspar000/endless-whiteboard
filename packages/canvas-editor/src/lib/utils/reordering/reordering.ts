/**
 * Fractional index keys for shape and page order. Today's MIT `@tldraw/utils` implementation, rather
 * than the fork's own 2023 one, so that new keys are made exactly the way the boards' existing keys
 * were (and are branded `IndexKey`, as today's records require).
 */
export {
	getIndexAbove,
	getIndexBelow,
	getIndexBetween,
	getIndices,
	getIndicesAbove,
	getIndicesBelow,
	getIndicesBetween,
	sortByIndex,
	type IndexKey,
} from '@tldraw/utils'
