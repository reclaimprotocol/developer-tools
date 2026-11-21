/* eslint-disable @stylistic/max-len */
/** Safe machine diagnostics only; never include model prose or transport messages. */
export interface EmailAiDiagnostic {
	httpStatus?: number
	providerCode?: string
	providerType?: string
	requestId?: string
	responseStatus?: string
	incompleteReason?: string
	stage?: 'request' | 'response_body' | 'response_json' | 'response_output'
	reason?: string
	transportCode?: string
}
export class EmailAiError extends Error {
	readonly code: string
	readonly diagnostic?: Readonly<EmailAiDiagnostic>
	constructor(code: string, diagnostic?: Readonly<EmailAiDiagnostic>) {
		super(code)
		this.code = code
		this.diagnostic = diagnostic
		this.name = 'EmailAiError'
	}
}
/** Late, non-cooperative transport completion must never become a checked result. */
export async function emailAiAbortable<T>(
	work: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(new EmailAiError('EMAIL_AI_CANCELLED'))
		signal.addEventListener('abort', abort, { once: true })
		work
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort))
		if(signal.aborted) {
			abort()
		}
	})
}
