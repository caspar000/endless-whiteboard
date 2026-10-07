/**
 * Mermaid flowcharts, read into nodes and edges (docs/fork-parity.md B8). Only `graph` and
 * `flowchart` diagrams: the kind that maps onto shapes and arrows. Styling, classes, clicks and
 * subgraph headings are read past; a subgraph's nodes and edges are kept.
 *
 * Written from Mermaid's documented syntax, not its source.
 */

export type FlowDirection = 'TB' | 'BT' | 'LR' | 'RL'

export type FlowNodeShape =
	| 'rectangle'
	| 'rounded'
	| 'stadium'
	| 'subroutine'
	| 'cylinder'
	| 'circle'
	| 'diamond'
	| 'hexagon'
	| 'parallelogram'
	| 'trapezoid'
	| 'flag'

export interface FlowNode {
	id: string
	label: string
	shape: FlowNodeShape
}

export interface FlowEdge {
	from: string
	to: string
	label: string
	/** The end each arrowhead is on, if any. */
	head: { start: FlowHead; end: FlowHead }
	line: 'solid' | 'dotted' | 'thick' | 'invisible'
}

export type FlowHead = 'none' | 'arrow' | 'dot' | 'cross'

export interface Flowchart {
	direction: FlowDirection
	nodes: FlowNode[]
	edges: FlowEdge[]
}

const HEADER = /^(?:graph|flowchart)(?:\s+(TB|TD|BT|LR|RL))?\s*;?\s*$/i

/** Whether the text is a Mermaid flowchart, fenced in ```mermaid or not. */
export function isMermaidFlowchart(text: string): boolean {
	const first = statementsOf(text)[0]
	return first !== undefined && HEADER.test(first)
}

/** The flowchart in the text, or `null` if it isn't one or has nothing in it. */
export function parseFlowchart(text: string): Flowchart | null {
	const [header, ...statements] = statementsOf(text)
	const match = header ? HEADER.exec(header) : null
	if (!match) return null
	const dir = (match[1] ?? 'TB').toUpperCase()
	const direction: FlowDirection = dir === 'TD' ? 'TB' : (dir as FlowDirection)

	const nodes = new Map<string, FlowNode>()
	const edges: FlowEdge[] = []
	const node = (ref: NodeRef) => {
		const existing = nodes.get(ref.id)
		if (!existing) nodes.set(ref.id, { id: ref.id, label: ref.label ?? ref.id, shape: ref.shape ?? 'rectangle' })
		else if (ref.label !== undefined) Object.assign(existing, { label: ref.label, shape: ref.shape ?? existing.shape })
		return ref.id
	}

	for (const statement of statements) {
		if (SKIPPED.test(statement)) continue
		const chain = readChain(statement)
		if (!chain) continue
		chain.groups.forEach((group) => group.forEach(node))
		chain.links.forEach((link, i) => {
			for (const from of chain.groups[i]!) {
				for (const to of chain.groups[i + 1]!) {
					edges.push({ from: from.id, to: to.id, label: link.label, head: link.head, line: link.line })
				}
			}
		})
	}
	if (!nodes.size) return null
	return { direction, nodes: [...nodes.values()], edges }
}

/** Statements that only style or group, read past. */
const SKIPPED = /^(?:subgraph\b|end$|classDef\b|class\b|style\b|linkStyle\b|click\b|direction\b|%%)/

/** The text's statements: lines and `;`-separated parts, without comments, fences or blanks. */
function statementsOf(text: string): string[] {
	return text
		.replace(/^\s*```\s*mermaid\s*$/im, '')
		.replace(/^\s*```\s*$/gm, '')
		.split('\n')
		.flatMap((line) => splitOutsideQuotes(line.replace(/%%.*$/, '')))
		.map((part) => part.trim())
		.filter(Boolean)
}

function splitOutsideQuotes(line: string): string[] {
	const parts: string[] = []
	let current = ''
	let quoted = false
	for (const char of line) {
		if (char === '"') quoted = !quoted
		if (char === ';' && !quoted) {
			parts.push(current)
			current = ''
		} else current += char
	}
	parts.push(current)
	return parts
}

interface NodeRef {
	id: string
	label?: string
	shape?: FlowNodeShape
}

interface Link {
	label: string
	head: FlowEdge['head']
	line: FlowEdge['line']
}

/** `A & B --> C -- text --> D`: groups of nodes with links between them, or `null` if it isn't one. */
function readChain(statement: string): { groups: NodeRef[][]; links: Link[] } | null {
	const scan = { text: statement, at: 0 }
	const groups: NodeRef[][] = []
	const links: Link[] = []
	const first = readGroup(scan)
	if (!first) return null
	groups.push(first)
	for (;;) {
		skipSpace(scan)
		if (scan.at >= scan.text.length) break
		const link = readLink(scan)
		if (!link) return groups.length > 1 ? { groups, links } : null
		skipSpace(scan)
		const next = readGroup(scan)
		if (!next) return null
		links.push(link)
		groups.push(next)
	}
	return { groups, links }
}

function skipSpace(scan: { text: string; at: number }) {
	while (scan.at < scan.text.length && /\s/.test(scan.text[scan.at]!)) scan.at++
}

function readGroup(scan: { text: string; at: number }): NodeRef[] | null {
	const group: NodeRef[] = []
	for (;;) {
		skipSpace(scan)
		const ref = readNode(scan)
		if (!ref) return null
		group.push(ref)
		skipSpace(scan)
		if (scan.text[scan.at] !== '&') return group
		scan.at++
	}
}

/** Shape brackets, longest opening first so `((` wins over `(`. */
const BRACKETS: [open: string, close: string, shape: FlowNodeShape][] = [
	['(((', ')))', 'circle'],
	['((', '))', 'circle'],
	['([', '])', 'stadium'],
	['[[', ']]', 'subroutine'],
	['[(', ')]', 'cylinder'],
	['{{', '}}', 'hexagon'],
	['[/', '/]', 'parallelogram'],
	['[\\', '\\]', 'parallelogram'],
	['[/', '\\]', 'trapezoid'],
	['[\\', '/]', 'trapezoid'],
	['[', ']', 'rectangle'],
	['(', ')', 'rounded'],
	['{', '}', 'diamond'],
	['>', ']', 'flag'],
]

function readNode(scan: { text: string; at: number }): NodeRef | null {
	const id = /^[\p{L}\p{N}_]+(?:[.-](?![-.=>])[\p{L}\p{N}_]+)*/u.exec(scan.text.slice(scan.at))?.[0]
	if (!id) return null
	scan.at += id.length
	const rest = scan.text.slice(scan.at)
	for (const [open, close, shape] of BRACKETS) {
		if (!rest.startsWith(open)) continue
		const end = findClose(rest, open.length, close)
		if (end < 0) continue
		scan.at += end + close.length
		// `:::className` after a node styles it; read past.
		const styled = /^:::[\w-]+/.exec(scan.text.slice(scan.at))
		if (styled) scan.at += styled[0].length
		return { id, label: cleanLabel(rest.slice(open.length, end)), shape }
	}
	const styled = /^:::[\w-]+/.exec(rest)
	if (styled) scan.at += styled[0].length
	return { id }
}

/** Where the closing bracket is, skipping over a quoted label. */
function findClose(text: string, from: number, close: string): number {
	let quoted = false
	for (let i = from; i < text.length; i++) {
		if (text[i] === '"') quoted = !quoted
		else if (!quoted && text.startsWith(close, i)) return i
	}
	return -1
}

function cleanLabel(raw: string): string {
	let label = raw.trim()
	if (label.startsWith('"') && label.endsWith('"') && label.length > 1) label = label.slice(1, -1)
	// Markdown strings (`"`…`"`) keep their text.
	if (label.startsWith('`') && label.endsWith('`') && label.length > 1) label = label.slice(1, -1)
	return label
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/#quot;/g, '"')
		.replace(/#amp;/g, '&')
		.replace(/#lt;/g, '<')
		.replace(/#gt;/g, '>')
		.trim()
}

/**
 * A link, with its label after it if any: `-->|text|`, `---`, `-.->`, `==>`, `<-->`, `--o`, `~~~`.
 * Without a head it takes three: `--` alone opens a labelled link instead.
 */
const LINK =
	/^(<|o|x)?(?:(-{2,}|={2,}|-\.+-)(>|o|x)|(-{3,}|={3,}|-\.+-|~{3,}))(?![-=.>])(?:\s*\|([^|]*)\|)?/
/** A link with its label inside: `-- text -->`, `-. text .->`, `== text ==>`. */
const LABELLED_LINK = /^(<|o|x)?(--|==|-\.)(?![-=.>])\s*(.+?)\s*(-{2,}|={2,}|\.-+)(>|o|x)?(?![-=])/

function readLink(scan: { text: string; at: number }): Link | null {
	const rest = scan.text.slice(scan.at)
	const plain = LINK.exec(rest)
	if (plain) {
		scan.at += plain[0].length
		return link(plain[1], plain[2] ?? plain[4]!, plain[3], plain[5] ?? '')
	}
	const labelled = LABELLED_LINK.exec(rest)
	if (labelled) {
		scan.at += labelled[0].length
		return link(labelled[1], labelled[2]! + labelled[4]!, labelled[5], labelled[3]!)
	}
	return null
}

function link(start: string | undefined, body: string, end: string | undefined, label: string): Link {
	const head = (mark: string | undefined): FlowHead =>
		mark === '>' || mark === '<' ? 'arrow' : mark === 'o' ? 'dot' : mark === 'x' ? 'cross' : 'none'
	return {
		label: cleanLabel(label),
		head: { start: head(start), end: head(end) },
		line: body.startsWith('~') ? 'invisible' : body.includes('.') ? 'dotted' : body.startsWith('=') ? 'thick' : 'solid',
	}
}
