import { registerOperation, type RegisteredOperation } from '../operations'
import { boardOperations } from './board'
import { nodeOperations } from './node'
import { propertyOperations } from './property'
import { queryOperations } from './query'
import { relationOperations } from './relation'
import { viewOperations } from './view'

/**
 * The core operation surface: what an agent can do to a board out of the box.
 *
 * Ownerless, so they are always offered — these are the app itself, not an extension's contribution.
 * An extension adds to this list through `Extension.operations`, and its rows appear and disappear
 * with its enablement.
 *
 * Registered from the host's composition root rather than at module scope, unlike commands: these
 * need a `BoardBridge` to do anything, so a host that has not installed one should not be announcing
 * them. Ordering within the table is registration order, which is the order an agent reads them in —
 * hence boards first (nothing else works without a board), then content, then the view.
 */
export const coreOperations: RegisteredOperation[] = [
	...boardOperations,
	...nodeOperations,
	...propertyOperations,
	...relationOperations,
	...queryOperations,
	...viewOperations,
]

export function registerCoreOperations(): void {
	for (const op of coreOperations) registerOperation(op)
}

export { boardOperations, nodeOperations, propertyOperations, queryOperations, relationOperations, viewOperations }
