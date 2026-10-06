import type { Editor } from '../editor/Editor'
import type { SvgExportContext } from '../editor/types/SvgExportContext'
import type { TLShape } from '../editor/types/shape-types'
import type { TLShapeId } from '@tldraw/tlschema'

const XHTML = 'http://www.w3.org/1999/xhtml'
const SVG = 'http://www.w3.org/2000/svg'

/**
 * A shape drawn in HTML, exported as what it shows: its element on the canvas, copied into a
 * `<foreignObject>` with every computed style written inline, images and fonts embedded as data
 * URLs. Upstream exported such shapes as an empty box; today's tldraw draws their content, and
 * Lifeboard's thumbnails and agent vision show node cards through it.
 *
 * The canvas keeps off-screen shapes mounted (only hidden), so every shape has an element to copy.
 * Returns `null` when there is none, and the export falls back to a box.
 */
export async function exportShapeFromDom(
	editor: Editor,
	shape: TLShape,
	ctx: SvgExportContext
): Promise<SVGElement | null> {
	const source = shapeElement(editor, shape)
	if (!source) return null

	const bounds = editor.getShapeGeometry(shape).bounds
	const box = document.createElementNS(XHTML, 'div') as HTMLDivElement
	box.style.cssText = `position:relative;width:${bounds.width}px;height:${bounds.height}px;overflow:visible`

	const images: Promise<void>[] = []
	const families = new Set<string>()
	shown(source, () => {
		for (const child of Array.from(source.children)) {
			const copy = copyWithStyles(child, images, families)
			if (copy) box.appendChild(copy)
		}
	})
	await Promise.all(images)
	addFonts(ctx, families)
	return foreignObjectAround(box, bounds.minX, bounds.minY, bounds.width, bounds.height)
}

/**
 * A shape's label drawn in HTML (its rich text), exported as it shows, formatting and all: the
 * element `selector` finds in the shape's element, at the same place in the shape. tldraw 5 exports
 * labels this way too. Returns `null` when the shape shows no such element (an empty label), so the
 * caller can draw it another way.
 *
 * `keepTransform: false` drops the label's own CSS transform, for a label whose transform is a
 * scale the export applies anyway (the text shape's `scale`).
 */
export async function exportLabelFromDom(
	editor: Editor,
	shape: { id: TLShapeId },
	selector: string,
	ctx: SvgExportContext,
	{ keepTransform = true }: { keepTransform?: boolean } = {}
): Promise<SVGElement | null> {
	const source = shapeElement(editor, shape)
	const label = source?.querySelector<HTMLElement>(selector)
	if (!source || !label) return null

	const bounds = editor.getShapeGeometry(shape.id).bounds
	const images: Promise<void>[] = []
	const families = new Set<string>()
	const placed = shown(source, () => {
		// Where the label's box sits in the shape, before its own transform, which the copy keeps.
		let x = 0
		let y = 0
		for (let el: HTMLElement | null = label; el && el !== source; el = el.offsetParent as HTMLElement | null) {
			if (!source.contains(el)) return null
			x += el.offsetLeft
			y += el.offsetTop
		}
		const copy = copyWithStyles(label, images, families)
		if (!(copy instanceof HTMLElement)) return null
		copy.style.position = 'absolute'
		copy.style.left = `${x - bounds.minX}px`
		copy.style.top = `${y - bounds.minY}px`
		copy.style.margin = '0'
		if (!keepTransform) copy.style.transform = 'none'
		return copy
	})
	if (!placed) return null
	await Promise.all(images)
	addFonts(ctx, families)

	const box = document.createElementNS(XHTML, 'div') as HTMLDivElement
	box.style.cssText = `position:relative;width:${bounds.width}px;height:${bounds.height}px;overflow:visible`
	box.appendChild(placed)
	return foreignObjectAround(box, bounds.minX, bounds.minY, bounds.width, bounds.height)
}

function shapeElement(editor: Editor, shape: { id: TLShapeId }): HTMLElement | null {
	return editor
		.getContainer()
		.querySelector<HTMLElement>(`.tl-shape[data-shape-id="${CSS.escape(shape.id)}"]:not(.tl-shape-background)`)
}

/**
 * Runs `read` with the shape laid out. An off-screen shape is mounted but `display: none`, which
 * leaves its elements without positions or sizes to copy.
 */
function shown<T>(source: HTMLElement, read: () => T): T {
	const display = source.style.display
	if (display !== 'none') return read()
	source.style.display = 'block'
	try {
		return read()
	} finally {
		source.style.display = display
	}
}

/** One def per family, so fonts from every shape in the export are embedded, not only the first's. */
function addFonts(ctx: SvgExportContext, families: Set<string>): void {
	for (const family of families) {
		ctx.addExportDef({ key: `dom-export-font:${family}`, getElement: () => embeddedFonts(new Set([family])) })
	}
}

function foreignObjectAround(box: HTMLElement, x: number, y: number, width: number, height: number) {
	const foreignObject = document.createElementNS(SVG, 'foreignObject')
	foreignObject.setAttribute('x', String(x))
	foreignObject.setAttribute('y', String(y))
	foreignObject.setAttribute('width', String(width))
	foreignObject.setAttribute('height', String(height))
	foreignObject.setAttribute('overflow', 'visible')
	foreignObject.appendChild(box)
	return foreignObject
}

/** Properties not worth carrying: custom properties (their values are already resolved) and pointer behaviour. */
const SKIPPED = /^(--|pointer-events|cursor|user-select|-webkit-user-select|transition|animation|will-change)/

/**
 * Inherited properties are written even when they match the default: in the copy, an element's
 * parent may carry a different value, which it would otherwise inherit.
 */
const INHERITED =
	/^(color|font|line-height|letter-spacing|word-spacing|text-(align|indent|transform|shadow|rendering)|white-space|word-break|overflow-wrap|visibility|direction|list-style|fill|stroke|hyphens|tab-size|-webkit-text|-webkit-font-smoothing)/

/**
 * A copy of `element` and everything in it, each with its computed style inline where it differs
 * from that element type's default. Canvases become images; `<img>` sources become data URLs.
 */
function copyWithStyles(element: Element, images: Promise<void>[], families: Set<string>): Element | null {
	if (element instanceof HTMLScriptElement || element instanceof HTMLStyleElement) return null

	const computed = getComputedStyle(element)
	if (computed.display === 'none') return null

	let copy: Element
	if (element instanceof HTMLCanvasElement) {
		const image = document.createElementNS(XHTML, 'img') as HTMLImageElement
		try {
			image.src = element.toDataURL()
		} catch {
			// A tainted canvas can't be read; leave the space it took.
		}
		copy = image
	} else {
		copy = element.cloneNode(false) as Element
	}

	const defaults = defaultStyleFor(element)
	const style: string[] = []
	for (let i = 0; i < computed.length; i++) {
		const property = computed[i]!
		if (SKIPPED.test(property)) continue
		const value = computed.getPropertyValue(property)
		if (value === defaults.get(property) && !INHERITED.test(property)) continue
		style.push(`${property}:${value}`)
	}
	copy.setAttribute('style', style.join(';'))
	copy.removeAttribute('class')

	const family = computed.fontFamily.split(',')[0]?.trim().replace(/^["']|["']$/g, '')
	if (family) families.add(family)

	if (copy instanceof HTMLImageElement && element instanceof HTMLImageElement && element.currentSrc) {
		const target = copy
		images.push(toDataUrl(element.currentSrc).then((url) => void (target.src = url ?? '')))
	}
	const background = computed.backgroundImage
	if (background.includes('url(')) {
		images.push(inlineCssUrls(background).then((value) => replaceStyle(copy, 'background-image', value)))
	}
	if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
		copy.setAttribute('value', element.value)
		if (element instanceof HTMLTextAreaElement) copy.textContent = element.value
	}

	if (!(element instanceof HTMLCanvasElement)) {
		for (const child of Array.from(element.childNodes)) {
			if (child.nodeType === Node.TEXT_NODE) copy.appendChild(child.cloneNode())
			else if (child instanceof Element) {
				const childCopy = copyWithStyles(child, images, families)
				if (childCopy) copy.appendChild(childCopy)
			}
		}
	}
	return copy
}

function replaceStyle(element: Element, property: string, value: string): void {
	const style = element.getAttribute('style') ?? ''
	element.setAttribute(
		'style',
		style
			.split(';')
			.filter((part) => !part.startsWith(`${property}:`))
			.concat(`${property}:${value}`)
			.join(';')
	)
}

/** Each element type's styles in a page with no stylesheets, so only what differs is written. */
const defaultStyles = new Map<string, Map<string, string>>()
let sandbox: HTMLIFrameElement | null = null

function defaultStyleFor(element: Element): Map<string, string> {
	const key = `${element.namespaceURI}|${element.localName}`
	const known = defaultStyles.get(key)
	if (known) return known

	if (!sandbox) {
		sandbox = document.createElement('iframe')
		sandbox.style.cssText = 'position:absolute;width:0;height:0;border:0;visibility:hidden'
		sandbox.setAttribute('aria-hidden', 'true')
		document.body.appendChild(sandbox)
	}
	const doc = sandbox.contentDocument!
	const probe =
		element.namespaceURI === SVG
			? doc.body.appendChild(doc.createElementNS(SVG, 'svg')).appendChild(doc.createElementNS(SVG, element.localName))
			: doc.body.appendChild(doc.createElement(element.localName))
	const computed = sandbox.contentWindow!.getComputedStyle(probe)
	const values = new Map<string, string>()
	for (let i = 0; i < computed.length; i++) {
		const property = computed[i]!
		values.set(property, computed.getPropertyValue(property))
	}
	doc.body.replaceChildren()
	defaultStyles.set(key, values)
	return values
}

const dataUrls = new Map<string, Promise<string | null>>()

/** The resource at `url` as a data URL, or `null` if it can't be fetched. */
function toDataUrl(url: string): Promise<string | null> {
	if (url.startsWith('data:')) return Promise.resolve(url)
	let pending = dataUrls.get(url)
	if (!pending) {
		pending = fetch(url)
			.then((response) => (response.ok ? response.blob() : null))
			.then(
				(blob) =>
					blob &&
					new Promise<string>((resolve, reject) => {
						const reader = new FileReader()
						reader.onload = () => resolve(reader.result as string)
						reader.onerror = () => reject(reader.error)
						reader.readAsDataURL(blob)
					})
			)
			.catch(() => null)
		dataUrls.set(url, pending)
	}
	return pending
}

/** A CSS value with each `url(…)` replaced by its data URL. */
async function inlineCssUrls(value: string): Promise<string> {
	const urls = [...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]!)
	let result = value
	for (const url of urls) {
		const data = await toDataUrl(new URL(url, location.href).href)
		if (data) result = result.split(url).join(data)
	}
	return result
}

const fontSources = new WeakMap<FontFace, string>()

/**
 * Tells exports where a font added through `document.fonts` came from, so a picture that uses it can
 * embed it: such a font has no `@font-face` rule to read.
 *
 * @public
 */
export function registerFontSource(font: FontFace, url: string): void {
	fontSources.set(font, url)
}

/**
 * `@font-face` rules, their files embedded, for every registered face of `family` (regular, bold,
 * italic, as many as were loaded), so bold and italic text keep their own faces in the picture.
 *
 * @public
 */
export async function getRegisteredFontFaceRules(family: string): Promise<string[]> {
	const rules: string[] = []
	for (const font of document.fonts) {
		const url = fontSources.get(font)
		if (font.family.replace(/^["']|["']$/g, '') !== family || !url) continue
		const data = await toDataUrl(new URL(url, location.href).href)
		if (!data) continue
		rules.push(
			`@font-face { font-family: ${family}; font-weight: ${font.weight}; font-style: ${font.style}; src: url("${data}") format("woff2") }`
		)
	}
	return rules
}

/** A `<style>` with the page's `@font-face` rules for these families, their files embedded. */
async function embeddedFonts(families: Set<string>): Promise<SVGElement | null> {
	const rules: string[] = []
	for (const family of families) rules.push(...(await getRegisteredFontFaceRules(family)))
	for (const sheet of Array.from(document.styleSheets)) {
		let cssRules: CSSRuleList
		try {
			cssRules = sheet.cssRules
		} catch {
			continue // another origin's stylesheet
		}
		for (const rule of Array.from(cssRules)) {
			if (!(rule instanceof CSSFontFaceRule)) continue
			const family = rule.style.getPropertyValue('font-family').trim().replace(/^["']|["']$/g, '')
			if (!families.has(family)) continue
			const base = sheet.href ?? location.href
			const src = rule.style.getPropertyValue('src')
			const urls = [...src.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]!)
			let inlined = rule.cssText
			for (const url of urls) {
				const data = await toDataUrl(new URL(url, base).href)
				if (data) inlined = inlined.split(url).join(data)
			}
			rules.push(inlined)
		}
	}
	if (!rules.length) return null
	const style = document.createElementNS(SVG, 'style')
	style.textContent = rules.join('\n')
	return style
}
