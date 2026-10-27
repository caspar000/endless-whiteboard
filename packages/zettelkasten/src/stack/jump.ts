/** The dock's "Go to" field, which the stack hands a digit to: a digit pressed over the stack begins an id. */
let field: HTMLInputElement | null = null

export function registerJumpField(input: HTMLInputElement | null): () => void {
	field = input
	return () => {
		if (field === input) field = null
	}
}

export function beginJump(text: string): void {
	if (!field) return
	field.value = text
	field.focus()
}
