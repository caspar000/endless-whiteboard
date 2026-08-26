import { contentImportFor, fileImportFor } from '@lifeboard/node-kit'
import { useEffect } from 'react'
import {
	defaultHandleExternalFileContent,
	defaultHandleExternalTextContent,
	defaultHandleExternalUrlContent,
	useEditor,
	useToasts,
	useTranslation,
	type TLFilesExternalContent,
} from 'tldraw'
import { MAX_IMPORT_BYTES } from '../persistence/downscale'

/**
 * Routes dropped and pasted files: ones an enabled extension claims (see `fileImportFor`) go to that
 * extension, everything else continues into tldraw's default pipeline — images, videos, `.tldr`
 * files — exactly as if this handler didn't exist.
 *
 * Rendered as a child of `<Tldraw>`, which is load-bearing twice over: it needs the UI context for
 * toasts, and children mount *after* tldraw's own `registerDefaultExternalContentHandlers` call, so
 * this registration is the one that sticks. tldraw keeps one handler per content type — the default
 * `files` handler isn't reachable once replaced, which is why it is re-invoked here explicitly via
 * the exported `defaultHandleExternalFileContent`.
 */
export function FileImportHandler() {
	const editor = useEditor()
	const toasts = useToasts()
	const msg = useTranslation()

	useEffect(() => {
		editor.registerExternalContentHandler('files', async (content: TLFilesExternalContent) => {
			const claimed: { file: File; onFile: NonNullable<ReturnType<typeof fileImportFor>>['onFile'] }[] = []
			const rest: File[] = []
			for (const file of content.files) {
				const fileImport = fileImportFor(file.name)
				if (!fileImport) {
					rest.push(file)
					continue
				}
				if (file.size > MAX_IMPORT_BYTES) {
					toasts.addToast({ title: 'Too large to import', description: file.name, severity: 'error' })
					continue
				}
				claimed.push({ file, onFile: fileImport.onFile })
			}

			// Sequential, not parallel: imports write to shared board state (the property registry),
			// and read-modify-write races there would drop definitions.
			const point = content.point ?? editor.getViewportPageBounds().center
			for (const [index, { file, onFile }] of claimed.entries()) {
				try {
					// Fanned out horizontally so a multi-file drop doesn't stack shapes on one spot.
					await onFile({ editor, file, point: { x: point.x + index * 220, y: point.y } })
				} catch (error) {
					console.error(`Failed to import ${file.name}`, error)
					toasts.addToast({ title: 'Could not import file', description: file.name, severity: 'error' })
				}
			}

			if (rest.length) {
				await defaultHandleExternalFileContent(
					editor,
					{ ...content, files: rest },
					// `maxAssetSize` mirrors the `<Tldraw maxAssetSize>` prop in Board.tsx; the image and
					// video MIME lists stay undefined so tldraw's own defaults apply.
					{ toasts, msg, maxAssetSize: MAX_IMPORT_BYTES }
				)
			}
		})
		/*
		 * The same arrangement for a dropped or pasted **URL** and for **text**.
		 *
		 * Files were the only content an extension could claim, which left the most obvious drop of all
		 * — a link — going to tldraw's bookmark card. A card is a fine thing to look at and cannot carry
		 * a property, join a table or appear in a view, which in this app is most of what content is
		 * for. So this opens the same door for the other two content types, and anything unclaimed
		 * continues into tldraw's pipeline exactly as before.
		 */
		editor.registerExternalContentHandler('url', async (content) => {
			const point = content.point ?? editor.getViewportPageBounds().center
			const claim = contentImportFor(content.url)
			if (!claim) {
				await defaultHandleExternalUrlContent(editor, content, { toasts, msg })
				return
			}
			try {
				await claim.onText({ editor, text: content.url, point })
			} catch (error) {
				console.error(`Failed to import ${content.url}`, error)
				toasts.addToast({ title: 'Could not import that link', severity: 'error' })
			}
		})

		editor.registerExternalContentHandler('text', async (content) => {
			const point = content.point ?? editor.getViewportPageBounds().center
			const claim = contentImportFor(content.text)
			if (!claim) {
				await defaultHandleExternalTextContent(editor, content)
				return
			}
			try {
				await claim.onText({ editor, text: content.text, point })
			} catch (error) {
				console.error('Failed to import pasted text', error)
				toasts.addToast({ title: 'Could not import that text', severity: 'error' })
			}
		})
		// No cleanup: the handler dies with the editor, and re-registration simply replaces it.
	}, [editor, toasts, msg])

	return null
}
