/**
 * The authoring tools, authored ONCE — each directly with the shared
 * `defineTool` primitive (no parallel tool spec). `authoringTools(resolve)`
 * returns them as plain {@link RegisteredTool}s; the MCP (local Chrome +
 * attestor) and the cloud loop (Popcorn + TEE) each pass their own backend
 * resolver, so navigate/inspect/propose/replay/prove logic lives in one place.
 *
 * The resolver hands back the backend per call — the MCP keys it by `captureId`
 * (multi-session), the cloud returns its one run backend. A host that needs
 * extra input schema (the MCP's `captureId` + rich `run_proof` contract) MAPS
 * these tools through `extendTool` at registration; the tools stay plain.
 *
 * Secret guarantee: captured cookie/auth values never enter a tool result. The
 * draft (recipe + secrets) is held server-side; the model only sees an opaque
 * `draftId` and the secret-free provider.
 */
import assert from 'node:assert'
import { findTool } from '../mcp/tools/agent/find.ts'
import { proposeTool } from '../mcp/tools/agent/propose.ts'
import { replayTool } from '../mcp/tools/agent/replay.ts'
import type { CapturedRequest } from '../provider/schema.ts'
import { defineTool, type RegisteredTool } from '../tools/registry.ts'
import type { AuthoringBackend, ProveOptions } from './backend.ts'
import {
	DEFAULT_MAX_CHARS,
	objectSchema,
	publicRequest,
	type ResolveBackend,
	TEXT_WINDOW_PROPERTIES,
	textWindow,
} from './util.ts'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

interface RequestFilter {
	method?: string
	urlGlob?: string
	statusMin?: number
	statusMax?: number
	contentType?: string
	graphqlOp?: string
}

function matchesFilter(r: CapturedRequest, f: RequestFilter): boolean {
	if(f.method && r.method !== f.method.toUpperCase()) {
		return false
	}

	if(f.urlGlob && !globMatch(f.urlGlob, r.url)) {
		return false
	}

	if(f.statusMin !== undefined && r.status < f.statusMin) {
		return false
	}

	if(f.statusMax !== undefined && r.status > f.statusMax) {
		return false
	}

	if(f.contentType && !r.contentType.includes(f.contentType)) {
		return false
	}

	if(f.graphqlOp && r.graphqlOp !== f.graphqlOp) {
		return false
	}

	return true
}

function globMatch(pattern: string, str: string): boolean {
	const re = new RegExp(
		'^'
		+ pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
		+ '$',
	)
	return re.test(str)
}

interface EvalResult {
	result?: { value?: unknown }
	exceptionDetails?: { exception?: { description?: string }, text?: string }
}

async function evalInPage(
	backend: AuthoringBackend,
	expression: string,
): Promise<{ value?: unknown, error?: string }> {
	const res = (await backend.sendCdp('Runtime.evaluate', {
		expression,
		returnByValue: true,
		awaitPromise: true,
		...(backend.readOnlyPageEval ? { throwOnSideEffect: true } : {}),
	})) as EvalResult
	if(res.exceptionDetails) {
		return {
			error: res.exceptionDetails.exception?.description
				?? res.exceptionDetails.text
				?? 'evaluation error',
		}
	}

	return { value: res.result?.value }
}

/**
 * The authoring tools — navigate/inspect authored inline here; find/propose/
 * replay live in their own files ({@link findTool}/{@link proposeTool}/
 * {@link replayTool}) and are composed in below. Each is a plain `defineTool`
 * primitive, so there is one canonical `RegisteredTool` per tool and no
 * parallel tool shape. Every handler resolves its session backend via
 * `resolveBackend(args)`: the cloud passes `() => backend` (one backend per
 * run); the MCP passes an `args.captureId`-keyed resolver. Hosts that need
 * extra input schema (the MCP's `captureId` session handle + the
 * credential-aware `run_proof` contract) MAP these tools through `extendTool`
 * (see mcp/tools/agent/shared.ts) — the tools themselves stay plain, and args
 * parse loosely so the extra fields still reach the resolver/handler.
 */
export function authoringTools(
	resolveBackend: ResolveBackend,
): RegisteredTool[] {
	return [
		defineTool<Record<string, unknown>>(
			{
				name: 'navigate',
				description:
					'Navigates the captured tab to a URL and waits for its load event. '
					+ 'Returns the URL the tab landed on, to detect a redirect to a '
					+ 'sign-in page. Any navigation script kept by `test_user_script` '
					+ 'runs on the page.',
				inputSchema: objectSchema(
					{ url: { type: 'string' }, timeoutMs: { type: 'number' } },
					['url'],
				),
				annotations: { openWorldHint: true, destructiveHint: false },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const timeoutMs = Number(args.timeoutMs) || 30_000
				await backend.sendCdp('Page.enable')
				// Start listening BEFORE navigating so the load event isn't missed.
				const load = backend.waitForEvent('Page.loadEventFired', timeoutMs)
				const nav = (await backend.sendCdp(
					'Page.navigate', { url: String(args.url) },
				)) as { errorText?: string }
				if(nav.errorText) {
					return { ok: false, error: nav.errorText }
				}

				const loadStatus = await load
				const final = await evalInPage(backend, 'location.href')
				return { ok: true, loadStatus, finalUrl: final.value }
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'eval_in_page',
				description:
					'Evaluates a JavaScript expression in the page of the remote '
					+ 'authoring browser, not on this machine, and returns its value. '
					+ 'Use it to read a data point from the DOM, check sign-in state, '
					+ 'or trigger the target request (for example, `location.reload()`). '
					+ 'The page cannot reach files or processes on this machine. Return '
					+ 'only the values you need, never cookies or tokens. A result '
					+ `longer than ${DEFAULT_MAX_CHARS} characters comes back `
					+ 'truncated (objects as JSON text) with `valueTruncation`; page '
					+ 'with `offset`, or pass `maxChars` or `full`.',
				inputSchema: objectSchema(
					{ expression: { type: 'string' }, ...TEXT_WINDOW_PROPERTIES },
					['expression'],
				),
				annotations: { openWorldHint: true, destructiveHint: false },
			},
			async(args) => {
				const res = await evalInPage(
					resolveBackend(args), String(args.expression),
				)
				if(res.value === undefined) {
					return res
				}

				const text = typeof res.value === 'string'
					? res.value
					: JSON.stringify(res.value)
				const slice = textWindow(text, args)
				if(!slice.truncation) {
					return res
				}

				return {
					value: slice.text,
					valueTruncation: {
						...slice.truncation,
						...(typeof res.value === 'string' ? {} : { format: 'json' }),
					},
				}
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'wait_for_page',
				description:
					'Evaluates a JavaScript expression in the remote authoring browser '
					+ 'once a second until it is truthy or the timeout elapses. Returns '
					+ '{ ready }. Use it to wait for content to appear. To wait for a '
					+ 'sign-in, use `wait_for_login`: page JavaScript cannot see the '
					+ 'httpOnly session cookie.',
				inputSchema: objectSchema(
					{ expression: { type: 'string' }, timeoutMs: { type: 'number' } },
					['expression'],
				),
				annotations: { readOnlyHint: true, openWorldHint: true },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const expr = String(args.expression)
				const deadline = Date.now() + (Number(args.timeoutMs) || 180_000)
				while(Date.now() < deadline) {
					const { value } = await evalInPage(backend, expr)
					if(value) {
						return { ready: true }
					}

					await sleep(1000)
				}

				return { ready: false }
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'test_user_script',
				description:
					'Installs a navigation script (the `jsUserScripts` field) in the '
					+ 'remote authoring browser, not on this machine, so it runs before '
					+ 'each page load, as it does at verification. Reports whether it '
					+ 'ran and what it threw. With `navigateUrl`, navigates there and '
					+ 'removes the script after reading the result, unless `keep` is '
					+ 'true. Without `navigateUrl`, the script stays installed for '
					+ 'later navigations until a call with `navigateUrl` removes it. '
					+ 'With `keep: true`, the script stays installed for every later '
					+ 'navigation in this session, replaces any earlier kept script, and '
					+ '`create_provider_version_from_capture` publishes it as '
					+ '`jsUserScripts` unless that call passes its own. '
					+ 'See how_it_works({ topic: "user-script" }).',
				inputSchema: objectSchema(
					{
						script: { type: 'string' },
						navigateUrl: { type: 'string' },
						timeoutMs: { type: 'number' },
						keep: {
							type: 'boolean',
							description:
								'Keep the script installed for every later navigation in '
								+ 'this session and use it as the published navigation '
								+ 'script.',
						},
					},
					['script'],
				),
				annotations: { openWorldHint: true, destructiveHint: false },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const script = String(args.script)
				// The user's script is spliced in as a STRING and compiled at
				// runtime via `new Function`, not as raw top-level source: a
				// syntax error in it would otherwise fail to parse the entire
				// wrapper (result init, error listener, and try/catch included),
				// so the tool would report ran:false / errors:[] instead of the
				// actual SyntaxError.
				const wrapped = `
					window.__reclaimUserScriptResult = { ran: false, errors: [] };
					window.addEventListener('error', function(e) {
						window.__reclaimUserScriptResult.errors.push(String(e.message));
					});
					try {
						(new Function(${JSON.stringify(script)}))();
						window.__reclaimUserScriptResult.ran = true;
					} catch(e) {
						window.__reclaimUserScriptResult.errors.push(
							String((e && e.message) || e),
						);
					}
				`
				const keep = args.keep === true
				const kept = keep ? backend.kept : undefined
				assert(
					!keep || kept,
					new Error('This host does not support `keep`.'),
				)
				// Replace, never stack: only one kept script runs.
				const previous = kept?.keptScript?.identifier
				if(previous) {
					await backend.sendCdp(
						'Page.removeScriptToEvaluateOnNewDocument',
						{ identifier: previous },
					).catch(() => {})
				}

				const installed = (await backend.sendCdp(
					'Page.addScriptToEvaluateOnNewDocument', { source: wrapped },
				)) as { identifier?: string }
				if(kept) {
					kept.keptScript = {
						script,
						...(installed.identifier
							? { identifier: installed.identifier }
							: {}),
					}
				}

				if(typeof args.navigateUrl !== 'string') {
					return {
						installed: true,
						...(keep ? { kept: true } : {}),
						note:
							'Installed for the NEXT navigation only — it did not run on '
							+ 'the current page, and stays installed (runs on every later '
							+ 'navigation too) until a follow-up call with navigateUrl '
							+ 'removes it. Navigate now (for example, with the navigate '
							+ 'tool), then read window.__reclaimUserScriptResult via '
							+ 'eval_in_page, or call '
							+ 'test_user_script again with navigateUrl.',
					}
				}

				try {
					const timeoutMs = Number(args.timeoutMs) || 30_000
					await backend.sendCdp('Page.enable')
					const load = backend.waitForEvent('Page.loadEventFired', timeoutMs)
					const nav = (await backend.sendCdp(
						'Page.navigate', { url: String(args.navigateUrl) },
					)) as { errorText?: string }
					if(nav.errorText) {
						return { installed: true, navigated: false, error: nav.errorText }
					}

					await load
					const { value, error } = await evalInPage(
						backend, 'window.__reclaimUserScriptResult',
					)
					if(error) {
						return { installed: true, navigated: true, error }
					}

					const result =
						value as { ran?: boolean, errors?: string[] } | undefined
					return {
						installed: true,
						...(keep ? { kept: true } : {}),
						navigated: true,
						ran: result?.ran ?? false,
						errors: result?.errors ?? [],
					}
				} finally {
					// One-shot test: remove it so it doesn't keep running (and
					// potentially redirecting the tab) on every later navigation.
					if(installed.identifier && !keep) {
						await backend.sendCdp(
							'Page.removeScriptToEvaluateOnNewDocument',
							{ identifier: installed.identifier },
						)
					}
				}
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'get_cookies',
				description:
					'Returns the names, domains, and flags of the cookies set in the '
					+ 'remote authoring browser. Values are never returned; they stay '
					+ 'in the browser and on the server. A new auth or session cookie '
					+ '(for example, session, sid, auth, jwt) is a reliable sign-in '
					+ 'signal that does not depend on the page language or DOM. '
					+ 'Includes httpOnly cookies that page JavaScript cannot see.',
				inputSchema: objectSchema({}),
				annotations: { readOnlyHint: true, openWorldHint: true },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const res = (await backend.sendCdp('Network.getCookies')) as {
					cookies?: {
						name: string
						domain?: string
						session?: boolean
						httpOnly?: boolean
					}[]
				}
				return (res.cookies ?? []).map((c) => ({
					name: c.name,
					...(c.domain ? { domain: c.domain } : {}),
					...(c.session ? { session: true } : {}),
					...(c.httpOnly ? { httpOnly: true } : {}),
				}))
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'wait_for_login',
				description:
					'Wait for the user to finish logging in. Polls the browser\'s '
					+ 'REAL cookies over CDP (httpOnly INCLUDED) until a NEW session '
					+ 'cookie appears, ignoring analytics/bot cookies. The ONLY '
					+ 'correct login wait — NEVER use wait_for_page for it: page JS '
					+ 'can\'t see the httpOnly session cookie (hangs the whole '
					+ 'timeout), yet DOES see pre-login tracking cookies (a '
					+ 'length/substring check fires instantly, before the user '
					+ 'types). Snapshots the baseline itself — call right after '
					+ 'navigating to the login page. Does NOT navigate (never yanks '
					+ 'the user off login/2FA). Returns { loggedIn, newCookies }.',
				inputSchema: objectSchema({ timeoutMs: { type: 'number' } }),
				annotations: { readOnlyHint: true, openWorldHint: true },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const deadline = Date.now() + (Number(args.timeoutMs) || 180_000)
				const cookies = async() => {
					const res = (await backend.sendCdp('Network.getCookies')) as {
						cookies?: { name: string, httpOnly?: boolean }[]
					}
					return res.cookies ?? []
				}

				// Analytics / bot-protection / pre-auth infra cookies appear (and
				// rotate) without any login — never the signal, even when new.
				const JUNK = new RegExp('^(' + [
					'_ga', '_gid', '_gat', '_ym', '__ddg', '__gads', '__gpi', '__eoi',
					'__utm', '_fbp', 'fbp', 'fr', 'FCCDCF', 'pinLogger',
					'userFirstVisit', 'cf_', '_dd_', 'bcookie', 'bscookie', 'lidc',
				].join('|') + ')', 'i')
				// A real session/auth cookie name. Deliberately NOT bare `token` — a
				// challenge/CSRF token (for example, LinkedIn `chp_token`) contains it
				// and is set BEFORE auth completes. Any new httpOnly cookie is also a
				// candidate (server-set session cookies are usually httpOnly).
				const SESSION = /sess|sid|jwt|_session|auth|logged.?in|remember|li_at/i
				// Auth/challenge URL paths — while the page is still on one, login is
				// NOT done (a mid-flow cookie must not count). Cross-site-stable, far
				// more so than cookie names.
				const AUTH_URL = new RegExp([
					'login', 'signin', 'sign-in', 'challenge', 'checkpoint', '\\buas\\b',
					'authorize', '\\bsso\\b', 'mfa', '2fa', 'two-factor', 'otp', 'verify',
					'password',
				].join('|'), 'i')
				const offAuthUrl = async() => {
					const { value } = await evalInPage(backend, 'location.href')
					const href = typeof value === 'string' ? value : ''
					try {
						const u = new URL(href)
						return !AUTH_URL.test(u.pathname + u.search)
					} catch{
						return false
					}
				}

				const initial = await cookies()
				const baseline = new Set(initial.map((c) => c.name))
				while(Date.now() < deadline) {
					const current = await cookies()
					const fresh = current
						.filter((c) => !baseline.has(c.name) && !JUNK.test(c.name))
					const hit = fresh.filter((c) => c.httpOnly || SESSION.test(c.name))
					// BOTH required: a new session cookie AND the page has left the auth
					// flow. Either alone false-positives (mid-flow token; stray nav).
					if(hit.length && await offAuthUrl()) {
						return { loggedIn: true, newCookies: hit.map((c) => c.name) }
					}

					await sleep(1000)
				}

				return { loggedIn: false, newCookies: [] }
			},
		),
		defineTool<Record<string, unknown>>(
			{
				name: 'list_requests',
				description:
					'Lists captured network requests (method, URL, status, size), '
					+ 'newest last. Filter by method, urlGlob, status range, '
					+ 'contentType, or graphqlOp. Returns metadata only, never '
					+ 'secrets.',
				inputSchema: objectSchema({
					filter: {
						type: 'object',
						properties: {
							method: { type: 'string' },
							urlGlob: { type: 'string' },
							statusMin: { type: 'number' },
							statusMax: { type: 'number' },
							contentType: { type: 'string' },
							graphqlOp: { type: 'string' },
						},
					},
				}),
				annotations: { readOnlyHint: true, openWorldHint: false },
			},
			async(args) => {
				const backend = resolveBackend(args)
				const filter = (args.filter ?? {}) as RequestFilter
				return [...backend.capture.requests.values()]
					.filter((r) => matchesFilter(r, filter))
					.map(publicRequest)
			},
		),
		findTool(resolveBackend),
		proposeTool(resolveBackend),
		replayTool(resolveBackend),
		defineTool<Record<string, unknown>>(
			{
				name: 'run_proof',
				description:
					'Proves the drafted recipe (zkTLS). Call it after `replay_request` '
					+ 'looks right. Returns the proof result. Unlike `replay_request`, '
					+ 'which re-sends from inside the attached browser tab, the '
					+ 'attestor calls the target from its own network and IP. A request '
					+ 'that replayed can still fail here for geo- or IP-bound content '
					+ '(country-locked pages, IP-allowlisted APIs); that is a property '
					+ 'of the site, not a bug in the draft. HTTP 403/406/429/503 or a '
					+ 'challenge page from the attestor while the replay succeeded '
					+ 'means the site blocks non-browser clients: copying headers or '
					+ 'cookies will not help. Try one other endpoint; if that is '
					+ 'blocked too, publish the version from the capture and have '
					+ 'the developer try a real verification '
					+ '(how_it_works({ topic: "prove" })). Do not keep retrying.',
				inputSchema: objectSchema({ draftId: { type: 'string' } }, ['draftId']),
				annotations: { openWorldHint: true, destructiveHint: false },
			},
			// The backend shapes its own result: the cloud returns a lean,
			// secret-free summary (and records the proven recipe for publish); the
			// MCP persists the claim + returns the rich developer view. The MCP adds
			// `ownerAddress`/`attestorUrl` to the schema via `extendTool`; the
			// handler reads them from args (loose parse keeps them).
			async(args) => {
				const backend = resolveBackend(args)
				const draft = backend.drafts.get(String(args.draftId))
				if(!draft) {
					throw new Error(`no draft ${String(args.draftId)}`)
				}

				const opts: ProveOptions = {}
				if(typeof args.ownerAddress === 'string') {
					opts.ownerAddress = args.ownerAddress
				}

				if(typeof args.attestorUrl === 'string') {
					opts.attestorUrl = args.attestorUrl
				}

				if(typeof args.geoLocation === 'string') {
					opts.geoLocation = args.geoLocation
				}

				return backend.prove(draft, opts)
			},
		),
	]
}
