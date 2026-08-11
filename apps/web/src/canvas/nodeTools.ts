import { BaseBoxShapeTool, type TLStateNodeConstructor } from 'tldraw'
import { getVisibleNodeDefinitions } from '@lifeboard/node-kit'

/**
 * One click-and-drag tool per registered node type, generated from the registry — never hardcoded
 * per type (§7). `BaseBoxShapeTool` gives the standard "drag out a box, or click for default size"
 * behaviour that every other box shape in tldraw has.
 *
 * When plugin-supplied definitions arrive, they get a tool here for free.
 */
/**
 * Tool ids are *not* node types.
 *
 * tldraw addresses tools by a dot-separated path through its state chart (`select.idle`,
 * `geo.pointing`), so `editor.setCurrentTool('node.item')` is parsed as "child `node`, then child
 * `item`" and fails with "no child state exists with the id node.". Node types are deliberately
 * dot-namespaced (`node.item` now, `plugin.<vendor>.<name>` later, §4.1), so the tool id flattens
 * the separator. The node type — the persisted data contract — is untouched.
 */
export function toolIdForNodeType(nodeType: string): string {
	return nodeType.replace(/\./g, '-')
}

export function createNodeTools(): TLStateNodeConstructor[] {
	return getVisibleNodeDefinitions().map((def) => {
		class NodeBoxTool extends BaseBoxShapeTool {
			static override id = toolIdForNodeType(def.type)
			// `shapeType` is typed against tldraw's closed union of box shapes; a registry entry's
			// type is a plain string (it may come from a plugin). Same boundary as in the factory.
			override shapeType = def.type as BaseBoxShapeTool['shapeType']
		}
		return NodeBoxTool as unknown as TLStateNodeConstructor
	})
}
