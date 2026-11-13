/* eslint-disable @stylistic/max-len */
/** Explicit server-only export. Importing the core/protocol never loads this module. */
import { CodeChallengeMethod, OAuth2Client } from 'google-auth-library'
import { gmailRateLimiter, waitForGmailDelay } from './google-throttle.ts'
import { normalizeEmailMailbox } from './sender.ts'

export const GMAIL_READONLY = 'https://www.googleapis.com/auth/gmail.readonly'
export interface GoogleEmailConfig {
	clientId: string
	clientSecret: string
	redirectUri: string
}
const googleReasons = new Set([
	'badRequest',
	'invalidArgument',
	'failedPrecondition',
	'authError',
	'invalidCredentials',
	'insufficientPermissions',
	'forbidden',
	'notFound',
	'accessNotConfigured',
	'domainPolicy',
	'dailyLimitExceeded',
	'quotaExceeded',
	'rateLimitExceeded',
	'userRateLimitExceeded',
	'backendError',
	'INVALID_ARGUMENT',
	'FAILED_PRECONDITION',
	'UNAUTHENTICATED',
	'PERMISSION_DENIED',
	'NOT_FOUND',
	'RESOURCE_EXHAUSTED',
	'INTERNAL',
	'UNAVAILABLE',
	'DEADLINE_EXCEEDED',
])
const networkCodes = new Set([
	'ENOTFOUND',
	'EAI_AGAIN',
	'ECONNREFUSED',
	'ECONNRESET',
	'ETIMEDOUT',
	'ENETUNREACH',
	'EHOSTUNREACH',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET',
])
export interface GoogleEmailDiagnostic {
	operation?: 'list' | 'metadata' | 'full' | 'raw' | 'attachment' | 'profile'
	httpStatus?: number
	reason?: string
	networkCode?: string
	retryAfterMs?: number
}
export class GoogleEmailError extends Error {
	readonly code:
		| 'GOOGLE_TIMEOUT'
		| 'GOOGLE_UNAVAILABLE'
		| 'GOOGLE_SCOPE'
		| 'GOOGLE_RATE_LIMIT'
		| 'GOOGLE_REJECTED'
		| 'EMAIL_TOO_LARGE'
	readonly diagnostic?: Readonly<GoogleEmailDiagnostic>
	constructor(
		code: GoogleEmailError['code'],
		diagnostic?: Readonly<GoogleEmailDiagnostic>,
	) {
		super(code)
		this.code = code
		this.diagnostic = diagnostic
	}
}
function googleOperation(path: string): GoogleEmailDiagnostic['operation'] {
	if(path === '/profile') {
		return 'profile'
	}

	if(path.startsWith('/messages?')) {
		return 'list'
	}

	if(path.startsWith('/messages/')) {
		if(path.includes('/attachments/')) {
			return 'attachment'
		}

		const format = new URLSearchParams(path.split('?')[1]).get('format')
		return format === 'raw' || format === 'full' ? format : 'metadata'
	}
}

/** Retain only documented machine codes, never Google's message, URLs or response body. */
async function googleFailureReason(
	response: Response,
): Promise<string | undefined> {
	const reader = response.body?.getReader()
	if(!reader) {
		return
	}

	try {
		const chunks: Uint8Array[] = []
		let length = 0
		for(;;) {
			const part = await reader.read()
			if(part.done) {
				break
			}

			length += part.value.length
			if(length > 65536) {
				return
			}

			chunks.push(part.value)
		}

		const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
		const reasons = Array.isArray(data?.error?.errors)
			? data.error.errors.map((e: { reason?: unknown } | null) => e?.reason)
			: []
		return [...reasons, data?.error?.status].find(
			(reason) => typeof reason === 'string' && googleReasons.has(reason),
		)
	} catch{
		return
	} finally {
		await reader.cancel().catch(() => {})
	}
}

function networkCode(error: unknown): string | undefined {
	const e = error as { code?: unknown, cause?: { code?: unknown } } | null
	const code = e?.cause?.code ?? e?.code
	return typeof code === 'string' && networkCodes.has(code) ? code : undefined
}

function client(config: GoogleEmailConfig, signal?: AbortSignal): OAuth2Client {
	const boundedSignal = AbortSignal.any([
		AbortSignal.timeout(10000),
		...(signal ? [signal] : []),
	])
	const oauth = new OAuth2Client({
		clientId: config.clientId,
		clientSecret: config.clientSecret,
		redirectUri: config.redirectUri,
	})
	// Public Gaxios interceptor: override per-method retries and keep revocation credentials in a POST body.
	oauth.transporter.interceptors.request.add({
		resolved: async(options) => {
			const url = new URL(options.url)
			if(
				url.origin !== 'https://oauth2.googleapis.com' ||
				!['/token', '/revoke'].includes(url.pathname)
			) {
				throw new GoogleEmailError('GOOGLE_REJECTED')
			}

			if(url.pathname === '/revoke') {
				const body = new URLSearchParams({
					token: url.searchParams.get('token') ?? '',
				})
				url.search = ''
				options.url = url
				options.body = body
				options.headers.set('Content-Type', 'application/x-www-form-urlencoded')
			}

			options.retry = false
			options.timeout = 10000
			options.maxRedirects = 0
			options.signal = boundedSignal
			options.fetchImplementation = async(input, init) => {
				const response = await fetch(String(input), {
					...init,
					signal: boundedSignal,
					redirect: 'error',
					cache: 'no-store',
				})
				const reader = response.body?.getReader()
				const chunks: Uint8Array[] = []
				let length = 0
				try {
					if(reader) {
						for(;;) {
							const part = await reader.read()
							if(part.done) {
								break
							}

							length += part.value.length
							if(length > 65536) {
								throw new GoogleEmailError('GOOGLE_REJECTED')
							}

							chunks.push(part.value)
						}
					}

					return new Response(Buffer.concat(chunks), {
						status: response.status,
						headers: response.headers,
					})
				} finally {
					await reader?.cancel()
				}
			}

			return options
		},
	})
	return oauth
}

export function googleAuthorizationUrl(
	config: GoogleEmailConfig,
	state: string,
	challenge: string,
): string {
	return client(config).generateAuthUrl({
		scope: [GMAIL_READONLY],
		access_type: 'online',
		state,
		code_challenge: challenge,
		code_challenge_method: CodeChallengeMethod.S256,
		include_granted_scopes: false,
		prompt: 'select_account consent',
	})
}

export async function googlePkce(config: GoogleEmailConfig) {
	const p = await client(config).generateCodeVerifierAsync()
	return { verifier: p.codeVerifier, challenge: p.codeChallenge! }
}

export async function googleExchangeCode(
	config: GoogleEmailConfig,
	code: string,
	verifier: string,
	signal?: AbortSignal,
) {
	try {
		const { tokens } = await client(config, signal).getToken({
			code,
			codeVerifier: verifier,
			redirect_uri: config.redirectUri,
		})
		if(
			!tokens.access_token ||
			!tokens.scope?.split(/\s+/).includes(GMAIL_READONLY)
		) {
			if(tokens.access_token) {
				await googleRevokeToken(config, tokens.access_token)
			}

			throw new GoogleEmailError('GOOGLE_SCOPE')
		}

		return {
			access_token: tokens.access_token,
			expires_in: Math.max(
				0,
				((tokens.expiry_date ?? Date.now()) - Date.now()) / 1000,
			),
			scope: tokens.scope,
		}
	} catch(error) {
		if(error instanceof GoogleEmailError) {
			throw error
		}

		throw new GoogleEmailError(
			signal?.aborted ? 'GOOGLE_TIMEOUT' : 'GOOGLE_REJECTED',
		)
	}
}

export async function googleRevokeToken(
	config: GoogleEmailConfig,
	token: string,
): Promise<boolean> {
	try {
		await client(config, AbortSignal.timeout(5000)).revokeToken(token)
		return true
	} catch{
		return false
	}
}

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
function retryAfter(headers: Headers): number {
	const value = headers.get('retry-after')?.trim()
	if(!value) {
		return 0
	}

	const ms = /^[0-9]+(?:[.][0-9]+)?$/.test(value)
		? Number(value) * 1000
		: Date.parse(value) - Date.now()
	return Number.isFinite(ms) ? Math.max(0, Math.min(ms, 86400_000)) : 0
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- core copy: callers check each Gmail JSON field at run time
export async function gmailRequest<T = any>(
	token: string,
	path: string,
	signal?: AbortSignal,
	limit = 512 * 1024,
): Promise<T> {
	const controller = AbortSignal.any([
		AbortSignal.timeout(10000),
		...(signal ? [signal] : []),
	])
	const deadline = Date.now() + 10000,
		operation = googleOperation(path)
	const cost =
		operation === 'profile'
			? 1
			: operation === 'list'
				? 5
				: operation === 'raw' || operation === 'full'
					? 60
					: 20
	let lastRateError: GoogleEmailError | undefined
	try {
		for(let attempt = 0; attempt < 3; attempt++) {
			const waiting = await gmailRateLimiter.acquire(
				token,
				cost,
				deadline,
				controller,
			)
			if(waiting) {
				throw new GoogleEmailError('GOOGLE_RATE_LIMIT', {
					operation,
					retryAfterMs: waiting,
				})
			}

			const res = await fetch(`${API}${path}`, {
				headers: { Authorization: `Bearer ${token}` },
				signal: controller,
				redirect: 'error',
				cache: 'no-store',
			})
			if(!res.ok) {
				const reason = await googleFailureReason(res)
				const rateLimited =
					res.status === 429 ||
					(res.status === 403 &&
						[
							'rateLimitExceeded',
							'userRateLimitExceeded',
							'RESOURCE_EXHAUSTED',
						].includes(reason ?? ''))
				const transient = [500, 502, 503, 504].includes(res.status)
				const permission =
					res.status === 403 &&
					[
						'insufficientPermissions',
						'forbidden',
						'domainPolicy',
						'PERMISSION_DENIED',
					].includes(reason ?? '')
				const code = rateLimited
					? 'GOOGLE_RATE_LIMIT'
					: transient
						? 'GOOGLE_UNAVAILABLE'
						: permission
							? 'GOOGLE_SCOPE'
							: 'GOOGLE_REJECTED'
				const delay =
					rateLimited || transient
						? Math.max(
							retryAfter(res.headers),
							1000 * 2 ** attempt + Math.floor(Math.random() * 250),
						)
						: 0
				const error = new GoogleEmailError(code, {
					operation,
					httpStatus: res.status,
					reason,
					...(rateLimited ? { retryAfterMs: delay } : {}),
				})
				if(rateLimited) {
					lastRateError = error
					gmailRateLimiter.defer(token, delay)
				}

				if(
					!(rateLimited || transient) ||
					attempt === 2 ||
					delay >= deadline - Date.now()
				) {
					throw error
				}

				await waitForGmailDelay(delay, controller)
				continue
			}

			if(!res.body) {
				throw new GoogleEmailError('GOOGLE_UNAVAILABLE')
			}

			const reader = res.body.getReader()
			const chunks: Uint8Array[] = []
			let size = 0
			try {
				for(;;) {
					const part = await reader.read()
					// eslint-disable-next-line max-depth
					if(part.done) {
						break
					}

					size += part.value.length
					// eslint-disable-next-line max-depth
					if(size > limit) {
						throw new GoogleEmailError('EMAIL_TOO_LARGE')
					}

					chunks.push(part.value)
				}

				return JSON.parse(Buffer.concat(chunks).toString('utf8'))
			} finally {
				await reader.cancel()
			}
		}

		throw new GoogleEmailError('GOOGLE_UNAVAILABLE')
	} catch(error) {
		if(error instanceof GoogleEmailError) {
			throw error
		}

		if(lastRateError && controller.aborted && !signal?.aborted) {
			throw new GoogleEmailError('GOOGLE_RATE_LIMIT', {
				...lastRateError.diagnostic,
				retryAfterMs: Math.max(1000, gmailRateLimiter.remaining(token)),
			})
		}

		throw new GoogleEmailError(
			controller.aborted ? 'GOOGLE_TIMEOUT' : 'GOOGLE_UNAVAILABLE',
			{ operation, networkCode: networkCode(error) },
		)
	}
}

export async function gmailProfile(
	token: string,
	signal?: AbortSignal,
): Promise<{ emailAddress: string }> {
	const p = await gmailRequest(token, '/profile', signal)
	return { emailAddress: normalizeEmailMailbox(p.emailAddress) }
}

export {
	searchGmailOwned,
	initialGmailSearch,
	sixMonthsEarlier,
	validateGmailQuery,
} from './gmail-search.ts'
export type {
	GmailSummary,
	GmailSearchPosition,
	GmailSearchPage,
} from './gmail-search.ts'
export { gmailDisplay, gmailDisplayAttachment } from './gmail-display.ts'
export type { GmailDisplay } from './gmail-display.ts'
export async function gmailRaw(
	token: string,
	id: string,
	signal?: AbortSignal,
): Promise<Buffer> {
	if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
		throw new GoogleEmailError('GOOGLE_REJECTED')
	}

	const data = await gmailRequest(
		token,
		`/messages/${id}?format=raw`,
		signal,
		12 * 1024 * 1024,
	)
	if(
		typeof data.raw !== 'string' ||
		!/^[A-Za-z0-9_-]+={0,2}$/.test(data.raw) ||
		data.raw.length > Math.ceil((8 * 1024 * 1024 * 4) / 3)
	) {
		throw new GoogleEmailError('EMAIL_TOO_LARGE')
	}

	const raw = Buffer.from(data.raw, 'base64url')
	if(
		raw.length > 8 * 1024 * 1024 ||
		raw.toString('base64url') !== data.raw.replace(/=+$/, '')
	) {
		raw.fill(0)
		throw new GoogleEmailError('EMAIL_TOO_LARGE')
	}

	data.raw = undefined
	return raw
}
