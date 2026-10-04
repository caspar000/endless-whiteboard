/**
 * Prints the `LIFEBOARD_PASSWORD_HASH` line for the server's `.env`.
 *
 *   pnpm --filter @lifeboard/server hash-password
 *
 * Reads the password without echoing it, or from stdin when piped.
 */
import { hashPassword } from './password.ts'

function readHidden(prompt: string): Promise<string> {
	const { stdin, stdout } = process
	if (!stdin.isTTY) {
		return new Promise((resolve) => {
			let data = ''
			stdin.setEncoding('utf8')
			stdin.on('data', (chunk) => (data += chunk))
			stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')))
		})
	}
	stdout.write(prompt)
	stdin.setRawMode(true)
	stdin.setEncoding('utf8')
	stdin.resume()
	return new Promise((resolve) => {
		let value = ''
		const onData = (key: string) => {
			if (key === '\u0003') process.exit(130) // Ctrl+C
			if (key === '\r' || key === '\n') {
				stdin.setRawMode(false)
				stdin.pause()
				stdin.off('data', onData)
				stdout.write('\n')
				resolve(value)
			} else if (key === '\u007f') value = value.slice(0, -1)
			else value += key
		}
		stdin.on('data', onData)
	})
}

const password = await readHidden('Password: ')
if (password.length < 12) {
	console.error('Use at least 12 characters: this password is all that stands between the internet and your boards.')
	process.exit(1)
}
if (process.stdin.isTTY && (await readHidden('Again: ')) !== password) {
	console.error('The passwords did not match.')
	process.exit(1)
}
// Single quotes, because Docker Compose would otherwise read the hash's `$` signs as variables.
console.log(`LIFEBOARD_PASSWORD_HASH='${await hashPassword(password)}'`)
