import type { ReclaimProvider, ResponseMatch } from '../provider/schema.ts'

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
		if(!matchesBody(body, expanded)) {
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
	}

	return { status, body, matchesOriginal: status < 400 }
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

function matchesBody(body: string, m: ResponseMatch): boolean {
	if(m.type === 'regex') {
		return new RegExp(m.value).test(body)
	}

	if(m.type === 'contains') {
		return body.includes(m.value)
	}

	return false
}
