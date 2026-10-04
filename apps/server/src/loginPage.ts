const escape = (value: string) =>
	value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Server-rendered on purpose: the web app itself sits behind this page, so it can't draw it. */
export function loginPage({ next, error }: { next: string; error?: string | undefined }): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Lifeboard</title>
<link rel="icon" href="/favicon.svg">
<style>
	body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c0c0e; color: #ececed; font: 15px/1.4 system-ui, sans-serif; }
	form { width: min(320px, 100vw - 48px); display: grid; gap: 12px; }
	h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
	input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #3a3a44; }
	input { background: #17171a; color: inherit; }
	input:focus { outline: 2px solid #6c8cff; outline-offset: 1px; }
	button { background: #6c8cff; border-color: #6c8cff; color: #0c0c0e; font-weight: 600; cursor: pointer; }
	button:hover { background: #7f9bff; }
	p { margin: 0; color: #ff8a8a; }
</style>
</head>
<body>
<form method="post" action="/login">
	<h1>Lifeboard</h1>
	${error ? `<p role="alert">${escape(error)}</p>` : ''}
	<input type="password" name="password" placeholder="Password" autocomplete="current-password" required autofocus>
	<input type="hidden" name="next" value="${escape(next)}">
	<button type="submit">Log in</button>
</form>
</body>
</html>
`
}
