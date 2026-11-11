export function legacyErrorClass(name: string) {
	return class extends Error {
		readonly innerError?: unknown

		constructor(message?: string, innerError?: unknown) {
			super(innerError
				? `${message ?? ''} caused by ${String(innerError)}`
				: message)
			this.name = name
			this.innerError = innerError
		}
	}
}
