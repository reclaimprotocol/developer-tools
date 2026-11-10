import { looksLikeGraphqlEndpoint } from './graphql.ts'
import type { CapturedRequest, RequestConcern } from './schema.ts'

const SIGNATURE_HEADERS = [
	'x-signature',
	'x-amz-signature',
	'x-hub-signature',
	'x-hmac',
	'signature',
	'x-request-signature',
]

const CSRF_HEADERS = [
	'x-csrf-token',
	'x-xsrf-token',
	'csrf-token',
	'xsrf-token',
]

export function detectConcerns(req: CapturedRequest): RequestConcern[] {
	const concerns: RequestConcern[] = []
	const reqHeadersLower = lowerKeys(req.requestHeaders)
	const respHeadersLower = lowerKeys(req.responseHeaders)

	// Signed requests
	for(const h of SIGNATURE_HEADERS) {
		if(reqHeadersLower[h]) {
			concerns.push({
				code: 'signedRequest',
				message: `Request includes a "${h}" header — ` +
					'providers will break when the signing scheme rotates.',
			})
			break
		}
	}

	// Bot challenge
	const cfMitigated = respHeadersLower['cf-mitigated']
	const server = respHeadersLower['server'] ?? ''
	if(
		(req.status === 403 || req.status === 503) &&
		(cfMitigated === 'challenge' || /cloudflare/i.test(server))
	) {
		concerns.push({
			code: 'botChallenge',
			message:
				'Response looks like a bot-mitigation challenge (Cloudflare). ' +
				'Capture again after solving the challenge in the browser.',
		})
	}

	// GraphQL
	if(looksLikeGraphqlEndpoint(req.url)) {
		concerns.push({
			code: 'graphql',
			message:
				'Endpoint is GraphQL — ' +
				'match on operationName + variables, not URL path.',
		})
	}

	// CSRF dependency
	for(const h of CSRF_HEADERS) {
		if(reqHeadersLower[h]) {
			concerns.push({
				code: 'csrfDependency',
				message: `Request includes a "${h}" header — ` +
					'a prior request fetched this token. ' +
					'Replay will fail unless the token is still valid; ' +
					'expect to re-capture for proof.',
			})
			break
		}
	}

	// Short-lived token (JWT exp < 30 min from finishedAt)
	const auth = reqHeadersLower['authorization']
	if(auth) {
		const jwtMatch = auth.match(
			/^[Bb]earer\s+([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/,
		)
		if(jwtMatch) {
			const exp = jwtExpSeconds(jwtMatch[1])
			const issuedAtMs = req.finishedAt || Date.now()
			if(exp && exp * 1000 - issuedAtMs < 30 * 60 * 1000) {
				concerns.push({
					code: 'shortLivedToken',
					message:
						'Authorization is a JWT expiring in under 30 minutes — ' +
						'provider may stop working soon. Re-capture closer to proof time.',
				})
			}
		}
	}

	// Encrypted / binary body
	if(looksBinary(req.contentType, req.responseBody)) {
		concerns.push({
			code: 'encryptedBody',
			message: `Response content-type "${req.contentType}" is binary/opaque —` +
				' Reclaim providers need plain-text (JSON/HTML) responses.',
		})
	}

	return concerns
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
	return Object.fromEntries(
		Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]),
	)
}

function jwtExpSeconds(jwt: string): number | undefined {
	const parts = jwt.split('.')
	if(parts.length !== 3) {
		return undefined
	}

	try {
		const decoded = JSON.parse(
			Buffer.from(parts[1], 'base64url').toString('utf8'),
		)
		return typeof decoded.exp === 'number' ? decoded.exp : undefined
	} catch{
		return undefined
	}
}

function looksBinary(contentType: string, body: string | undefined): boolean {
	if(!body) {
		return false
	}

	if(/octet-stream|protobuf|msgpack|cbor/i.test(contentType)) {
		return true
	}

	// Heuristic: significant control-char density in first 256 bytes.
	const sample = body.slice(0, 256)
	let ctrl = 0
	for(const ch of sample) {
		const code = ch.charCodeAt(0)
		if(code < 9 || (code > 13 && code < 32)) {
			ctrl++
		}
	}

	return ctrl / sample.length > 0.1
}
