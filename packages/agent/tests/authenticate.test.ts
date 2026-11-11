/**
 * Unit tests for the builder-mode OAuth loopback sign-in (`startSignIn` /
 * `waitForSignIn`) and the refreshing session fetch. No real network and no
 * real browser: `globalThis.fetch` is replaced with a fake Better Auth
 * `oauth-provider` server (plus a tiny Builder API) for the
 * `mock-builder.test` origin (everything else — the REAL loopback callback
 * server `startSignIn` binds on 127.0.0.1 — passes through to the original
 * fetch), and `openBrowserFn` is swapped for a fake that reads the authorize
 * URL and fires the simulated "browser" callback itself, since
 * `child_process.spawn` can't be mocked from outside an ES module.
 */
import { ReclaimClient } from '@reclaimprotocol/client'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import * as oauth from 'openid-client'
import {
	type BrowserLaunch,
	openBrowser,
	startSignIn,
	waitForSignIn,
} from '../src/mcp/tools/authenticate/authenticate.ts'
import {
	type CachedSession,
	readSession,
	readStoredSession,
	sessionRefreshingFetch,
	writeSession,
} from '../src/mcp/tools/authenticate/session-cache.ts'

const AUTH_ORIGIN = 'https://mock-builder.test'
const AUTH_BASE = `${AUTH_ORIGIN}/auth`

const originalFetch = globalThis.fetch

type TokenReply = { status?: number, body: Record<string, unknown> }

/** A fake Better Auth `oauth-provider` server for `AUTH_ORIGIN`, plus
 *  `GET /orgs`, which answers 200 only for `Bearer <validToken>`. Requests to
 *  any other origin (the real 127.0.0.1 loopback callback server) pass
 *  through to the real `fetch`. Records every request it serves. */
function fakeAuthServer(opts: {
	token?: (form: URLSearchParams) => TokenReply
	validToken?: string
} = {}) {
	const requests: { path: string, body?: string, auth?: string }[] = []
	const fake: typeof fetch = async(url, init) => {
		const u = new URL(url instanceof Request ? url.url : String(url))
		if(u.origin !== AUTH_ORIGIN) {
			return originalFetch(url, init)
		}

		const body = typeof init?.body === 'string'
			? init.body
			: init?.body instanceof URLSearchParams ? init.body.toString() : undefined
		const auth = new Headers(init?.headers).get('authorization') ?? undefined
		requests.push({ path: u.pathname, body, auth })

		if(u.pathname === '/.well-known/oauth-authorization-server/auth') {
			return json({
				issuer: AUTH_BASE,
				authorization_endpoint: `${AUTH_BASE}/oauth2/authorize`,
				token_endpoint: `${AUTH_BASE}/oauth2/token`,
				registration_endpoint: `${AUTH_BASE}/oauth2/register`,
				response_types_supported: ['code'],
				grant_types_supported: ['authorization_code', 'refresh_token'],
				token_endpoint_auth_methods_supported: ['none'],
				code_challenge_methods_supported: ['S256'],
			})
		}

		if(u.pathname === '/auth/oauth2/register') {
			const reg = JSON.parse(String(body)) as { redirect_uris: string[] }
			// The real Better Auth server returns 200, not the RFC 7591-mandated
			// 201, so every test here exercises the customFetch shim.
			return json({
				client_id: 'test-client-id',
				redirect_uris: reg.redirect_uris,
				token_endpoint_auth_method: 'none',
			})
		}

		if(u.pathname === '/auth/oauth2/token') {
			const reply = (opts.token ?? defaultToken)(new URLSearchParams(body))
			return json(reply.body, reply.status)
		}

		if(u.pathname === '/orgs') {
			return auth === `Bearer ${opts.validToken}`
				? json({ items: [] })
				: json({ title: 'Unauthorized', status: 401 }, 401)
		}

		throw new Error(`fakeAuthServer: unexpected request to ${u}`)
	}

	return { fetch: fake, requests }
}

function defaultToken(): TokenReply {
	return {
		body: {
			access_token: 'FAKE_ACCESS_TOKEN',
			refresh_token: 'FAKE_REFRESH_TOKEN',
			token_type: 'Bearer',
			expires_in: 3600,
		},
	}
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json' },
	})
}

/** Stands in for opening a system browser: fires the simulated browser's
 *  callback at the (real) loopback server with `params`, as if the user
 *  finished on the authorize page. */
function simulateBrowser(
	params: (state: string | null) => string,
): (url: string) => Promise<BrowserLaunch> {
	return async(url) => {
		const u = new URL(url)
		const redirectUri = u.searchParams.get('redirect_uri')
		const query = params(u.searchParams.get('state'))
		void originalFetch(`${redirectUri}?${query}`)
		return { opened: true }
	}
}

const successfulLogin = simulateBrowser((state) => {
	return `code=FAKE_CODE&state=${state}`
})
const deniedLogin = simulateBrowser((state) => {
	return `error=access_denied&error_description=User+said+no&state=${state}`
})
const browserNeverOpens = async(): Promise<BrowserLaunch> => ({
	opened: false,
	reason: 'no display (WAYLAND_DISPLAY/DISPLAY not set)',
})

describe('sign-in (startSignIn / waitForSignIn)', () => {
	let homeDir: string
	beforeEach(() => {
		homeDir = mkdtempSync(join(tmpdir(), 'reclaim-auth-'))
		process.env.RECLAIM_HOME = homeDir
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
		delete process.env.RECLAIM_HOME
		rmSync(homeDir, { recursive: true, force: true })
	})

	it('returns the sign-in URL at once, reporting a browser that did not open',
		async() => {
			globalThis.fetch = fakeAuthServer().fetch
			const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

			const pending = await startSignIn(client, browserNeverOpens)

			assert.equal(pending.status, 'PENDING')
			assert.equal(pending.browserOpened, false)
			assert.match(pending.reason ?? '', /no display/)
			const url = new URL(pending.signInUrl)
			assert.equal(url.origin + url.pathname, `${AUTH_BASE}/oauth2/authorize`)
			assert.match(url.searchParams.get('scope') ?? '', /offline_access/)
			assert.ok(new Date(pending.expiresAt).getTime() > Date.now())
			assert.equal(readSession(), undefined)
		})

	it('reuses the pending sign-in instead of starting another', async() => {
		const server = fakeAuthServer()
		globalThis.fetch = server.fetch
		const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

		const first = await startSignIn(client, browserNeverOpens)
		const second = await startSignIn(client, browserNeverOpens)

		assert.equal(second.signInUrl, first.signInUrl)
		assert.equal(
			server.requests.filter((r) => r.path === '/auth/oauth2/register').length,
			1,
		)
		const waited = await waitForSignIn(client, 10)
		assert.deepEqual(waited, first)
	})

	it('completes in the background and caches a refreshable session',
		async() => {
			globalThis.fetch = fakeAuthServer().fetch
			const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

			const pending = await startSignIn(client, successfulLogin)
			assert.equal(pending.status, 'PENDING')
			assert.equal(pending.browserOpened, true)

			const done = await waitForSignIn(client, 5000)
			assert.equal(done.status, 'AUTHENTICATED')
			assert.equal(client.getToken(), 'FAKE_ACCESS_TOKEN')
			const cached = readSession()
			assert.equal(cached?.token, 'FAKE_ACCESS_TOKEN')
			assert.equal(cached.refreshToken, 'FAKE_REFRESH_TOKEN')
			assert.equal(cached.clientId, 'test-client-id')
			assert.equal(cached.authBase, AUTH_BASE)
		})

	it('a denied login fails with its error_description; the next call starts '
		+ 'over', async() => {
		globalThis.fetch = fakeAuthServer().fetch
		const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

		const first = await startSignIn(client, deniedLogin)
		assert.deepEqual(
			await waitForSignIn(client, 5000),
			{ status: 'FAILED', reason: 'User said no' },
		)
		assert.equal(readSession(), undefined)

		const retry = await startSignIn(client, browserNeverOpens)
		assert.notEqual(retry.signInUrl, first.signInUrl)
	})

	it('a state mismatch fails (CSRF protection)', async() => {
		globalThis.fetch = fakeAuthServer().fetch
		const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

		await startSignIn(
			client,
			simulateBrowser(() => 'code=FAKE_CODE&state=not-the-real-state'),
		)

		const done = await waitForSignIn(client, 5000)
		assert.equal(done.status, 'FAILED')
		assert.equal(readSession(), undefined)
	})

	it('a token-endpoint failure fails rather than caching a session',
		async() => {
			globalThis.fetch = fakeAuthServer({
				token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
			}).fetch
			const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

			await startSignIn(client, successfulLogin)

			const done = await waitForSignIn(client, 5000)
			assert.equal(done.status, 'FAILED')
			assert.equal(readSession(), undefined)
		})

	it('registers a public loopback client with the refresh_token grant',
		async() => {
			const server = fakeAuthServer()
			globalThis.fetch = server.fetch
			const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })

			await startSignIn(client, browserNeverOpens)

			const register = server.requests
				.find((r) => r.path === '/auth/oauth2/register')
			const body = JSON.parse(String(register?.body)) as {
				token_endpoint_auth_method: string
				grant_types: string[]
				redirect_uris: string[]
			}
			assert.equal(body.token_endpoint_auth_method, 'none')
			assert.deepEqual(
				body.grant_types, ['authorization_code', 'refresh_token'],
			)
			assert.match(
				body.redirect_uris[0], /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
			)
		})

	it('reports NOT_STARTED without a flow or session', async() => {
		const client = new ReclaimClient({ baseUrl: AUTH_ORIGIN })
		assert.deepEqual(await waitForSignIn(client, 10), { status: 'NOT_STARTED' })
	})
})

describe('openBrowser', () => {
	it('does not launch on Linux without a display', async() => {
		const launch = await openBrowser('https://example.test', {
			platform: 'linux', env: {},
		})
		assert.deepEqual(launch, {
			opened: false,
			reason: 'no display (WAYLAND_DISPLAY/DISPLAY not set)',
		})
	})
})

describe('sessionRefreshingFetch', () => {
	let homeDir: string
	beforeEach(() => {
		homeDir = mkdtempSync(join(tmpdir(), 'reclaim-auth-'))
		process.env.RECLAIM_HOME = homeDir
	})

	afterEach(() => {
		globalThis.fetch = originalFetch
		delete process.env.RECLAIM_HOME
		rmSync(homeDir, { recursive: true, force: true })
	})

	const session = (over: Partial<CachedSession> = {}): CachedSession => ({
		token: 'OLD_TOKEN',
		expiresAt: new Date(Date.now() - 1000).toISOString(),
		refreshToken: 'OLD_REFRESH',
		clientId: 'test-client-id',
		authBase: AUTH_BASE,
		...over,
	})
	const refreshGrant = (form: URLSearchParams): TokenReply => {
		assert.equal(form.get('grant_type'), 'refresh_token')
		assert.equal(form.get('refresh_token'), 'OLD_REFRESH')
		return {
			body: {
				access_token: 'NEW_TOKEN',
				refresh_token: 'NEW_REFRESH',
				token_type: 'Bearer',
				expires_in: 3600,
			},
		}
	}

	it('refreshes an expired token before the request', async() => {
		const server = fakeAuthServer({
			token: refreshGrant, validToken: 'NEW_TOKEN',
		})
		globalThis.fetch = server.fetch
		writeSession(session())
		const client = new ReclaimClient({
			baseUrl: AUTH_ORIGIN,
			fetch: sessionRefreshingFetch('reclaim_authenticate'),
		})

		await client.call('ListOrgs', { query: {} })

		const orgCalls = server.requests.filter((r) => r.path === '/orgs')
		assert.deepEqual(orgCalls.map((r) => r.auth), ['Bearer NEW_TOKEN'])
		const cached = readSession()
		assert.equal(cached?.token, 'NEW_TOKEN')
		assert.equal(cached.refreshToken, 'NEW_REFRESH')
	})

	it('refreshes and retries once on a 401', async() => {
		const server = fakeAuthServer({
			token: refreshGrant, validToken: 'NEW_TOKEN',
		})
		globalThis.fetch = server.fetch
		writeSession(session({
			expiresAt: new Date(Date.now() + 3600_000).toISOString(),
		}))
		const client = new ReclaimClient({
			baseUrl: AUTH_ORIGIN,
			fetch: sessionRefreshingFetch('reclaim_authenticate'),
		})

		await client.call('ListOrgs', { query: {} })

		const orgCalls = server.requests.filter((r) => r.path === '/orgs')
		assert.deepEqual(
			orgCalls.map((r) => r.auth), ['Bearer OLD_TOKEN', 'Bearer NEW_TOKEN'],
		)
		assert.equal(readSession()?.token, 'NEW_TOKEN')
	})

	it('without a refresh token, the 401 says to sign in again', async() => {
		globalThis.fetch = fakeAuthServer({ validToken: 'NEW_TOKEN' }).fetch
		writeSession(session({ refreshToken: undefined }))
		const client = new ReclaimClient({
			baseUrl: AUTH_ORIGIN,
			fetch: sessionRefreshingFetch('reclaim_authenticate'),
		})

		await assert.rejects(
			() => client.call('ListOrgs', { query: {} }),
			(err: { output: { statusCode: number }, data: { detail: string } }) => {
				assert.equal(err.output.statusCode, 401)
				assert.match(err.data.detail, /expired.*Call reclaim_authenticate/)
				return true
			},
		)
	})

	it('drops a refresh token the server rejects', async() => {
		globalThis.fetch = fakeAuthServer({
			token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
			validToken: 'NEW_TOKEN',
		}).fetch
		writeSession(session())
		const client = new ReclaimClient({
			baseUrl: AUTH_ORIGIN,
			fetch: sessionRefreshingFetch('reclaim_authenticate'),
		})

		await assert.rejects(
			() => client.call('ListOrgs', { query: {} }),
			(err: { output: { statusCode: number }, message: string }) => {
				assert.equal(err.output.statusCode, 401)
				assert.match(err.message, /could not be refreshed/)
				return true
			},
		)
		assert.equal(readStoredSession()?.refreshToken, undefined)
	})
})

// Sanity check on the API surface this file relies on, so a future
// openid-client major bump that renames something fails loudly here instead
// of silently in production.
describe('openid-client API surface used by authenticate.ts', () => {
	it('exposes the functions the sign-in depends on', () => {
		for(
			const name of [
				'randomPKCECodeVerifier', 'calculatePKCECodeChallenge',
				'randomState', 'dynamicClientRegistration', 'buildAuthorizationUrl',
				'authorizationCodeGrant', 'AuthorizationResponseError', 'discovery',
				'refreshTokenGrant', 'None', 'ResponseBodyError',
			]
		) {
			assert.equal(
				typeof (oauth as unknown as Record<string, unknown>)[name],
				'function',
				`openid-client should export ${name}`,
			)
		}
	})
})
