import type { ReclaimProvider } from './schema.ts'

/** Headers safe to reveal to the attestor unredacted — everything else
 *  (`Cookie`, `Authorization`, any custom header, even ones that look inert
 *  like `Content-Type`) is secret by default. Allowlist, not a denylist:
 *  same exact list `reclaim-inapp-sdk` (`_PUBLIC_HEADERS_ALLOW_LIST`,
 *  `request.dart`) and `reclaim-portal` (`DEFAULT_PUBLIC_HEADERS`,
 *  `claim-builder.ts`) use for their own `witnessParams`/header split. */
const PUBLIC_HEADERS = new Set([
	'user-agent',
	'accept',
	'accept-language',
	'accept-encoding',
	'sec-fetch-mode',
	'sec-fetch-site',
	'sec-fetch-user',
	'origin',
	'x-requested-with',
	'sec-ch-ua',
	'sec-ch-ua-mobile',
])

export function classifyHeader(name: string): boolean {
	return !PUBLIC_HEADERS.has(name.toLowerCase())
}

/** Headers that must NOT survive into EITHER the public or secret side —
 *  structural/transport, never a credential. Three kinds:
 *  - Conditional headers (`if-none-match`/`if-modified-since`/…): a captured
 *    cached ETag/date makes the origin answer 304/412 when the attestor
 *    re-issues, and the attestor treats non-2xx as failure. We always want
 *    the full fresh response.
 *  - Transfer headers the ATTESTOR sets itself (`connection: close`,
 *    `accept-encoding: identity`). Passing our own duplicates/collides with
 *    the request the attestor builds, so leave them out.
 *  - Host / framing headers the TRANSPORT owns (`host`, `content-length`,
 *    `transfer-encoding`). The attestor derives `Host` from the URL and sets
 *    its own; a baked `Host` produces a DUPLICATE that fails the receipt
 *    check / 400s the origin. A stale `content-length` breaks a
 *    re-serialized body.
 *  Must be stripped BEFORE `splitSecrets`, not after: under the allowlist
 *  classifier these all fall into `secrets` (none are on `PUBLIC_HEADERS`),
 *  and a header like `Host` — whose value trivially mirrors the URL's
 *  hostname, by definition — would trip a URL-conflict check on a
 *  structural, not a privacy, coincidence. */
const STRIP_REQUEST_HEADERS = new Set([
	'if-none-match',
	'if-modified-since',
	'if-match',
	'if-unmodified-since',
	'if-range',
	'connection',
	'accept-encoding',
	'host',
	'content-length',
	'transfer-encoding',
	// Per-session anti-CSRF tokens: never portable (baking one in replays a
	// single captured user's token for everyone, which the origin rejects).
	// The allowlist classifier already routes these to `secrets` — a proof
	// attempt sends the CURRENT user's own captured value, which is correct —
	// but stripping them here means they never even take that path, and
	// definitely never survive into a persisted, public recipe.
	'csrf',
	'x-csrf',
	'xsrf',
	'x-xsrf',
	'x-csrf-token',
	'xsrf-token',
])

/** True for an HTTP/2 pseudo-header (`:authority`, `:method`, `:path`,
 *  `:scheme`, which CDP surfaces on h2 captures) — never a valid request
 *  header the attestor can replay. Same BEFORE-the-split reasoning as
 *  {@link STRIP_REQUEST_HEADERS}. */
function isPseudoHeader(name: string): boolean {
	return name.startsWith(':')
}

/** Drop {@link STRIP_REQUEST_HEADERS} and HTTP/2 pseudo-headers. Call this on
 *  the RAW captured headers before {@link splitSecrets} — both the draft-time
 *  authoring flow and the live per-user verification capture need it, so
 *  neither ends up sending a duplicate `Host` or an invalid `:authority` to
 *  the attestor via either the public or the secret channel. */
export function stripTransportHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {}
	for(const [k, v] of Object.entries(headers)) {
		if(STRIP_REQUEST_HEADERS.has(k.toLowerCase()) || isPseudoHeader(k)) {
			continue
		}

		out[k] = v
	}

	return out
}

export function splitSecrets(headers: Record<string, string>): {
	secrets: Record<string, string>
	publics: Record<string, string>
} {
	const secrets: Record<string, string> = {}
	const publics: Record<string, string> = {}
	for(const [k, v] of Object.entries(headers)) {
		if(classifyHeader(k)) {
			secrets[k] = v
		} else {
			publics[k] = v
		}
	}

	return { secrets, publics }
}

/** Total characters write-redaction can hide from the attestor, summed
 *  ACROSS EVERY secret-classified value used in the URL — not a per-value
 *  cap. Default mode (`'key-update'`, also what an unset field resolves to)
 *  caps at 2; `'zk'` at 12. At or under the budget the overlap is genuinely
 *  hidden; over it, the value (or the combination of values) is effectively
 *  still visible to the attestor regardless of secret-marking. */
export function secretUrlCharBudget(
	writeRedactionMode: ReclaimProvider['writeRedactionMode'],
): number {
	return writeRedactionMode === 'zk' ? 12 : 2
}

/** A `paramValues`/context key is secret iff its name contains `SECRET`
 *  (case-insensitive) — for example, `SECRET_apiKey`, `context.SECRET_apiKey`.
 *  Same naming-convention classifier reclaim-inapp-sdk and reclaim-portal use
 *  for their `witnessParams`/`paramValues` maps (no separate boolean flag). */
export function classifyParamName(name: string): boolean {
	return name.toUpperCase().includes('SECRET')
}

/** Split a `paramValues` map (bare `{{name}}` / `{{context.<name>}}` entries)
 *  into public (→ `params.paramValues`, revealed to the attestor) and secret
 *  (→ `secretParams.paramValues`) by {@link classifyParamName}. A secret
 *  value used in the URL is still hidden — up to {@link secretUrlCharBudget}
 *  characters, summed across every such value in that URL. */
export function splitSecretParamValues(paramValues: Record<string, string>): {
	secrets: Record<string, string>
	publics: Record<string, string>
} {
	const secrets: Record<string, string> = {}
	const publics: Record<string, string> = {}
	for(const [k, v] of Object.entries(paramValues)) {
		if(classifyParamName(k)) {
			secrets[k] = v
		} else {
			publics[k] = v
		}
	}

	return { secrets, publics }
}

/** Reject a proof attempt whose URL/geoLocation templates SECRET-named
 *  context param(s) whose ACTUAL values (now known — the consumer supplied
 *  them at session-create) exceed the write-redaction budget once summed.
 *  Structural placement (which params end up in the URL) is knowable at
 *  publish time and isn't rejected there — only the real values decide
 *  whether it fits, and those only exist once a verification session is
 *  underway. Checks the placeholder TOKEN (`{{<key>}}`), not a value search —
 *  the URL/geoLocation explicitly reference the param by name. */
export function assertSecretParamValuesFitUrlBudget(
	url: string,
	geoLocation: string | undefined,
	secretParamValues: Record<string, string>,
	writeRedactionMode: ReclaimProvider['writeRedactionMode'],
) {
	const haystack = `${url}\n${geoLocation ?? ''}`
	let redactedChars = 0
	const used: string[] = []
	for(const [key, value] of Object.entries(secretParamValues)) {
		if(haystack.includes(`{{${key}}}`)) {
			redactedChars += value.length
			used.push(key)
		}
	}

	const budget = secretUrlCharBudget(writeRedactionMode)
	if(redactedChars > budget) {
		throw new Error(
			`secret context param(s) ${used.map((k) => `"${k}"`).join(', ')} `
			+ `are templated into the URL/geoLocation ("${url}") with a `
			+ `combined value length of ${redactedChars} character(s) — over `
			+ `the ${budget}-character budget write-redaction `
			+ `(${writeRedactionMode ?? 'key-update'}) can actually hide there. `
			+ "Ask the consumer for a shorter value, switch to 'zk' if that "
			+ 'raises the budget enough, or move this param to the body.',
		)
	}
}
