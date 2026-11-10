import type { ReclaimClient } from '@reclaimprotocol/client/api'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import * as oauth from 'openid-client'
import { currentTelemetry } from '../../../telemetry/index.ts'
import { defineTool, type RegisteredTool } from '../../server.ts'
import {
	authBaseFor,
	oauthRequestOptions,
	SCOPE,
	sessionFromTokens,
} from './oauth-config.ts'
import { readSession, writeSession } from './session-cache.ts'

type AuthToolName = 'reclaim_authenticate' | 'authenticate_builder'

/** How long a sign-in link stays valid (the loopback listener's lifetime). */
const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
/** Longest single `wait_for_sign_in` call; stays under common 60 s tool
 *  timeouts. */
const MAX_WAIT_SECONDS = 55
const DEFAULT_WAIT_SECONDS = 50
/** How long a browser launcher gets to fail before it counts as opened. */
const BROWSER_GRACE_MS = 1500

/** Whether the browser launcher started, and why not when it didn't. */
export type BrowserLaunch = { opened: boolean, reason?: string }

export type PendingSignIn = {
	status: 'PENDING'
	signInUrl: string
	browserOpened: boolean
	reason?: string
	/** ISO timestamp when `signInUrl` stops working. */
	expiresAt: string
}

export type SignInOutcome =
	| { status: 'AUTHENTICATED', expiresAt: string }
	| { status: 'FAILED', reason: string }

type SignInFlow = {
	started: Promise<PendingSignIn>
	completion: Promise<SignInOutcome>
	outcome?: SignInOutcome
}

/** The sign-in in progress (or last finished) for each Builder client. */
const FLOWS = new WeakMap<ReclaimClient, SignInFlow>()

export function authenticateTool(
	client: ReclaimClient,
	name: AuthToolName = 'reclaim_authenticate',
): RegisteredTool {
	return defineTool<Record<string, never>>(
		{
			name,
			description:
				(name === 'authenticate_builder'
					? 'OLD-DEVTOOLS MODE ONLY, and narrow: it authorizes exactly two '
					+ 'Builder-exclusive features — allocating a remote browser '
					+ '(attach_browser mode="builder") and list_builder_organizations. '
					+ 'It does NOT authorize create_provider_version_from_capture or '
					+ 'get_me_providers; those need the separate old-devtools login, '
					+ 'reclaim_authenticate. Check both with get_devtools_mode. '
					: '')
				+ 'Starts signing the developer in to Builder (OAuth 2.0 '
				+ 'authorization code with PKCE, redirecting to a localhost port '
				+ 'this server opens) and returns at once without waiting for them: '
				+ '`{ status: "PENDING", signInUrl, browserOpened, reason?, '
				+ 'expiresAt }`. It tries to open signInUrl in their browser; '
				+ '`browserOpened` says whether that worked and `reason` why not. '
				+ 'Always give the developer signInUrl and ask them to open it in a '
				+ 'browser on this machine. When browserOpened is false, end your '
				+ 'turn after sharing it — nothing happens until they open it. Then '
				+ 'call `wait_for_sign_in` to confirm. The link expires after 5 '
				+ 'minutes; calling again while one is pending returns the same '
				+ 'link. On success the token is saved in ~/.reclaim/config.json '
				+ 'with mode 0600, refreshed automatically, and never returned. It '
				+ 'authorizes organization-management tools such as `list_orgs`. '
				+ 'Programmatic verification tools use a separate organization key; '
				+ 'see `issue_org_token`. Call with no arguments.',
			inputSchema: { type: 'object', properties: {} },
			annotations: { openWorldHint: true, idempotentHint: true },
		},
		async() => startSignIn(client),
	)
}

export function waitForSignInTool(
	client: ReclaimClient,
	authToolName: AuthToolName = 'reclaim_authenticate',
): RegisteredTool {
	return defineTool<{ timeoutSeconds?: number }>(
		{
			name: 'wait_for_sign_in',
			description:
				`Waits for the Builder sign-in started by \`${authToolName}\` to `
				+ `finish, for up to timeoutSeconds (default ${DEFAULT_WAIT_SECONDS}`
				+ `, max ${MAX_WAIT_SECONDS}). Returns status AUTHENTICATED (with `
				+ 'expiresAt); PENDING (not finished yet: repeats signInUrl — call '
				+ 'again, or remind the developer to open the link); FAILED (with '
				+ `reason: call \`${authToolName}\` for a new link); or NOT_STARTED `
				+ '(no sign-in in progress and no valid session: call '
				+ `\`${authToolName}\`).`,
			inputSchema: {
				type: 'object',
				properties: {
					timeoutSeconds: {
						type: 'integer',
						minimum: 0,
						maximum: MAX_WAIT_SECONDS,
					},
				},
			},
			annotations: { readOnlyHint: true, openWorldHint: false },
		},
		async({ timeoutSeconds }) => waitForSignIn(
			client, (timeoutSeconds ?? DEFAULT_WAIT_SECONDS) * 1000,
		),
	)
}

/**
 * Start a sign-in and return its link without waiting for the developer. A
 * sign-in already pending for `client` is returned as is rather than
 * replaced. The flow finishes in the background: the loopback server keeps
 * listening until the browser redirects back or the link expires, and on
 * success caches the session and activates it on `client`.
 */
export async function startSignIn(
	client: ReclaimClient,
	// Overridable only so tests can intercept the authorize URL instead of
	// actually spawning a browser; every real caller uses the default.
	openBrowserFn: (url: string) => Promise<BrowserLaunch> = openBrowser,
): Promise<PendingSignIn> {
	const existing = FLOWS.get(client)
	if(existing && !existing.outcome) {
		return existing.started
	}

	const begun = beginSignIn(client, openBrowserFn)
	const flow: SignInFlow = {
		started: begun.then(({ pending }) => pending),
		completion: begun.then(
			({ completion }) => completion,
			(err) => ({ status: 'FAILED' as const, reason: failureReason(err) }),
		),
	}
	void flow.completion.then((outcome) => {
		flow.outcome = outcome
	})
	FLOWS.set(client, flow)
	return flow.started
}

/**
 * Wait up to `timeoutMs` for `client`'s sign-in to finish. Reports PENDING
 * (with the link again) if it's still open when the wait runs out.
 */
export async function waitForSignIn(
	client: ReclaimClient,
	timeoutMs: number,
): Promise<PendingSignIn | SignInOutcome | { status: 'NOT_STARTED' }> {
	const flow = FLOWS.get(client)
	if(!flow) {
		const session = readSession()
		return session
			? { status: 'AUTHENTICATED', expiresAt: session.expiresAt }
			: { status: 'NOT_STARTED' }
	}

	let timer: ReturnType<typeof setTimeout> | undefined
	const outcome = await Promise.race([
		flow.completion,
		new Promise<undefined>((resolve) => {
			timer = setTimeout(() => resolve(undefined), timeoutMs)
		}),
	])
	clearTimeout(timer)
	return outcome ?? flow.started
}

/**
 * Standard OAuth 2.0 Authorization Code + PKCE, native-app style (RFC 8252):
 * dynamically register a public client (RFC 7591 — Better Auth's
 * `oauth-provider` plugin issues no secret for it), send the user to the
 * browser, and catch the redirect on a loopback server. `openid-client`
 * handles PKCE, `state` CSRF protection, and authorization-response
 * validation (including a denied/failed login surfacing as
 * `AuthorizationResponseError`) — this function only wires those calls
 * together and owns the loopback server (no library spins that up for you).
 * Resolves once the link is ready; `completion` settles when the flow ends
 * and never rejects.
 */
async function beginSignIn(
	client: ReclaimClient,
	openBrowserFn: (url: string) => Promise<BrowserLaunch>,
) {
	const authBase = authBaseFor(client.baseUrl)
	const codeVerifier = oauth.randomPKCECodeVerifier()
	const codeChallenge = await oauth.calculatePKCECodeChallenge(codeVerifier)
	const state = oauth.randomState()

	// Bind the callback port first: the client is registered for this exact
	// loopback redirect.
	const callback = await listenForCallback()
	let config: oauth.Configuration
	try {
		config = await oauth.dynamicClientRegistration(
			new URL(authBase),
			{
				client_name: 'Reclaim CLI',
				redirect_uris: [callback.redirectUri],
				token_endpoint_auth_method: 'none',
				grant_types: ['authorization_code', 'refresh_token'],
				response_types: ['code'],
				scope: SCOPE,
			},
			undefined,
			oauthRequestOptions(authBase),
		)
	} catch(err) {
		callback.close()
		throw err
	}

	const signInUrl = oauth.buildAuthorizationUrl(config, {
		redirect_uri: callback.redirectUri,
		scope: SCOPE,
		state,
		code_challenge: codeChallenge,
		code_challenge_method: 'S256',
	}).href
	const completion = finish()
	const launch = await openBrowserFn(signInUrl).catch((err) => ({
		opened: false,
		reason: failureReason(err),
	}))
	const pending: PendingSignIn = {
		status: 'PENDING',
		signInUrl,
		browserOpened: launch.opened,
		...(launch.reason ? { reason: launch.reason } : {}),
		expiresAt: callback.expiresAt,
	}
	return { pending, completion }

	async function finish(): Promise<SignInOutcome> {
		try {
			const tokens = await oauth.authorizationCodeGrant(
				config, await callback.url,
				{ pkceCodeVerifier: codeVerifier, expectedState: state },
			)
			const session = sessionFromTokens(tokens, {
				clientId: config.clientMetadata().client_id,
				authBase,
			})
			writeSession(session)
			client.setToken(session.token)
			// Link this machine's earlier anonymous usage to the new account.
			void currentTelemetry()?.signedIn()
			return { status: 'AUTHENTICATED', expiresAt: session.expiresAt }
		} catch(err) {
			return { status: 'FAILED', reason: failureReason(err) }
		} finally {
			callback.close()
		}
	}
}

function failureReason(err: unknown) {
	// A denied or failed authorization surfaces as this error class with the
	// raw callback params on `.cause` (RFC 6749 §4.1.2.1's
	// error/error_description).
	if(err instanceof oauth.AuthorizationResponseError) {
		return err.cause.get('error_description')
			?? err.cause.get('error')
			?? 'Sign-in failed or was cancelled.'
	}

	return err instanceof Error ? err.message : String(err)
}

/**
 * Bind an ephemeral loopback port and start listening for the provider's
 * redirect. Resolves as soon as the port is known — the `url` promise settles
 * later, when the browser hits `/callback`, or rejects when the link expires —
 * so the caller can register a client for this exact redirect URI before
 * sending the user off to authorize. The ephemeral port lets any number of
 * CLIs run concurrently. Hands back the RAW callback URL rather than picking
 * `code`/`state` apart itself — `oauth.authorizationCodeGrant` does that
 * validation. The server and timer are unref'd: a pending sign-in alone
 * doesn't keep the process alive.
 */
async function listenForCallback(): Promise<{
	redirectUri: string
	url: Promise<URL>
	expiresAt: string
	close: () => void
}> {
	let resolveUrl: (url: URL) => void
	let rejectUrl: (err: Error) => void
	const url = new Promise<URL>((resolve, reject) => {
		resolveUrl = resolve
		rejectUrl = reject
	})

	const server = createServer()
	const expiresAt = new Date(Date.now() + CALLBACK_TIMEOUT_MS).toISOString()
	const timer = setTimeout(
		() => rejectUrl(new Error(
			'Sign-in link expired (5 min). Call the sign-in tool again for a new '
			+ 'link.',
		)),
		CALLBACK_TIMEOUT_MS,
	).unref()

	const port = await new Promise<number>((resolve, reject) => {
		server.once('error', reject)
		server.listen(0, '127.0.0.1', () => {
			const addr = server.address()
			if(!addr || typeof addr === 'string') {
				reject(new Error('Could not bind a local callback port.'))
				return
			}

			resolve(addr.port)
		})
	}).catch((err) => {
		// Bind failed before `close()` (returned below) is ever reachable —
		// clear the timer ourselves, or it fires 5 minutes later and rejects
		// the now-unobserved `url` promise (unhandled rejection).
		clearTimeout(timer)
		throw err
	})
	server.unref()
	// Past bind, a socket error fails the pending wait rather than throwing.
	server.on('error', (err) => rejectUrl(err))

	const redirectUri = `http://127.0.0.1:${port}/callback`
	server.on('request', (req, res) => {
		const reqUrl = new URL(req.url ?? '/', redirectUri)
		if(reqUrl.pathname !== '/callback') {
			res.writeHead(404).end()
			return
		}

		res.writeHead(200, { 'content-type': 'text/html' })
		res.end(
			'<!doctype html><meta charset=utf-8><body style="font:16px '
			+ 'system-ui;padding:3rem;text-align:center">Signed in. You can '
			+ 'close this tab and return to your terminal.</body>',
		)
		resolveUrl(reqUrl)
	})

	return {
		redirectUri,
		url,
		expiresAt,
		close: () => {
			clearTimeout(timer)
			server.close()
		},
	}
}

/**
 * Try to open `url` in the system browser. Never writes to stdout (it carries
 * MCP JSON-RPC); the URL goes to stderr for a developer watching the logs.
 * On Linux without a display server it doesn't try. Otherwise a launcher
 * that errors or exits non-zero within a short grace window counts as not
 * opened.
 */
export async function openBrowser(
	url: string,
	{ env = process.env, platform = process.platform } = {},
): Promise<BrowserLaunch> {
	process.stderr.write(`\nOpen this URL to sign in:\n${url}\n\n`)
	const hasDisplay = platform === 'darwin' || platform === 'win32'
		|| !!env.WAYLAND_DISPLAY || !!env.DISPLAY
	if(!hasDisplay) {
		return {
			opened: false,
			reason: 'no display (WAYLAND_DISPLAY/DISPLAY not set)',
		}
	}

	const cmd = platform === 'darwin'
		? 'open'
		: platform === 'win32' ? 'cmd' : 'xdg-open'
	const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
	return new Promise((resolve) => {
		const timer = setTimeout(() => resolve({ opened: true }), BROWSER_GRACE_MS)
		try {
			const child = spawn(cmd, args, { stdio: 'ignore', detached: true, env })
			child.once('error', (err) => done({
				opened: false,
				reason: `${cmd} failed: ${err.message}`,
			}))
			child.once('exit', (code, signal) => done(
				code === 0
					? { opened: true }
					: {
						opened: false,
						reason: `${cmd} exited with ${code ?? signal}`,
					},
			))
			child.unref()
		} catch(err) {
			done({ opened: false, reason: `${cmd} failed: ${failureReason(err)}` })
		}

		function done(launch: BrowserLaunch) {
			clearTimeout(timer)
			resolve(launch)
		}
	})
}
