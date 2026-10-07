const escape = (value: string) =>
	value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The page around a server-rendered form: the web app sits behind these pages, so it can't draw them. */
function page(body: string): string {
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
	form, main { width: min(340px, 100vw - 48px); display: grid; gap: 12px; }
	h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
	label { display: grid; gap: 6px; color: #a9a9b2; font-size: 13px; }
	input, button { font: inherit; padding: 10px 12px; border-radius: 8px; border: 1px solid #3a3a44; }
	input { background: #17171a; color: inherit; }
	input:focus { outline: 2px solid #6c8cff; outline-offset: 1px; }
	button { background: #6c8cff; border-color: #6c8cff; color: #0c0c0e; font-weight: 600; cursor: pointer; }
	button:hover { background: #7f9bff; }
	p { margin: 0; color: #a9a9b2; }
	p[role="alert"] { color: #ff8a8a; }
	a { color: #9fb3ff; }
</style>
</head>
<body>
${body}
</body>
</html>
`
}

const alert = (error: string | undefined) => (error ? `<p role="alert">${escape(error)}</p>` : '')

/** Server-rendered on purpose: the web app itself sits behind this page, so it can't draw it. */
export function loginPage({ next, error, username = '' }: { next: string; error?: string | undefined; username?: string }): string {
	return page(`<form method="post" action="/login">
	<h1>Lifeboard</h1>
	${alert(error)}
	<input name="username" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escape(username)}" required ${username ? '' : 'autofocus'}>
	<input type="password" name="password" placeholder="Password" autocomplete="current-password" required ${username ? 'autofocus' : ''}>
	<input type="hidden" name="next" value="${escape(next)}">
	<button type="submit">Log in</button>
</form>`)
}

/** Accepting an invite: the new account's name and password, and a name for a vault of its own. */
export function invitePage({
	token,
	invitedBy,
	vaultName,
	error,
	values = {},
}: {
	token: string
	invitedBy: string
	/** The vault being joined; absent when the account gets a vault of its own. */
	vaultName?: string | undefined
	error?: string | undefined
	values?: { username?: string; displayName?: string; vault?: string }
}): string {
	const what = vaultName
		? `${escape(invitedBy)} invited you to join <strong>${escape(vaultName)}</strong>: you’ll see and edit its boards.`
		: `${escape(invitedBy)} invited you to Lifeboard, with a vault of your own.`
	return page(`<form method="post" action="/invite/${escape(token)}">
	<h1>Join Lifeboard</h1>
	<p>${what}</p>
	${alert(error)}
	<label>Your name<input name="displayName" autocomplete="name" value="${escape(values.displayName ?? '')}" required autofocus></label>
	<label>Username<input name="username" autocomplete="username" autocapitalize="none" spellcheck="false" value="${escape(values.username ?? '')}" required></label>
	<label>Password, 12 characters or more<input type="password" name="password" autocomplete="new-password" minlength="12" required></label>
	${vaultName ? '' : `<label>Name your vault<input name="vault" value="${escape(values.vault ?? '')}" placeholder="My boards" required></label>`}
	<button type="submit">Create my account</button>
</form>`)
}

/** Replacing a password someone else chose, on the first login with it. */
export function passwordPage({ next, error }: { next: string; error?: string | undefined }): string {
	return page(`<form method="post" action="/password">
	<h1>Choose your password</h1>
	<p>You logged in with a password someone else chose. Pick your own; they won’t know it.</p>
	${alert(error)}
	<label>New password, 12 characters or more<input type="password" name="password" autocomplete="new-password" minlength="12" required autofocus></label>
	<label>Once more<input type="password" name="again" autocomplete="new-password" minlength="12" required></label>
	<input type="hidden" name="next" value="${escape(next)}">
	<button type="submit">Save and continue</button>
</form>`)
}

/** A link that can't be followed: used, expired, withdrawn, or never was. */
export function deadLinkPage(message: string): string {
	return page(`<main><h1>Lifeboard</h1><p>${escape(message)}</p><p><a href="/">Open Lifeboard</a></p></main>`)
}
