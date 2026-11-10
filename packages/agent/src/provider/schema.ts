import type { ProviderParams } from '@reclaimprotocol/attestor-core'

/** The attestor's HTTP provider parameters — the canonical source for the
 *  request/match/redaction shapes we draft. */
type HttpParams = ProviderParams<'http'>

/** HTTP methods the attestor accepts. */
export type HttpMethod = HttpParams['method']

/**
 * A pattern the attestor checks against the revealed slice of the response.
 * The prover selectively reveals portions of the TLS response (via
 * responseRedactions), so the attestor only ever sees a substring —
 * jsonPath/xPath belong on the redaction, not here.
 */
export type ResponseMatch = HttpParams['responseMatches'][number]

/**
 * A response match as drafted for PUBLISH: the attestor's match plus
 * `isOptional` — a backend-side matcher flag (both the old devtools backend
 * and the builder store it; the attestor's own params have no such field, so
 * `propose_provider` drafts never set it — only an explicit publish input
 * does). Default false on both backends.
 */
export type DraftResponseMatch = ResponseMatch & { isOptional?: boolean }

/** How the verification client supplies cookies/auth when replaying a
 *  request. Both backends accept the same enum (old devtools on
 *  `requestData`, builder on `RequestSelection`); default `include`. */
export type WebCredentials = 'omit' | 'same-origin' | 'include'

/** Old-devtools `urlType` for a requestData entry. The builder backend has
 *  no such field (templating is implicit in the URL's `{{param}}`
 *  placeholders), so the builder translator ignores it. */
export type OldUrlType = 'REGEX' | 'CONSTANT' | 'TEMPLATE'

/**
 * Selector telling the prover which portion of the response to reveal:
 * `xPath`/`jsonPath` narrows the slice, `regex` (with named groups) matches
 * within, and `hash` applies an OPRF so the attestor sees a nullifier
 * instead of the cleartext value.
 */
export type ResponseRedaction =
	NonNullable<HttpParams['responseRedactions']>[number]

/**
 * OPRF mode for hashed redactions:
 *  - `oprf-mpc` — TEE-based MPC OPRF. The default for the cloud/hosted flow: a
 *    TEE attestor accepts (and expects) this and REJECTS `oprf-raw`.
 *  - `oprf` — client-side ZK OPRF via gnark (needs the gnark deps).
 *  - `oprf-raw` — server-side OPRF, no external deps; the local dev-loop
 *    default (Windows / non-TEE). Weakest of the three (the attestor
 *    participates in hashing) and not accepted by a TEE attestor.
 */
export type OprfMode = NonNullable<ResponseRedaction['hash']>

/** A single captured request + response, as we store it server-side. */
export interface CapturedRequest {
	requestId: string
	method: string
	url: string
	status: number
	contentType: string
	size: number
	requestHeaders: Record<string, string>
	requestBody?: string
	responseHeaders: Record<string, string>
	responseBody?: string
	/** Parsed GraphQL operationName if request body is a GraphQL query. */
	graphqlOp?: string
	/** ms since epoch when the response finished. */
	finishedAt: number
}

/**
 * Reclaim provider JSON shape we draft, then translate to the attestor's HTTP
 * params (proof/attestor.ts) and the API version request (to-version.ts). The
 * request fields derive from the attestor's own `HttpProviderParameters`, so
 * the method enum and match/redaction shapes can't drift from what the
 * attestor accepts. `body` is narrowed to `string` (the SDK also allows
 * `Uint8Array`, but we only ever template text bodies).
 */
export interface ReclaimProvider {
	name: string
	url: string
	method: HttpMethod
	headers?: Record<string, string>
	body?: string
	responseMatches: DraftResponseMatch[]
	responseRedactions?: ResponseRedaction[]
	/** How the verification client supplies cookies/auth on replay. Both
	 *  backends default to `include` when unset. */
	credentials?: WebCredentials
	/** Old-devtools-only url type override (`REGEX`/`CONSTANT`/`TEMPLATE`).
	 *  Auto-derived from `{{param}}` placeholders when unset; ignored by the
	 *  builder backend. */
	urlType?: OldUrlType
	/** Public param refs (templated into URL/body), populated by draft layer. */
	paramValues?: Record<string, string>
	/** Redaction mode for the transcript (attestor default: 'key-update'). */
	writeRedactionMode?: HttpParams['writeRedactionMode']
	/** TLS client options applied to the attestor tunnel. */
	additionalClientOptions?: HttpParams['additionalClientOptions']
	/** Proxy egress: 2-letter ISO country or `{{param}}`. Blank/omitted ⇒
	 *  `{{DYNAMIC_GEO}}` on publish (resolved to the verifying user's country).
	 */
	geoLocation?: HttpParams['geoLocation']
}

/** Egress placeholder resolved to the verifying user's country at
 *  verification time — the default when a provider declares no explicit egress.
 */
export const DYNAMIC_GEO = '{{DYNAMIC_GEO}}'

/** `geoLocation` must never be blank. Trims the input and treats an empty
 *  string as unset so callers apply their own default (publish → `DYNAMIC_GEO`;
 *  a local proof omits it and uses the tester's egress). */
export function normalizeGeoLocation(
	value: string | undefined,
): string | undefined {
	const trimmed = value?.trim()
	return trimmed ? trimmed : undefined
}

/** A reference to a secret param. Raw value lives only in server memory. */
export interface SecretParamRef {
	name: string
	source: 'header' | 'cookie' | 'query'
	redacted: true
}

/** Concerns flagged about a captured request. Informational, never blocking. */
export interface RequestConcern {
	code:
		| 'signedRequest'
		| 'wasmSigned'
		| 'botChallenge'
		| 'csrfDependency'
		| 'shortLivedToken'
		| 'encryptedBody'
		| 'graphql'
	message: string
}
