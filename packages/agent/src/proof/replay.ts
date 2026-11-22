import {
	extractHTMLElementsIndexes,
	extractJSONValueIndexes,
} from '@reclaimprotocol/attestor-core'
// Side-effect: make external domhandler nodes DOM-like so attestor-core's
// bundled `xpath` accepts them (see patch-domhandler.ts).
import './patch-domhandler.ts'
import type {
	ReclaimProvider,
	ResponseMatch,
	ResponseRedaction,
} from '../provider/schema.ts'

export interface ReplayResult {
	status: number
	body: string
	matchesOriginal: boolean
	hints?: string[]
}

/** Expand `{{name}}` placeholders from `paramValues`. Matches the attestor
 *  SDK's behavior so replay and proof both hit the same final URL. */
export function expandTemplate(
	s: string,
	params: Record<string, string> | undefined,
): string {
	if(!params) {
		return s
	}

	return s.replace(/\{\{([^{}]+)\}\}/g, (match, name) => {
		const v = params[name]
		return v !== undefined ? v : match
	})
}

/** Build the request the wire replay actually sends: `{{name}}` placeholders
 *  in the URL/headers/body expanded from `provider.paramValues`, secrets
 *  layered onto the public headers. Shared by every replay transport (Node
 *  `fetch` here, or a `fetch` run inside the live browser tab) so they all
 *  send the identical request. */
export interface ReplayRequest {
	url: string
	method: string
	headers: Record<string, string>
	body?: string
}

export function buildReplayRequest(
	provider: ReclaimProvider,
	secrets: Record<string, string>,
): ReplayRequest {
	const params = provider.paramValues
	const url = expandTemplate(provider.url, params)
	const expandedHeaders: Record<string, string> = {}
	for(const [k, v] of Object.entries(provider.headers ?? {})) {
		expandedHeaders[k] = expandTemplate(v, params)
	}

	const headers = { ...expandedHeaders, ...secrets }
	const body = provider.body !== undefined
		? expandTemplate(provider.body, params)
		: undefined
	return {
		url,
		method: provider.method,
		headers,
		...(body !== undefined ? { body } : {}),
	}
}

/**
 * Judge a replayed response against `provider`'s matchers — the part of
 * replay that's identical regardless of HOW the request was sent (detached
 * Node `fetch` or a live in-browser `fetch`). Separated from the actual
 * network call so both transports share one evaluation.
 */
export function evaluateReplay(
	status: number,
	body: string,
	provider: ReclaimProvider,
): ReplayResult {
	const params = provider.paramValues
	const hints: string[] = []
	if(status === 401 || status === 403) {
		hints.push('auth/permission failed')
	}

	if(status >= 500) {
		hints.push('upstream server error')
	}

	if(status >= 400 && status < 500 && /csrf|xsrf/i.test(body)) {
		hints.push(
			'the response mentions a CSRF token: the request likely needs the '
			+ 'CSRF header from the capture. It is sent as a per-user secret, so '
			+ 're-draft from a fresh capture if secretRefs lacks it',
		)
	}

	for(const m of provider.responseMatches) {
		// The attestor substitutes paramValues into responseMatches.value
		// at proof time (`{{name}}` → the value, or → the OPRF nullifier
		// when the matching redaction has `hash`). Replay can't OPRF, but
		// it can do the plain substitution so a paramValues-templated match
		// is meaningful here.
		const expanded: ResponseMatch = {
			...m,
			value: expandTemplate(m.value, params),
		}
		if(matchesBody(body, expanded)) {
			continue
		}

		if(m.isOptional) {
			hints.push(
				`optional matcher ${expanded.type} did not match: the value is `
				+ 'absent for this account, so it is skipped',
			)
			continue
		}

		if(status >= 200 && status < 300) {
			hints.push(
				`matcher ${expanded.type} did not match — ` +
				'value may have changed or matcher is too tight',
			)
		}

		const result: ReplayResult = { status, body, matchesOriginal: false }
		if(hints.length > 0) {
			result.hints = hints
		}

		return result
	}

	return {
		status,
		body,
		matchesOriginal: status < 400,
		...(hints.length > 0 ? { hints } : {}),
	}
}

/** Detached Node-side replay: sends the request directly from this process,
 *  NOT from any attached browser tab — its cookies/secrets are exactly the
 *  `secrets` passed in, never a real browser session. Used by tests and by
 *  any caller with no live browser to replay through (the MCP's authoring
 *  backend instead runs the SAME request inside the attached tab — see
 *  `proof/page-replay.ts` — so replay reflects real session cookies). */
export async function replayProvider(
	provider: ReclaimProvider,
	secrets: Record<string, string>,
): Promise<ReplayResult> {
	const req = buildReplayRequest(provider, secrets)
	const res = await fetch(req.url, {
		method: req.method,
		headers: req.headers,
		redirect: 'manual',
		...(req.body !== undefined ? { body: req.body } : {}),
	})
	const body = await res.text()
	return evaluateReplay(res.status, body, provider)
}

/**
 * Drop the optional matches `body` doesn't satisfy, and the redactions that
 * only extract their values. The attestor has no optional flag: it fails on
 * any match or redaction that finds nothing. A verification client skips an
 * absent optional value, so a local proof does the same. Without a body,
 * returns `provider` unchanged.
 *
 * A match names its values with `{{name}}` placeholders or `(?<name>…)`
 * groups, and a redaction with `(?<name>…)` groups. A redaction is dropped
 * when no kept match uses its names and it belongs to an absent match or
 * selects nothing in `body`. Selector-only redactions have no names, so
 * they're judged by what they select.
 */
export function withoutAbsentOptionals(
	provider: ReclaimProvider,
	body: string | undefined,
): ReclaimProvider {
	if(body === undefined) {
		return provider
	}

	const params = provider.paramValues
	const absent = provider.responseMatches.filter((m) => m.isOptional
		&& !matchesBody(body, { ...m, value: expandTemplate(m.value, params) }))
	if(!absent.length) {
		return provider
	}

	const kept = provider.responseMatches.filter((m) => !absent.includes(m))
	const keptNames = new Set(kept.flatMap((m) => matchNames(m.value)))
	const absentNames = new Set(absent.flatMap((m) => matchNames(m.value)))
	const redactions = provider.responseRedactions?.filter((r) => {
		const groups = groupNames(r.regex)
		if(groups.some((g) => keptNames.has(g))) {
			return true
		}

		return !groups.some((g) => absentNames.has(g)) && selects(r, body)
	})
	return {
		...provider,
		responseMatches: kept,
		...(redactions ? { responseRedactions: redactions } : {}),
	}
}

/** The value names a match uses: `{{name}}` placeholders and named groups. */
function matchNames(value: string) {
	return [
		...[...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((m) => m[1] ?? ''),
		...groupNames(value),
	]
}

function groupNames(regex: string | undefined) {
	return [...(regex ?? '').matchAll(/\(\?<([A-Za-z_]\w*)>/g)]
		.map((m) => m[1] ?? '')
}

/** Whether `r` selects anything in `body`, in the attestor's order: `xPath`
 *  elements, then `jsonPath` values inside them, then `regex`. Uses
 *  attestor-core's own selector functions. A selector or regex that can't
 *  run counts as a find, so the attestor reports it rather than this
 *  silently dropping it. */
function selects(r: ResponseRedaction, body: string) {
	let found = [body]
	try {
		if(r.xPath) {
			const els = extractHTMLElementsIndexes(body, r.xPath, !!r.jsonPath)
			found = slices(body, els)
		}

		const { jsonPath } = r
		if(jsonPath) {
			found = found
				.flatMap((e) => slices(e, extractJSONValueIndexes(e, jsonPath)))
		}
	} catch(err) {
		return !/^(Failed to find XPath|jsonPath not found)/
			.test(err instanceof Error ? err.message : '')
	}

	const { regex } = r
	if(!regex) {
		return found.length > 0
	}

	try {
		// The attestor's flags, minus `g`, which makes `test` stateful.
		const re = new RegExp(regex, 'si')
		return found.some((e) => re.test(e))
	} catch{
		return true
	}
}

function slices(s: string, ranges: { start: number, end: number }[]) {
	return ranges.map(({ start, end }) => s.slice(start, end))
}

function matchesBody(body: string, m: ResponseMatch): boolean {
	if(m.type === 'regex') {
		return new RegExp(m.value).test(body)
	}

	if(m.type === 'contains') {
		return body.includes(m.value)
	}

	return false
}
