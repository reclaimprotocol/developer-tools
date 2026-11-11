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
import type { ReclaimProvider } from '../provider/schema.ts'
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
	const expression = `(async () => {
		try {
			const r = await fetch(${JSON.stringify(req.url)}, {
				method: ${JSON.stringify(req.method)},
				headers: ${JSON.stringify(req.headers)},
				credentials: ${JSON.stringify(credentials)},${req.body !== undefined
					? `\n\t\t\t\tbody: ${JSON.stringify(req.body)},`
					: ''}
			})
			return { status: r.status, body: await r.text() }
		} catch(e) { return { error: String((e && e.message) || e) } }
	})()`
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
