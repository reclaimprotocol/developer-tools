import { badRequest } from '@hapi/boom'
import assert from 'node:assert'
import { isOprfHashable, OPRF_MAX_BYTES, synthesizeMatcher } from './matcher.ts'
import { normalizeCandidates } from './normalize.ts'
import {
	type CapturedRequest,
	DYNAMIC_GEO,
	type OprfMode,
	type ReclaimProvider,
	type ResponseMatch,
	type ResponseRedaction,
	type SecretParamRef,
} from './schema.ts'
import {
	secretUrlCharBudget,
	splitSecrets,
	stripTransportHeaders,
} from './secrets.ts'

/** OPRF mode for the auto-hash floor — TEE-native (attestor rejects oprf-raw,
 *  isn't set up for gnark oprf). */
const DEFAULT_SENSITIVE_HASH: OprfMode = 'oprf-mpc'

// The deterministic ANTI-LEAK FLOOR: values whose SHAPE is unambiguously
// sensitive PII, force-hashed no matter the field name or the model's judgment.
// Deliberately only FIXED-FORMAT identifiers — OPRF is byte-exact, so a
// self-mutable value (a display name re-cased) would be grindable and pointless
// to hash; and a bare number is ambiguous (a private account id vs a PUBLIC
// user id / follower count that's meant to be proven in the clear). Those
// contextual calls are the model's, via an explicit per-target `hash`. This
// floor is universal (not domain-specific) and high-precision.
const EMAIL_VALUE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/
const SSN_VALUE = /^\d{3}-\d{2}-\d{4}$/
const IBAN_VALUE = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/

function isCanonicalPii(value: string): boolean {
	return EMAIL_VALUE.test(value)
		|| SSN_VALUE.test(value) || IBAN_VALUE.test(value)
}

/** OPRF mode to apply when the caller passed none: the anti-leak floor —
 *  force-hash a value whose SHAPE is unambiguous PII, but ONLY when it's
 *  OPRF-hashable AND within the 62-byte MPC-circuit cap (UTF-8). Undefined =
 *  leave plaintext (a longer value can't be OPRF'd; contextual PII + the proven
 *  identity are the model's/plaintext call). */
export function defaultSensitiveHash(value: string): OprfMode | undefined {
	const hashable = isCanonicalPii(value)
		&& isOprfHashable(value)
		&& Buffer.byteLength(value, 'utf8') <= OPRF_MAX_BYTES
	return hashable ? DEFAULT_SENSITIVE_HASH : undefined
}

/** One value to extract from the request: the captured `value`, a `name` (its
 *  param / capture-group), and an optional per-target OPRF `hash`. */
export interface DraftTarget {
	value: string
	name: string
	hash?: OprfMode
}

/** The realized extraction for one target — its value paired with the
 *  redaction that reveals it (absent when matched literally). Lets a consumer
 *  validate each value against its own selector (for example, the cloud
 *  replay). */
export interface Extraction {
	name: string
	value: string
	redaction?: ResponseRedaction
}

export interface DraftResult {
	provider: ReclaimProvider
	secretRefs: SecretParamRef[]
	/** One entry per target, in `responseMatches` order. */
	extractions: Extraction[]
}

/** A header VALUE that is a per-session/request token — a UUID or a long opaque
 *  hex/base64 blob. Such a value is captured-user-specific: baked into the
 *  provider it goes stale and the origin rejects the replay for everyone else.
 *  Stable identifiers (a tenant/space id like `1237`, a timezone, client hints)
 *  are short/structured and don't match, so they survive. */
function isVolatileHeaderValue(value: string): boolean {
	const v = value.trim()
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
		.test(v)
		|| /^[0-9a-f]{16,}$/i.test(v)
		|| /^[A-Za-z0-9_-]{32,}$/.test(v)
}

/** Drop a PUBLIC header whose value is per-session/request volatile (see
 *  {@link isVolatileHeaderValue}) — public headers get frozen into the
 *  persisted provider, so a volatile one goes stale and fails every other
 *  user's replay. Secret headers are re-captured fresh per verification
 *  (never persisted), so this doesn't apply to them; keep every other
 *  captured public header so the attestor's replay looks like the browser's
 *  request. */
function sanitizeRequestHeaders(
	headers: Record<string, string>,
): Record<string, string> {
	const out: Record<string, string> = {}
	for(const [k, v] of Object.entries(headers)) {
		if(isVolatileHeaderValue(v)) {
			continue
		}

		out[k] = v
	}

	return out
}

/** Reject a draft that bakes a captured per-user value as a LITERAL into a
 *  match or redaction — either a neighbouring target's value or a target's own
 *  value left un-templated. The matcher builds each target's window
 *  independently and drops the per-user WORDS it can see, but it cannot know a
 *  neighbouring value is itself user-specific (for example, a name sharing a
 *  text node with an id — a `<b>{{id}}</b>` sitting beside a
 *  `<td>{{name}}</td>`). Cross-checking every value against every match here
 *  catches
 *  that: a portable provider contains NO captured value as a literal — each
 *  appears only as its `{{param}}`. Throwing discards the draft so the agent
 *  re-captures or re-proposes rather than shipping a provider pinned to this
 *  one user. */
export function assertPortableMatches(
	matches: ResponseMatch[],
	redactions: ResponseRedaction[],
	targets: DraftTarget[],
) {
	// A baked email LOCAL-PART ("jane.doe@…") pins the provider to one user
	// even when only the domain is captured as a param — the classic result of
	// proving an email's domain substring. Reject it regardless of the declared
	// targets (the local part is usually not itself a target, so the value scan
	// below wouldn't catch it). Strip params + named groups + regex escapes
	// first, then look for `localpart@` as a surviving literal. A placeholder
	// never contains a brace, and `[^{}]` keeps the scan linear on `{{{{…`.
	const EMAIL_LOCAL_BAKED = /[A-Za-z0-9._%+-]{3,}@/
	const deregex = (s: string): string => s
		.replace(/\{\{[^{}]*\}\}/g, '')
		.replace(/\(\?<[^>]*>[^)]*\)/g, '')
		.replace(/\\(.)/g, '$1')
	const scanEmail = (text: string, where: string) => {
		if(EMAIL_LOCAL_BAKED.test(deregex(text))) {
			throw new Error(
				`drafted ${where} bakes a per-user email local-part as a literal — `
				+ 'the provider would be pinned to this user. Capture the WHOLE email '
				+ 'as a {{param}} (optionally OPRF-hashed), not just its domain.',
			)
		}
	}

	for(const [i, m] of matches.entries()) {
		scanEmail(m.value, `responseMatch for "${targets[i]?.name ?? '?'}"`)
	}

	for(const r of redactions) {
		if(r.regex) {
			scanEmail(r.regex, 'responseRedaction regex')
		}
	}

	// Guard only values long enough to be plausibly user-specific; shorter runs
	// (single digits, 2-3 char tokens) collide with ordinary structural bytes.
	const MIN_ALNUM = 4
	const guarded = targets
		.map((t) => t.value)
		.filter((v) => v.replace(/[^A-Za-z0-9]/g, '').length >= MIN_ALNUM)
	if(!guarded.length) {
		return
	}

	const stripParams = (s: string): string => s.replace(/\{\{[^{}]*\}\}/g, '')
	const scan = (text: string, where: string, own: string | null) => {
		const bare = stripParams(text)
		for(const v of guarded) {
			if(bare.includes(v)) {
				const kind = v === own
					? 'its own value un-templated'
					: "a neighbouring target's per-user value"
				throw new Error(
					`drafted ${where} bakes ${kind} ("${v}") as a literal — the `
					+ 'provider would be pinned to this user. Re-capture or re-propose.',
				)
			}
		}
	}

	for(const [i, m] of matches.entries()) {
		scan(
			m.value,
			`responseMatch for "${targets[i]?.name ?? '?'}"`,
			targets[i]?.value ?? null,
		)
	}

	for(const r of redactions) {
		if(r.regex) {
			scan(r.regex, 'responseRedaction regex', null)
		}
	}
}

/** Reject a draft that OPRF-hashes a target whose value ALSO appears in the
 *  request URL. The whole point of `hash` is that the attestor never sees
 *  the value in cleartext — but URL `paramValues` are always signed into the
 *  attestor's context in the clear (attestor-core: "those in URL... will be
 *  put into context and signed"), so a value that's both hashed in the
 *  response AND present in the URL is visible there anyway. This isn't a
 *  privacy nuance the author can weigh (unlike {@link assertPortableMatches}
 *  bare-literal cases) — it doesn't verify. Throwing here, at draft time,
 *  surfaces that immediately instead of a confusing later proof failure. */
export function assertNoOprfUrlConflict(
	url: string,
	targets: DraftTarget[],
	effectiveHashes: (OprfMode | undefined)[],
) {
	for(const [i, t] of targets.entries()) {
		const hash = effectiveHashes[i]
		if(!hash) {
			continue
		}

		const inUrl = [t.value, ...normalizeCandidates(t.value)]
			.some((v) => url.includes(v))
		if(inUrl) {
			throw new Error(
				`target "${t.name}" is OPRF-hashed (${hash}) but its value also `
				+ `appears in the request URL ("${url}") — the attestor signs URL `
				+ 'param values into context in the clear, so it would see this '
				+ 'value regardless of the hash. Drop `hash` for this target, or '
				+ "capture a request whose URL doesn't carry the value.",
			)
		}
	}
}

/** Reject a draft whose URL bakes in a secret header/cookie's value beyond
 *  what write-redaction can actually hide there. A secret value used in the
 *  URL is NOT an automatic leak — write-redaction (`key-update`/`zk`) can
 *  redact it from the attestor's view up to {@link secretUrlCharBudget}
 *  characters, summed across every secret value that appears in that URL
 *  (not per-value). Below the budget the header buys real privacy; at or
 *  over it, the value is effectively visible regardless of hiding the
 *  header (same class of problem as {@link assertNoOprfUrlConflict} for
 *  OPRF-hashed targets, which has no such budget at all). */
export function assertNoSecretUrlConflict(
	url: string,
	secrets: Record<string, string>,
	writeRedactionMode?: ReclaimProvider['writeRedactionMode'],
) {
	let redactedChars = 0
	const overlapping: string[] = []
	for(const [name, value] of Object.entries(secrets)) {
		const inUrl = [value, ...normalizeCandidates(value)]
			.some((v) => url.includes(v))
		if(inUrl) {
			redactedChars += value.length
			overlapping.push(name)
		}
	}

	const budget = secretUrlCharBudget(writeRedactionMode)
	if(redactedChars > budget) {
		throw new Error(
			`secret header(s) ${overlapping.map((n) => `"${n}"`).join(', ')} `
			+ `also appear in the request URL ("${url}"), totaling `
			+ `${redactedChars} character(s) to hide — over the ${budget}-`
			+ `character budget write-redaction (${writeRedactionMode
				?? 'key-update'}) can actually hide there. Drop the header, `
			+ "shorten/remove the value's overlap with the URL, or switch to "
			+ "'zk' if that raises the budget enough.",
		)
	}
}

/** Derive a `paramValues` key (and capture-group name) from the provider
 *  name's last alphanumeric token. `"GitHub Username"` → `"username"`,
 *  `"x-followers"` → `"followers"`. */
function deriveParamName(providerName: string): string {
	const tokens = providerName.split(/[^A-Za-z0-9]+/).filter(Boolean)
	const last = tokens[tokens.length - 1] ?? 'value'
	return last.toLowerCase()
}

/** A `paramName` doubles as a regex NAMED CAPTURE GROUP (`(?<name>...)`) and a
 *  `paramValues` object key — both require a plain identifier. Nothing
 *  downstream validates this: an invalid name builds a syntactically broken
 *  regex that silently fails to extract at verification time instead of
 *  erroring here, at draft time, where it's actually fixable. */
const VALID_PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Resolve a target's `paramName`: shortened (the default — last alphanumeric
 *  token, lowercased) or, with `shorten: false`, the name verbatim — the
 *  caller's choice, validated so it's still safe as a capture-group
 *  identifier. */
function resolveParamName(targetName: string, shorten: boolean): string {
	if(!shorten) {
		if(!VALID_PARAM_NAME.test(targetName)) {
			throw new Error(
				`target name "${targetName}" isn't safe as a param name with `
				+ 'shortenNames:false — it becomes a regex capture-group name AND '
				+ 'a paramValues key, so it must start with a letter/underscore and '
				+ 'contain only letters, digits, and underscores (we recommend '
				+ 'lower_snake_case, for example, "employer_name"). Rename it, or drop '
				+ '`shortenNames: false` to auto-derive a safe one.',
			)
		}

		return targetName
	}

	return deriveParamName(targetName)
}

export function draftProvider(
	req: CapturedRequest,
	targets: DraftTarget[],
	name: string,
	hash?: OprfMode,
	opts?: { shortenNames?: boolean },
): DraftResult {
	const shortenNames = opts?.shortenNames ?? true

	if(!req.responseBody) {
		throw new Error(`captured request ${req.requestId} has no response body`)
	}

	if(targets.length === 0) {
		throw new Error('draftProvider needs at least one target')
	}

	// One request → N matches + N redactions. Synthesize each target against the
	// SAME response body; a distinct param name per target keeps their capture
	// groups + paramValues from colliding.
	const matches: ResponseMatch[] = []
	const redactions: ResponseRedaction[] = []
	const extractions: Extraction[] = []
	const effectiveHashes: (OprfMode | undefined)[] = []
	let paramValues: Record<string, string> | undefined
	const seenParams = new Map<string, string>()
	for(const t of targets) {
		const paramName = resolveParamName(t.name, shortenNames)
		const priorName = seenParams.get(paramName)
		if(priorName !== undefined) {
			throw new Error(
				`targets "${priorName}" and "${t.name}" both resolve to the same `
				+ `param name "${paramName}"`
				+ (shortenNames
					? ' (names are shortened to their last alphanumeric token) — '
						+ 'give them more distinct names, for example '
						+ '"firstName"/"surname" instead of "first_name"/"last_name"'
					: ' — give them distinct names, or drop `shortenNames: false` '
						+ 'to auto-derive distinct ones'),
			)
		}

		seenParams.set(paramName, t.name)
		// Precedence: explicit per-target hash → explicit request-wide hash →
		// the anti-leak floor (force-OPRF values whose SHAPE is unambiguous PII).
		// The model makes the contextual calls (which named fields are sensitive)
		// via an explicit per-target hash; this floor only guarantees the obvious.
		const effectiveHash = t.hash ?? hash ?? defaultSensitiveHash(t.value)
		effectiveHashes.push(effectiveHash)
		const synthesis = synthesizeMatcher(
			req.responseBody,
			req.contentType,
			t.value,
			paramName,
			effectiveHash,
		)
		if(!synthesis) {
			throw new Error(
				`target value "${t.value}" not found in`
				+ ` response body for request ${req.requestId}`,
			)
		}

		matches.push(synthesis.match)
		if(synthesis.redaction) {
			redactions.push(synthesis.redaction)
		}

		if(synthesis.paramValues) {
			paramValues = { ...paramValues, ...synthesis.paramValues }
		}

		extractions.push({
			name: paramName,
			value: t.value,
			...(synthesis.redaction ? { redaction: synthesis.redaction } : {}),
		})
	}

	// Portability gate: never ship a draft that bakes a per-user value literally.
	assertPortableMatches(matches, redactions, targets)
	// OPRF gate: never ship a draft that hashes a value the URL also reveals.
	assertNoOprfUrlConflict(req.url, targets, effectiveHashes)

	const { secrets, publics } = splitSecrets(
		stripTransportHeaders(req.requestHeaders)
	)
	// Secret-header gate: never ship a draft whose URL reveals the same value a
	// stripped secret header carries — hiding the header buys nothing then.
	assertNoSecretUrlConflict(req.url, secrets)
	// Sanitize the public headers before they enter the provider. Two problems
	// a captured browser request carries: (1) `accept-encoding: gzip, …`, which
	// makes the attestor match against compressed bytes (it does no transparent
	// decompression in the TLS replay path) — pin it to identity; (2) conditional
	// headers (`if-none-match`/`if-modified-since`), which make the origin answer
	// 304 at proof time and fail the proof. Sanitizing here also keeps
	// `replay_request` and the proof looking at the same full-200 body shape.
	const headersForProvider = sanitizeRequestHeaders(publics)
	const secretRefs: SecretParamRef[] = Object.keys(secrets).map((name) => ({
		name,
		source: name.toLowerCase() === 'cookie' ? 'cookie' : 'header',
		redacted: true,
	}))

	const provider: ReclaimProvider = {
		name,
		url: req.url,
		method: req.method as ReclaimProvider['method'],
		headers: headersForProvider,
		responseMatches: matches,
	}
	if(redactions.length) {
		provider.responseRedactions = redactions
	}

	if(paramValues) {
		provider.paramValues = paramValues
	}

	if(req.requestBody) {
		provider.body = req.requestBody
	}

	return { provider, secretRefs, extractions }
}

/** Fields `update_draft` may replace on a drafted provider. */
export interface DraftEdit {
	responseMatches?: ResponseMatch[]
	responseRedactions?: ResponseRedaction[]
	paramValues?: Record<string, string>
	/** ISO country the request goes out from, or `{{DYNAMIC_GEO}}` /
	 *  `{{DYNAMIC_GEO_SECRET}}` for the verifying user's own country. */
	geoLocation?: string
}

const GEO_TEMPLATES = new Set([DYNAMIC_GEO, '{{DYNAMIC_GEO_SECRET}}'])

const MATCH_TYPES = new Set(['contains', 'regex'])
const OPRF_MODES = new Set(['oprf', 'oprf-raw', 'oprf-mpc'])

/**
 * Apply an agent's edit to a drafted provider: validate the new matchers the
 * way the attestor reads them (regexes compile with its `sgi` flags, every
 * redaction has a selector, a hashed redaction has exactly one named group),
 * then run the same portability gate as {@link draftProvider} so an edit can't
 * bake a captured value in as a literal. Returns the updated provider, its
 * extractions (re-paired with the redaction that names each param), and
 * advisory warnings (for example, a `{{param}}` nothing resolves).
 */
export function editDraftProvider(
	provider: ReclaimProvider,
	extractions: Extraction[],
	edit: DraftEdit,
): {
	provider: ReclaimProvider
	extractions: Extraction[]
	warnings: string[]
} {
	const matches = edit.responseMatches ?? provider.responseMatches
	const redactions = edit.responseRedactions
		?? provider.responseRedactions ?? []
	const paramValues = edit.paramValues ?? provider.paramValues ?? {}
	const geoLocation = GEO_TEMPLATES.has(edit.geoLocation ?? '')
		? edit.geoLocation
		: edit.geoLocation?.toUpperCase()
	assert(
		geoLocation === undefined || GEO_TEMPLATES.has(geoLocation)
		|| /^[A-Z]{2}$/.test(geoLocation),
		badRequest(
			'geoLocation must be a 2-letter ISO country code, {{DYNAMIC_GEO}}, '
			+ 'or {{DYNAMIC_GEO_SECRET}}',
		),
	)
	assert(
		matches.length > 0,
		badRequest('responseMatches must have at least one entry'),
	)
	for(const [i, m] of matches.entries()) {
		assert(
			MATCH_TYPES.has(m.type) && typeof m.value === 'string' && m.value,
			badRequest(
				`responseMatches[${i}] needs type "contains" or "regex" and a `
				+ 'non-empty value',
			),
		)
		if(m.type === 'regex') {
			assertRegex(m.value, `responseMatches[${i}].value`)
		}
	}

	for(const [i, r] of redactions.entries()) {
		assert(
			r.xPath || r.jsonPath || r.regex,
			badRequest(`responseRedactions[${i}] needs an xPath, jsonPath, or regex`),
		)
		if(r.regex) {
			assertRegex(r.regex, `responseRedactions[${i}].regex`)
		}

		assert(
			!r.hash || (OPRF_MODES.has(r.hash) && groupNames(r.regex).length === 1),
			badRequest(
				`responseRedactions[${i}] is hashed (${r.hash}), so it needs a hash `
				+ 'of oprf, oprf-raw, or oprf-mpc and a regex with exactly one named '
				+ 'capture group',
			),
		)
	}

	// An edit can't lower privacy: a draft that redacts keeps redacting, and
	// every group it hashed stays hashed with the same mode.
	const original = provider.responseRedactions ?? []
	assert(
		!original.length || redactions.length,
		badRequest(
			'responseRedactions can\'t be emptied: the attestor would see the '
			+ 'whole response',
		),
	)
	for(const r of original.filter((o) => o.hash)) {
		for(const name of groupNames(r.regex)) {
			const kept = redactions.find((e) => groupNames(e.regex).includes(name))
			assert(
				kept?.hash === r.hash,
				badRequest(
					`capture group ${name} is ${r.hash}-hashed in the draft; keep a `
					+ 'redaction for it with the same hash',
				),
			)
		}
	}

	const groups = matcherGroups(matches, redactions)
	// A group the draft never extracted has a value nothing below checks, and
	// no extraction would track it: new data points need a fresh draft.
	const known = new Set([
		...extractions.map((e) => e.name),
		...matcherGroups(
			provider.responseMatches,
			provider.responseRedactions ?? [],
		),
	])
	const unknown = [...groups].filter((name) => !known.has(name))
	assert(
		!unknown.length,
		badRequest(
			`capture group(s) ${unknown.join(', ')} are not drafted extractions; `
			+ 'propose a new draft to add a data point',
		),
	)

	// Always the captured values, so editing a paramValues entry can't hide
	// one from the portability gate; edited values are checked as well.
	const targets: DraftTarget[] = [
		...extractions.map(({ name, value }) => ({ name, value })),
		...Object.entries(paramValues)
			.filter(([name, value]) => !extractions
				.some((e) => e.name === name && e.value === value))
			.map(([name, value]) => ({ name, value })),
	]
	assertPortableMatches(matches, redactions, targets)

	// Same OPRF gate as draftProvider, against the URL as the attestor signs it.
	const hashed = redactions.flatMap(({ regex, hash }) => hash
		? groupNames(regex).flatMap((name) => targets
			.filter((t) => t.name === name)
			.map((t) => ({ ...t, hash })))
		: [])
	const url = provider.url
		.replace(/\{\{([^{}]+)\}\}/g, (t, name: string) => paramValues[name] ?? t)
	assertNoOprfUrlConflict(url, hashed, hashed.map((t) => t.hash))

	const { responseRedactions: _r, paramValues: _p, ...rest } = provider
	void _r
	void _p
	const next: ReclaimProvider = {
		...rest,
		responseMatches: matches,
		...(redactions.length ? { responseRedactions: redactions } : {}),
		...(Object.keys(paramValues).length ? { paramValues } : {}),
		...(geoLocation ? { geoLocation } : {}),
	}
	const warnings = matches
		.flatMap((m) => [...m.value.matchAll(/\{\{([^{}]+)\}\}/g)].map((t) => t[1]))
		.filter((name) => !(name in paramValues) && !groups.has(name))
		.map((name) => `{{${name}}} has no paramValues entry or named capture `
			+ 'group, so the attestor would look for it literally.')
	const nextExtractions = extractions.map((e) => {
		const redaction = redactions
			.find((r) => groupNames(r.regex).includes(e.name))
		// The captured value, never an edited one, so a later edit's gate still
		// sees it.
		return {
			name: e.name,
			value: e.value,
			...(redaction ? { redaction } : {}),
		}
	})
	return { provider: next, extractions: nextExtractions, warnings }
}

/** Named capture groups across regex matches and redactions. */
function matcherGroups(
	matches: ResponseMatch[],
	redactions: ResponseRedaction[],
) {
	return new Set([
		...matches.flatMap((m) => m.type === 'regex' ? groupNames(m.value) : []),
		...redactions.flatMap((r) => groupNames(r.regex)),
	])
}

/** Named capture groups in `regex` (none when absent). */
function groupNames(regex: string | undefined): string[] {
	return [...(regex ?? '').matchAll(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g)]
		.map((m) => m[1])
}

/** Throw a 400 unless `regex` compiles the way the attestor compiles it. */
function assertRegex(regex: string, where: string) {
	let error: string | undefined
	try {
		new RegExp(regex, 'sgi')
	} catch(err) {
		error = err instanceof Error ? err.message : String(err)
	}

	assert(!error, badRequest(`${where} is not a valid regex: ${error}`))
}
