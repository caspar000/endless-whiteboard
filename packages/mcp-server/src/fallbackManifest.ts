// GENERATED FILE — do not edit by hand.
//
// The MCP server's cold-start tool list: what it offers before a Lifeboard tab has connected
// and reported its live operations. Produced from the operation registry by
// `packages/node-kit/src/ops/manifest.test.ts`; regenerate with:
//
//     pnpm --filter @lifeboard/node-kit test -u

import type { OperationManifestEntry } from './protocol.js'

export const FALLBACK_MANIFEST: OperationManifestEntry[] = [
	{
		"id": "board.list",
		"title": "List boards",
		"description": "Every board in this workspace, most recently edited first. Start here: the ids returned are what every other operation means by boardId.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "board.create",
		"title": "Create board",
		"description": "Makes a new, empty board and returns it. Opens it on screen unless told not to, so subsequent operations can omit boardId.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"name": {
					"type": "string",
					"description": "What to call it. Defaults to \"Untitled board\"."
				},
				"open": {
					"type": "boolean",
					"description": "Open the new board on screen. Defaults to true — a board nobody can see is rarely what was wanted."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "board.open",
		"title": "Open board",
		"description": "Brings a board on screen and waits for it to be ready. Only needed to change what the person watching sees — every other operation takes a boardId and opens it itself.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"boardId": {
					"type": "string",
					"description": "The board to open."
				}
			},
			"required": [
				"boardId"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "board.rename",
		"title": "Rename board",
		"description": "Changes a board’s name. Its contents and id are untouched.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"boardId": {
					"type": "string",
					"description": "The board to rename."
				},
				"name": {
					"type": "string",
					"description": "The new name."
				}
			},
			"required": [
				"boardId",
				"name"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "board.delete",
		"title": "Delete board",
		"description": "Permanently deletes a board and everything on it. THIS CANNOT BE UNDONE — it is not in the undo history. Requires confirm: true. Check with board.list first.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"boardId": {
					"type": "string",
					"description": "The board to delete."
				},
				"confirm": {
					"type": "boolean",
					"description": "Must be true. Set it only if deleting this board is what was actually asked for."
				}
			},
			"required": [
				"boardId",
				"confirm"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "node.types",
		"title": "List node types",
		"description": "The kinds of node that can be created right now, with whether each accepts text. Types come from the enabled extensions, so this can change between calls — read it before guessing a type name.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "node.insert",
		"title": "Insert node",
		"description": "Puts a new node on a board and returns its id. Use node.types for valid type values. Position is the centre of the node in page coordinates; omit x and y to place it in the middle of the current view.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"type": {
					"type": "string",
					"description": "The node type, e.g. the markdown note type. See node.types."
				},
				"text": {
					"type": "string",
					"description": "Initial text, for types where acceptsText is true. Markdown notes take markdown."
				},
				"x": {
					"type": "number",
					"description": "Page x of the node’s centre."
				},
				"y": {
					"type": "number",
					"description": "Page y of the node’s centre."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"type"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "node.find",
		"title": "Find nodes",
		"description": "Searches the shapes on a board and returns what matched, with their ids, labels, positions and property values. With no filters it returns everything. This is how to look at a board before changing it.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {
				"query": {
					"type": "string",
					"description": "Case-insensitive substring of the shape’s label (its title or text)."
				},
				"type": {
					"type": "string",
					"description": "Only shapes of this type. See node.types."
				},
				"hasProperty": {
					"type": "string",
					"description": "Only shapes carrying this property, by name or id — e.g. \"Price\". Matches whether or not the value is filled in."
				},
				"limit": {
					"type": "number",
					"description": "How many to return, at most 200. Defaults to 200."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "node.get",
		"title": "Get node",
		"description": "One shape in full: type, label, position, size and every property value it carries.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeId": {
					"type": "string",
					"description": "The shape’s id, from node.find."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"shapeId"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "node.update",
		"title": "Update node",
		"description": "Changes a node’s text, position or size. Only the values passed are touched. To change property values use property.set.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeId": {
					"type": "string",
					"description": "The shape to change."
				},
				"text": {
					"type": "string",
					"description": "Replacement text, for types that hold text."
				},
				"x": {
					"type": "number",
					"description": "New page x of the shape’s top-left corner."
				},
				"y": {
					"type": "number",
					"description": "New page y of the shape’s top-left corner."
				},
				"w": {
					"type": "number",
					"description": "New width."
				},
				"h": {
					"type": "number",
					"description": "New height."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"shapeId"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "node.delete",
		"title": "Delete node",
		"description": "Removes a shape from the board. Undoable, unlike board.delete — it goes into the board’s history.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeId": {
					"type": "string",
					"description": "The shape to delete."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"shapeId"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "property.list",
		"title": "List properties",
		"description": "The properties defined on a board — the columns a table can show and node.find can filter by. Any shape may carry any of them.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "property.create",
		"title": "Create property",
		"description": "Defines a property on a board so shapes can carry it. Returns the existing definition unchanged if one with this name already exists, so it is safe to call before every write.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"name": {
					"type": "string",
					"description": "What it is called, e.g. \"Price\". The id is derived from this."
				},
				"type": {
					"type": "string",
					"description": "The kind of value. \"financial\" is money and needs a unit; \"rating\" is 1–5; \"status\" tracks stages.",
					"enum": [
						"text",
						"number",
						"financial",
						"date",
						"checkbox",
						"link",
						"select",
						"status",
						"multiSelect",
						"rating",
						"progress"
					]
				},
				"unit": {
					"type": "string",
					"description": "Currency code for financial (\"USD\", \"GEL\"), or a display unit for number (\"kg\")."
				},
				"options": {
					"type": "array",
					"description": "The choices, for select, status and multiSelect.",
					"items": {
						"type": "string"
					}
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"name",
				"type"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "property.set",
		"title": "Set property value",
		"description": "Writes a property value on a shape, creating nothing — the property must already exist (property.create). Values are given as text and read according to the property’s type: \"2399\" for a number, \"true\" for a checkbox, a comma-separated list for multiSelect. An empty string clears the value but keeps the property attached.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeId": {
					"type": "string",
					"description": "The shape to write on."
				},
				"property": {
					"type": "string",
					"description": "The property, by name or id."
				},
				"value": {
					"type": "string",
					"description": "The value, as text. Read according to the property’s type."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"shapeId",
				"property",
				"value"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "relation.connect",
		"title": "Connect two nodes",
		"description": "Draws an arrow from one shape to another, which is how this app records a relation — tables and collections can then follow it. Returns the arrow’s id, which relation.delete takes.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"from": {
					"type": "string",
					"description": "The shape the arrow starts at."
				},
				"to": {
					"type": "string",
					"description": "The shape it points at."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"from",
				"to"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "relation.list",
		"title": "List relations",
		"description": "The relations on a board, as from/to pairs with labels. Pass a shapeId to get only the ones touching it — that is how to answer \"what is connected to this?\".",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeId": {
					"type": "string",
					"description": "Only relations touching this shape. Omit for every relation on the board."
				},
				"direction": {
					"type": "string",
					"description": "With shapeId: \"out\" for arrows leaving it, \"in\" for arrows pointing at it, \"either\" for both. Defaults to either.",
					"enum": [
						"in",
						"out",
						"either"
					]
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "relation.delete",
		"title": "Delete relation",
		"description": "Removes a relation by deleting its arrow. Takes the arrow id from relation.connect or relation.list, not the ids of the shapes it joined.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"relationId": {
					"type": "string",
					"description": "The arrow’s id."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"relationId"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "board.query",
		"title": "Query a board",
		"description": "Summarises the shapes on a board — \"what do the prices come to?\", \"how many are done?\". Returns the value and the rows that went into it. For simply listing shapes, node.find is more direct.",
		"readOnly": true,
		"inputSchema": {
			"type": "object",
			"properties": {
				"property": {
					"type": "string",
					"description": "The property to summarise, by name or id. Omit to count rows rather than summarise a value."
				},
				"op": {
					"type": "string",
					"description": "What to work out: sum, avg, min, max, median, or one of the count/percent variants. Defaults to count.",
					"enum": [
						"count",
						"countValues",
						"countUnique",
						"countEmpty",
						"countNotEmpty",
						"percentEmpty",
						"percentNotEmpty",
						"sum",
						"avg",
						"median",
						"min",
						"max",
						"range",
						"earliest",
						"latest"
					]
				},
				"shapeType": {
					"type": "string",
					"description": "Only count shapes of this type. Omit for every shape on the board."
				},
				"filterProperty": {
					"type": "string",
					"description": "Restrict to shapes whose value for this property matches the filter."
				},
				"filterOp": {
					"type": "string",
					"description": "How to compare — defaults to isNotEmpty, which needs no filterValue.",
					"enum": [
						"isNotEmpty",
						"isEmpty",
						"is",
						"isNot",
						"contains",
						"doesNotContain",
						"gt",
						"gte",
						"lt",
						"lte",
						"before",
						"after"
					]
				},
				"filterValue": {
					"type": "string",
					"description": "The value to compare against. Read as a number when it looks like one, so \"100\" works for gt and lt."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	},
	{
		"id": "view.select",
		"title": "Select shapes",
		"description": "Selects shapes and, unless told not to, moves the view to them. Use it after creating or changing things so the person watching can see what was done.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"shapeIds": {
					"type": "array",
					"description": "The shapes to select. A single id may be passed on its own.",
					"items": {
						"type": "string"
					}
				},
				"zoom": {
					"type": "boolean",
					"description": "Move the camera to fit the selection. Defaults to true."
				},
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [
				"shapeIds"
			],
			"additionalProperties": false
		}
	},
	{
		"id": "view.zoom-fit",
		"title": "Zoom to fit",
		"description": "Frames everything on the board, so the whole thing is visible at once.",
		"readOnly": false,
		"inputSchema": {
			"type": "object",
			"properties": {
				"boardId": {
					"type": "string",
					"description": "Which board to act on. Omit to use the board currently open on screen. Passing one opens it if it is not already."
				}
			},
			"required": [],
			"additionalProperties": false
		}
	}
]
