/**
 * Replay a drafted provider's AUTHENTICATED request FROM INSIDE the live
 * attached browser tab, over CDP `Runtime.evaluate` — so cookies/session are
 * always the real browser's, for every browser source the MCP can attach to
 * (local Chrome, remote Popcorn, or a caller-supplied custom CDP endpoint all
 * funnel through one `AuthoringBackend.sendCdp`). Ports the pattern already
 * proven in Builder's cloud/Popcorn authoring backend
 * (its `pageFetch`/`authenticatedFetch`),
 * adapted to the MCP's single-page `sendCdp(method, params)` (no separate
 * `pageSession` argument). The ANONYMOUS auth-bound check does NOT go through
 * the page — see `replayProviderInPage`'s doc comment below for why.
 */
import { REPLAY_SOURCE_URL } from '../cdp/capture-engine.ts'
import type { CapturedRequest, ReclaimProvider } from '../provider/schema.ts'
import { stripTransportHeaders } from '../provider/secrets.ts'
import {
	buildReplayRequest,
	evaluateReplay,
	replayProvider,
	type ReplayResult
} from './replay.ts'

/** Everything this module needs from an `AuthoringBackend` — just the raw CDP
 *  seam, so callers can pass a minimal object instead of a full backend. */
export interface PageReplayTarget {
	sendCdp(method: string, params?: Record<string, unknown>): Promise<unknown>
}

interface PageFetchResult {
	status?: number
	body?: string
	error?: string
}

/** Run `fetch(...)` for `provider`'s (already-templated) request inside the
 *  attached tab, via `Runtime.evaluate`. `credentials` selects the visitor:
 *  `'omit'` = anonymous (the auth-bound check), `'include'` = the logged-in
 *  user (the reproducibility gate). Same-origin only — the tab is already on
 *  the target site; a cross-origin/CORS failure comes back as `error`. */
async function pageFetch(
	backend: PageReplayTarget,
	provider: ReclaimProvider,
	credentials: 'omit' | 'include',
	extraSecrets: Record<string, string>,
): Promise<PageFetchResult> {
	const req = buildReplayRequest(provider, extraSecrets)
	return evaluateFetch(backend, { ...req, credentials })
}

/** Run one `fetch(...)` inside the attached tab and return its status and
 *  body. The script carries {@link REPLAY_SOURCE_URL} as its `sourceURL`, so
 *  the capture engine can tell this request from the page's own traffic
 *  (`fetch` is the first, synchronous call, so it's in the initiator stack). */
async function evaluateFetch(
	backend: PageReplayTarget,
	req: {
		url: string
		method: string
		headers: Record<string, string>
		body?: string | undefined
		credentials: 'omit' | 'include'
	},
): Promise<PageFetchResult> {
	const expression = `(async () => {
		try {
			const r = await fetch(${JSON.stringify(req.url)}, {
				method: ${JSON.stringify(req.method)},
				headers: ${JSON.stringify(req.headers)},
				credentials: ${JSON.stringify(req.credentials)},${req.body !== undefined
					? `\n\t\t\t\tbody: ${JSON.stringify(req.body)},`
					: ''}
			})
			return { status: r.status, body: await r.text() }
		} catch(e) { return { error: String((e && e.message) || e) } }
	})()
//# sourceURL=${REPLAY_SOURCE_URL}`
	try {
		const res = (await backend.sendCdp('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true,
		})) as {
			result?: { value?: PageFetchResult }
			exceptionDetails?: { exception?: { description?: string }, text?: string }
		}
		if(res.exceptionDetails) {
			return {
				error: res.exceptionDetails.exception?.description
					?? res.exceptionDetails.text
					?? 'page fetch evaluation error',
			}
		}

		return res.result?.value ?? { error: 'page fetch returned no value' }
	} catch(err) {
		return { error: err instanceof Error ? err.message : String(err) }
	}
}

/** Authenticated re-issue for the reproducibility gate. Cookies ride along
 *  via `credentials: 'include'` (a `Cookie` header can't be set from
 *  `fetch()` — it's a forbidden header name), so only NON-cookie secrets
 *  (Authorization, X-* tokens) are injected explicitly. */
function authenticatedPageFetch(
	backend: PageReplayTarget,
	provider: ReclaimProvider,
	secrets: Record<string, string>,
): Promise<PageFetchResult> {
	const extra: Record<string, string> = {}
	for(const [k, v] of Object.entries(secrets)) {
		if(k.toLowerCase() !== 'cookie') {
			extra[k] = v
		}
	}

	return pageFetch(backend, provider, 'include', extra)
}

/**
 * Replay `provider` and judge the response. Without `withoutSecrets`, replays
 * as the logged-in session — run FROM INSIDE the live tab
 * (`authenticatedPageFetch`) so cookies are the real browser's, which a
 * detached call could never reproduce without manually re-deriving them.
 * WITH `withoutSecrets` (the auth-bound check — "does this still work with
 * no credentials, that is, is it actually public"), replay instead through the
 * detached Node-side `replayProvider`: the whole point of that check is to
 * prove NO secret rides along, and the live page's own global `fetch` can't
 * give that guarantee — a site (or a script installed via test_user_script)
 * can wrap `fetch` and re-attach a token from localStorage/a service worker
 * even under `credentials:'omit'`. A fresh, page-uninvolved fetch has no
 * such surface.
 */
export async function replayProviderInPage(
	backend: PageReplayTarget,
	provider: ReclaimProvider,
	secrets: Record<string, string>,
	opts?: { withoutSecrets?: boolean },
): Promise<ReplayResult> {
	if(opts?.withoutSecrets) {
		return replayProvider(provider, {})
	}

	const result = await authenticatedPageFetch(backend, provider, secrets)
	if(result.error !== undefined || result.status === undefined) {
		throw new Error(
			`in-browser replay failed: ${result.error ?? 'no response'}`,
		)
	}

	return evaluateReplay(result.status, result.body ?? '', provider)
}

/** Header names a page's `fetch` can't set (the browser adds or forbids
 *  them). */
const FORBIDDEN_FETCH_HEADERS = new Set([
	'cookie', 'host', 'origin', 'referer', 'content-length', 'connection',
	'accept-charset', 'accept-encoding', 'dnt', 'te', 'expect', 'keep-alive',
	'trailer', 'upgrade', 'via', 'date',
])

function isForbiddenFetchHeader(name: string) {
	const n = name.toLowerCase()
	return FORBIDDEN_FETCH_HEADERS.has(n)
		|| n.startsWith('sec-')
		|| n.startsWith('proxy-')
}

export interface ControlReplayResult {
	status: number
	ok: boolean
	headerDiff: HeaderDiff
}

export interface HeaderDiff {
	onlyInCapture: string[]
	onlyInRecipe: string[]
	valueDiffers: string[]
}

/** Compare two header maps by name, case-insensitively. Returns names only,
 *  never values. */
export function headerDiff(
	recipe: Record<string, string>,
	captured: Record<string, string>,
): HeaderDiff {
	const lower = (h: Record<string, string>) => new Map(
		Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]),
	)
	const r = lower(recipe)
	const c = lower(captured)
	return {
		onlyInCapture: [...c.keys()].filter((k) => !r.has(k)),
		onlyInRecipe: [...r.keys()].filter((k) => !c.has(k)),
		valueDiffers: [...c.keys()].filter(
			(k) => r.has(k) && r.get(k) !== c.get(k),
		),
	}
}

/**
 * Re-issue the ORIGINAL captured request unchanged, from inside the tab, so a
 * 4xx on the recipe replay can be told apart from a site defense: a 2xx here
 * means the recipe is the bug. Sends the captured method, URL, body and
 * headers (minus transport and fetch-forbidden headers); cookies ride along
 * via `credentials: 'include'`.
 */
export async function controlReplayInPage(
	backend: PageReplayTarget,
	captured: CapturedRequest,
	recipeHeaders: Record<string, string>,
): Promise<ControlReplayResult> {
	const headers = Object.fromEntries(
		Object.entries(stripTransportHeaders(captured.requestHeaders))
			.filter(([k]) => !isForbiddenFetchHeader(k)),
	)
	const result = await evaluateFetch(backend, {
		url: captured.url,
		method: captured.method,
		headers,
		body: captured.requestBody,
		credentials: 'include',
	})
	if(result.error !== undefined || result.status === undefined) {
		throw new Error(
			`in-browser control replay failed: ${result.error ?? 'no response'}`,
		)
	}

	return {
		status: result.status,
		ok: result.status >= 200 && result.status < 300,
		headerDiff: headerDiff(recipeHeaders, headers),
	}
}
