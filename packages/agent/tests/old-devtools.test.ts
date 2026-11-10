/**
 * Unit tests for OLD-devtools mode (USE_OLD_DEVTOOLS). No network and no
 * Chrome: the ReclaimOldClient is driven with a stub `fetch`, and the
 * translators are pure functions.
 */
import { isBoom } from '@hapi/boom'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import vm from 'node:vm'
import { remapErrorAsResponse } from '../src/mcp/remap_errors.ts'
import { ReclaimOldClient } from '../src/old/client.ts'
import { useOldDevtools } from '../src/old/flag.ts'
import { toEthUid } from '../src/old/identity.ts'
import { EXTRACT_TOKEN_JS } from '../src/old/login-cdp.ts'
import { ReclaimSdkClient } from '../src/old/sdk-client.ts'
import {
	bumpPatchString,
	extractVersions,
	providerToConfigBody,
	providerToRegisterBody,
	resolveNewVersionString,
} from '../src/old/to-register.ts'
import { getProviderInfoTool } from '../src/old/tools/get-provider-info.ts'
import { createVersionFromCaptureTool } from '../src/old/tools/publish.ts'
import { sessionLogsTool } from '../src/old/tools/session-logs.ts'
import {
	updateProviderMetadataTool,
} from '../src/old/tools/update-provider-metadata.ts'
import type { ReclaimProvider } from '../src/provider/schema.ts'

/** A minimal drafted provider, as propose_provider would emit. */
function sampleProvider(over: Partial<ReclaimProvider> = {}): ReclaimProvider {
	return {
		name: 'GitHub Username',
		url: 'https://api.github.com/user',
		method: 'GET',
		headers: { Accept: 'application/json' },
		responseMatches: [{ type: 'contains', value: '"login":"{{username}}"' }],
		responseRedactions: [{ jsonPath: '$.login' }],
		paramValues: { username: 'octocat' },
		...over,
	}
}

/** A JWT-shaped string carrying only an `exp` claim (unsigned — the in-page
 *  extractor only decodes the payload, never verifies the signature). */
function makeJwt(expEpochSeconds: number): string {
	const header = Buffer
		.from(JSON.stringify({ alg: 'none' }))
		.toString('base64url')
	const payload = Buffer
		.from(JSON.stringify({ exp: expEpochSeconds }))
		.toString('base64url')
	return `${header}.${payload}.sig`
}

/** Run the in-page `EXTRACT_TOKEN_JS` snippet in a sandboxed vm context with a
 *  `localStorage` seeded with one `firebase:authUser:*` entry (or none) and an
 *  `indexedDB` that always errors (so only the localStorage branch matters). */
async function runExtractTokenJs(storedToken?: string): Promise<string | null> {
	const sandbox = {
		atob: (s: string) => Buffer.from(s, 'base64').toString('binary'),
		localStorage: {
			length: storedToken !== undefined ? 1 : 0,
			key: () => (
				storedToken !== undefined ? 'firebase:authUser:abc:[DEFAULT]' : null
			),
			getItem: () => (
				JSON.stringify({ stsTokenManager: { accessToken: storedToken } })
			),
		},
		indexedDB: {
			open: () => {
				const req: { onerror?: () => void } = {}
				queueMicrotask(() => req.onerror?.())
				return req
			},
		},
	}
	const context = vm.createContext(sandbox)
	return vm.runInContext(EXTRACT_TOKEN_JS, context) as Promise<string | null>
}

describe('EXTRACT_TOKEN_JS (login-cdp)', () => {
	it('accepts a fresh token', async() => {
		const token = makeJwt(Math.floor(Date.now() / 1000) + 3600)
		assert.equal(await runExtractTokenJs(token), token)
	})

	it('skips a stale token left in a persistent profile', async() => {
		// Regression: a Chrome profile reused across runs can still have an
		// expired ~1h-TTL token in storage the instant the login page loads,
		// before the developer signs in. Returning it made the tool think
		// login succeeded and close the tab immediately.
		const expired = makeJwt(Math.floor(Date.now() / 1000) - 3600)
		assert.equal(await runExtractTokenJs(expired), null)
	})

	it('returns null when nothing is in storage yet', async() => {
		assert.equal(await runExtractTokenJs(undefined), null)
	})
})

/** Build a stub `fetch` that records the last call and returns `body`. */
function stubFetch(
	body: unknown,
	init: { status?: number } = {},
): {
	fetch: typeof fetch
	calls: Array<{ url: string, init?: RequestInit }>
} {
	const calls: Array<{ url: string, init?: RequestInit }> = []
	const fn = (async(url: string | URL, reqInit?: RequestInit) => {
		calls.push({ url: String(url), init: reqInit })
		return new Response(JSON.stringify(body), {
			status: init.status ?? 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}) as unknown as typeof fetch
	return { fetch: fn, calls }
}

/** Route a stub `fetch` by method + URL pattern — needed once a flow makes
 *  several calls that don't all want the same response (for example, GET
 *  .../config then POST .../config, same path, different method). */
interface StubRoute {
	method: string
	match: RegExp
	body: unknown
	status?: number
}

function stubFetchByRoute(
	routes: StubRoute[],
): { fetch: typeof fetch, calls: Array<{ url: string, init?: RequestInit }> } {
	const calls: Array<{ url: string, init?: RequestInit }> = []
	const fn = (async(url: string | URL, reqInit?: RequestInit) => {
		calls.push({ url: String(url), init: reqInit })
		const method = reqInit?.method ?? 'GET'
		const route = routes.find(
			(r) => r.method === method && r.match.test(String(url)),
		)
		if(!route) {
			throw new Error(`No stub route for ${method} ${String(url)}`)
		}

		return new Response(JSON.stringify(route.body), {
			status: route.status ?? 200,
			headers: { 'Content-Type': 'application/json' },
		})
	}) as unknown as typeof fetch
	return { fetch: fn, calls }
}

describe('useOldDevtools flag', () => {
	const KEY = 'USE_OLD_DEVTOOLS'
	const run = (val: string | undefined): boolean => {
		const prev = process.env[KEY]
		if(val === undefined) {
			delete process.env[KEY]
		} else {
			process.env[KEY] = val
		}

		try {
			return useOldDevtools()
		} finally {
			if(prev === undefined) {
				delete process.env[KEY]
			} else {
				process.env[KEY] = prev
			}
		}
	}

	it('defaults to off when unset', () => {
		assert.equal(run(undefined), false)
	})

	it('requires an explicit legacy opt-in', () => {
		assert.equal(run('true'), true)
		assert.equal(run('1'), true)
		assert.equal(run('false'), false)
		assert.equal(run('typo'), false)
	})
})

describe('to-register translation', () => {
	it('builds a register body with separate match/redaction arrays', () => {
		const body = providerToRegisterBody([sampleProvider()], {
			initialUrl: 'https://github.com/octocat',
			description: 'GitHub login',
		})

		assert.equal(body.name, 'GitHub Username')
		assert.equal(body.loginUrl, 'https://github.com/octocat')
		assert.equal(body.providerType, 'PRIVATE')
		// Web-settings defaults mirror the builder openapi defaults.
		assert.equal(body.geoLocation, '{{DYNAMIC_GEO}}')
		assert.equal(body.useProxy, true)
		assert.equal(body.requestData.length, 1)

		const rd = body.requestData[0] as Record<string, unknown>
		assert.equal(rd.url, 'https://api.github.com/user')
		assert.equal(rd.urlType, 'CONSTANT')
		assert.equal(rd.method, 'GET')
		assert.equal(rd.credentials, 'include')
		// matches and redactions stay PARALLEL (not nested into extract).
		assert.deepEqual(rd.responseMatches, [
			{
				value: '"login":"{{username}}"',
				type: 'contains',
				isOptional: false,
				order: 0,
			},
		])
		assert.deepEqual(rd.responseRedactions, [{ jsonPath: '$.login', order: 0 }])
		// responseVariables is NOT sent — the backend derives it.
		assert.equal('responseVariables' in rd, false)
	})

	it('builds one requestData entry per provider (multi-request)', () => {
		// Regression: a multi-request capture must persist EVERY request, not
		// just the first (each becomes a parallel requestData entry).
		const body = providerToRegisterBody(
			[
				sampleProvider({
					name: 'PAYE Landing',
					url: 'https://odx.example/D_PAYELanding',
					responseMatches: [
						{ type: 'contains', value: '"FullName":"{{full_name}}"' },
					],
					responseRedactions: [{ jsonPath: '$.FullName' }],
				}),
				sampleProvider({
					name: 'PAYE Details',
					url: 'https://odx.example/D_PAYEDetails',
					responseMatches: [
						{ type: 'contains', value: '"EmployerName":"{{employer_name}}"' },
					],
					responseRedactions: [{ jsonPath: '$.EmployerName' }],
				}),
			],
			{ initialUrl: 'https://odx.example' },
		)
		assert.equal(body.requestData.length, 2)
		assert.deepEqual(
			body.requestData.map((r) => (r as { url: string }).url),
			[
				'https://odx.example/D_PAYELanding',
				'https://odx.example/D_PAYEDetails',
			],
		)
		// Provider-level name comes from the first draft.
		assert.equal(body.name, 'PAYE Landing')
	})

	it('marks a templated url as TEMPLATE and maps a body to bodySniff', () => {
		const body = providerToRegisterBody(
			[sampleProvider({
				url: 'https://api.github.com/users/{{username}}',
				method: 'POST',
				body: '{"q":"{{username}}"}',
			})],
			{ initialUrl: 'https://github.com' },
		)
		const rd = body.requestData[0] as Record<string, unknown>
		assert.equal(rd.urlType, 'TEMPLATE')
		assert.equal(rd.method, 'POST')
		assert.deepEqual(rd.bodySniff, {
			enabled: true,
			template: '{"q":"{{username}}"}',
		})
	})

	it('passes OPRF hash through on redactions', () => {
		const body = providerToRegisterBody(
			[sampleProvider({
				responseRedactions: [{ jsonPath: '$.login', hash: 'oprf-raw' }],
			})],
			{ initialUrl: 'https://github.com' },
		)
		const rd = body.requestData[0] as Record<string, unknown>
		assert.deepEqual(rd.responseRedactions, [
			{ jsonPath: '$.login', hash: 'oprf-raw', order: 0 },
		])
	})

	it('forwards isOptional, credentials and urlType on requestData', () => {
		const body = providerToRegisterBody(
			[sampleProvider({
				credentials: 'same-origin',
				urlType: 'REGEX',
				responseMatches: [
					{ type: 'contains', value: 'a', isOptional: true },
				],
			})],
			{ initialUrl: 'https://github.com' },
		)
		const rd = body.requestData[0] as Record<string, unknown>
		assert.equal(rd.credentials, 'same-origin')
		assert.equal(rd.urlType, 'REGEX')
		assert.deepEqual(rd.responseMatches, [
			{ value: 'a', type: 'contains', isOptional: true, order: 0 },
		])
	})

	it('sets disableRequestReplay on the config body, never on register', () => {
		const config = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com', disableRequestReplay: true },
			'1.0.1',
			'set the replay flag',
		)
		const cfg = config.providerConfig
		assert.equal(cfg.disableRequestReplay, true)

		const plain = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com' },
			'1.0.1',
			'set the replay flag',
		)
		const plainCfg = plain.providerConfig
		assert.equal('disableRequestReplay' in plainCfg, false)

		// The register controller ignores the field, so the register body
		// never carries it (the publish tool applies it via a follow-up).
		const reg = providerToRegisterBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com', disableRequestReplay: true },
		)
		assert.equal('disableRequestReplay' in reg, false)
	})

	it('sets injectionType on both register and config bodies', () => {
		const reg = providerToRegisterBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com', injectionType: 'NONE' },
		)
		assert.equal(reg.injectionType, 'NONE')

		const config = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com', injectionType: 'HAWKEYE' },
			'1.0.1',
			'set injectionType',
		)
		assert.equal(config.providerConfig.injectionType, 'HAWKEYE')

		const plain = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com' },
			'1.0.1',
			'omitted',
		)
		assert.equal('injectionType' in plain.providerConfig, false)
	})

	it('passes through more redactions than matches (no block, no pad)', () => {
		// The author keeps full control — the translator never blocks or pads on
		// a match/redaction count mismatch (the publish tool warns instead).
		const body = providerToRegisterBody(
			[sampleProvider({
				responseMatches: [{ type: 'contains', value: '"login":"{{u}}"' }],
				responseRedactions: [{ jsonPath: '$.login' }, { jsonPath: '$.id' }],
			})],
			{ initialUrl: 'https://github.com' },
		)
		const rd = body.requestData[0] as Record<string, unknown>
		assert.equal((rd.responseMatches as unknown[]).length, 1)
		assert.equal((rd.responseRedactions as unknown[]).length, 2)
	})

	it('carries customInjection top-level on register, nested on config', () => {
		const registerBody = providerToRegisterBody([sampleProvider()], {
			initialUrl: 'https://github.com/octocat',
			customInjection: 'window.location.href = "https://github.com/login"',
		})
		assert.equal(
			registerBody.customInjection,
			'window.location.href = "https://github.com/login"',
		)

		const configBody = providerToConfigBody(
			[sampleProvider()],
			{
				initialUrl: 'https://github.com/octocat',
				customInjection: 'window.location.href = "https://github.com/login"',
			},
			'1.0.3',
			'Updated from MCP browser capture',
		)
		assert.equal(
			configBody.providerConfig.customInjection,
			'window.location.href = "https://github.com/login"',
		)
	})

	it('omits customInjection entirely when not provided', () => {
		const registerBody = providerToRegisterBody([sampleProvider()], {
			initialUrl: 'https://github.com/octocat',
		})
		assert.equal('customInjection' in registerBody, false)

		const configBody = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com/octocat' },
			'1.0.3',
			'Updated from MCP browser capture',
		)
		assert.equal('customInjection' in configBody.providerConfig, false)
	})

	it('explicit geoLocation/useProxy override the defaults', () => {
		const body = providerToRegisterBody([sampleProvider()], {
			initialUrl: 'https://github.com/octocat',
			geoLocation: 'US',
			useProxy: false,
		})
		assert.equal(body.geoLocation, 'US')
		assert.equal(body.useProxy, false)
	})

	it('rejects non GET/POST methods', () => {
		assert.throws(
			() => providerToRegisterBody(
				[sampleProvider({ method: 'PUT' as ReclaimProvider['method'] })],
				{ initialUrl: 'https://github.com' },
			),
			/GET\/POST/,
		)
	})

	it('builds an update config body with version + versionInfo', () => {
		const body = providerToConfigBody(
			[sampleProvider()],
			{ initialUrl: 'https://github.com/octocat', geoLocation: 'US' },
			'1.0.3',
			'Updated from MCP browser capture',
		)
		assert.equal(body.version, '1.0.3')
		assert.equal(body.versionInfo.length >= 10, true)
		const cfg = body.providerConfig
		assert.equal(cfg.loginUrl, 'https://github.com/octocat')
		assert.equal(cfg.geoLocation, 'US')
		assert.equal((cfg.requestData as unknown[]).length, 1)
	})
})

describe('version helpers', () => {
	it('extracts triplets from varied envelopes', () => {
		const fromArray = extractVersions([
			{ version: { major: 1, minor: 2, patch: 3 } },
		])
		assert.deepEqual(fromArray, [{ major: 1, minor: 2, patch: 3 }])
		const fromObj = extractVersions({
			providerVersions: [{ version: { major: 2, minor: 0, patch: 0 } }],
		})
		assert.deepEqual(fromObj, [{ major: 2, minor: 0, patch: 0 }])
	})

	it('bumps the highest patch, falls back to 1.0.1', () => {
		assert.equal(
			bumpPatchString([
				{ major: 1, minor: 0, patch: 0 },
				{ major: 1, minor: 2, patch: 5 },
				{ major: 1, minor: 1, patch: 9 },
			]),
			'1.2.6',
		)
		assert.equal(bumpPatchString([]), '1.0.1')
	})

	it('supports major, minor, patch, and exact semver choices', () => {
		const versions = [{ major: 2, minor: 4, patch: 6 }]
		assert.equal(resolveNewVersionString(versions, { bump: 'major' }), '3.0.0')
		assert.equal(resolveNewVersionString(versions, { bump: 'minor' }), '2.5.0')
		assert.equal(resolveNewVersionString(versions, { bump: 'patch' }), '2.4.7')
		assert.equal(
			resolveNewVersionString(versions, {
				version: { major: 8, minor: 1, patch: 0 },
			}),
			'8.1.0',
		)
	})
})

describe('toEthUid', () => {
	it('normalizes bare and prefixed addresses to lowercase eth uid', () => {
		assert.deepEqual(toEthUid('0xABCD'), { kind: 'eth', uid: 'eth:0xabcd' })
		assert.deepEqual(toEthUid('eth:0xABcd'), {
			kind: 'eth',
			uid: 'eth:0xabcd',
		})
	})
})

describe('ReclaimOldClient', () => {
	it('attaches x-eth-uid and defaults the required query', async() => {
		const { fetch, calls } = stubFetch({
			providers: [],
			count: 0,
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			baseUrl: 'https://old.example.com/',
			identity: { kind: 'eth', uid: 'eth:0xabc' },
			fetch,
		})

		await client.getMyProviders({})

		const { url, init } = calls[0]
		assert.match(url, /\/api\/providers\/user\/paginated\?/)
		assert.match(url, /providerVisibility=ALL/)
		assert.match(url, /pageSize=20/)
		const headers = init?.headers as Record<string, string>
		assert.equal(headers['x-eth-uid'], 'eth:0xabc')
		assert.equal('Authorization' in headers, false)
	})

	it('attaches a bearer token and posts the register body', async() => {
		const { fetch, calls } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			baseUrl: 'https://old.example.com',
			identity: { kind: 'bearer', token: 't0' },
			fetch,
		})

		await client.registerProvider({
			name: 'X',
			loginUrl: 'https://x.com',
			requestData: [],
		})

		const { url, init } = calls[0]
		assert.equal(url, 'https://old.example.com/api/providers/register')
		assert.equal(init?.method, 'POST')
		const headers = init?.headers as Record<string, string>
		assert.equal(headers['Authorization'], 'Bearer t0')
		assert.deepEqual(JSON.parse(String(init?.body)), {
			name: 'X',
			loginUrl: 'https://x.com',
			requestData: [],
		})
	})

	it('posts a partial update to the provider-metadata endpoint', async() => {
		const { fetch, calls } = stubFetch({
			isSuccess: true,
			provider: { providerId: 'p1', name: 'New Name' },
		})
		const client = new ReclaimOldClient({
			baseUrl: 'https://old.example.com',
			identity: { kind: 'bearer', token: 't0' },
			fetch,
		})

		await client.updateProviderMetadata('p1', { name: 'New Name' })
		assert.equal(calls[0].url, 'https://old.example.com/api/providers/p1')
		assert.equal(calls[0].init?.method, 'POST')
		assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
			name: 'New Name',
		})
	})

	it('throws a Boom error that remaps cleanly on a 4xx', async() => {
		const { fetch } = stubFetch(
			{ message: 'ETH user not found', isSuccess: false },
			{ status: 401 },
		)
		const client = new ReclaimOldClient({
			identity: { kind: 'eth', uid: 'eth:0xabc' },
			fetch,
		})

		await assert.rejects(
			() => client.getMyProviders(),
			(err: unknown) => {
				assert.equal(isBoom(err), true)
				const mapped = remapErrorAsResponse(err)
				assert.equal(mapped.isError, true)
				assert.match(
					(mapped.content[0] as { text: string }).text,
					/ETH user not found/,
				)
				return true
			},
		)
	})

	it(
		'appends stale-auth guidance on a 401/403 when an identity IS set',
		async() => {
			const { fetch } = stubFetch(
				{ message: 'Error while verifying token', isSuccess: false },
				{ status: 401 },
			)
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 'stale' },
				fetch,
			})

			await assert.rejects(
				() => client.getMyProviders(),
				(err: unknown) => {
					const message = (err as Error).message
					assert.match(message, /Error while verifying token/)
					assert.match(message, /stale or invalid/)
					assert.match(message, /separate from Builder auth/)
					assert.match(message, /reclaim_authenticate/)
					return true
				},
			)
		},
	)

	it(
		'appends stale-auth guidance on a non-401/403 status too, when the ' +
		'message itself names token verification',
		async() => {
			// Confirmed live against the real devapi backend: an actually-expired
			// Firebase token surfaces "Error while verifying token" WITHOUT a
			// 401/403 status — a status-only check misses this entirely.
			const { fetch } = stubFetch(
				{ message: 'Error while verifying token', isSuccess: false },
				{ status: 500 },
			)
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 'stale' },
				fetch,
			})

			await assert.rejects(
				() => client.getMyProviders(),
				(err: unknown) => {
					const message = (err as Error).message
					assert.match(message, /Error while verifying token/)
					assert.match(message, /stale or invalid/)
					assert.match(message, /reclaim_authenticate/)
					return true
				},
			)
		},
	)

	it(
		'does not append stale-auth guidance on an unrelated failure message',
		async() => {
			const { fetch } = stubFetch(
				{ message: 'Version 1.0.0 already exists', isSuccess: false },
				{ status: 400 },
			)
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 'valid' },
				fetch,
			})

			await assert.rejects(
				() => client.getMyProviders(),
				(err: unknown) => {
					const message = (err as Error).message
					assert.match(message, /Version 1\.0\.0 already exists/)
					assert.doesNotMatch(message, /stale or invalid/)
					return true
				},
			)
		},
	)

	it(
		'does not append stale-auth guidance when never authenticated',
		async() => {
			const client = new ReclaimOldClient()
			await assert.rejects(
				() => client.getMyProviders(),
				(err: unknown) => {
					const message = (err as Error).message
					assert.match(message, /Not authenticated against old devtools/)
					assert.doesNotMatch(message, /stale or invalid/)
					return true
				},
			)
		},
	)

	it('treats a 2xx with isSuccess:false as an error', async() => {
		const { fetch } = stubFetch({ message: 'nope', isSuccess: false })
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		await assert.rejects(() => client.loginWithToken(), /nope/)
	})

	it('refuses authed calls with no identity', async() => {
		const { fetch } = stubFetch({})
		const client = new ReclaimOldClient({ fetch })
		await assert.rejects(() => client.getMyProviders(), /Not authenticated/)
	})
})

describe('old publish tool — version-edit ownership', () => {
	it('suggests registering a copy when versioning a provider you do not own',
		async() => {
			// A providerId you don't own (for example, a public provider) → the
			// versions lookup 403s; the tool should rethrow with the register-a-copy
			// hint.
			const { fetch } = stubFetch(
				{ message: 'Forbidden', isSuccess: false },
				{ status: 403 },
			)
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 't' },
				fetch,
			})
			const tool = createVersionFromCaptureTool(client)

			await assert.rejects(
				() => tool.handler({
					provider: sampleProvider(),
					initialUrl: 'https://github.com/octocat',
					providerId: 'someone-elses-provider',
				}),
				(err: unknown) => {
					assert.equal(isBoom(err), true)
					const text = (remapErrorAsResponse(err).content[0] as {
						text: string
					}).text
					assert.match(text, /register/i)
					assert.match(text, /without `providerId`/i)
					return true
				},
			)
		})

	it('does not add the ownership hint to non-permission errors', async() => {
		// A 400 (for example, version collision) is a different problem — surface
		// it verbatim, no register-a-copy suggestion.
		const { fetch } = stubFetch(
			{ message: 'version already exists', isSuccess: false },
			{ status: 400 },
		)
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await assert.rejects(
			() => tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
				providerId: 'my-own-provider',
			}),
			(err: unknown) => {
				const text = (remapErrorAsResponse(err).content[0] as {
					text: string
				}).text
				assert.match(text, /version already exists/)
				assert.doesNotMatch(text, /register your own copy/i)
				return true
			},
		)
	})

	it('warns (non-blocking) when matches < redactions on register', async() => {
		// Publishing succeeds; a `_notes` advisory about the InApp SDK is attached
		// so the dev can decide — the publish is never blocked.
		const { fetch } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		const result = await tool.handler({
			provider: sampleProvider({
				responseMatches: [{ type: 'contains', value: 'a' }],
				responseRedactions: [{ jsonPath: '$.a' }, { jsonPath: '$.b' }],
			}),
			initialUrl: 'https://github.com/octocat',
		}) as { _notes?: string[] }

		const notes = result._notes ?? []
		assert.equal(notes.length > 0, true)
		assert.match(notes[0], /InApp SDK|responseMatches is shorter/i)
	})

	it(
		'attaches only the automatic follow-up note when matches >= redactions',
		async() => {
			const { fetch } = stubFetchByRoute([
				{
					method: 'POST',
					match: /\/providers\/register$/,
					body: { provider: { providerId: 'p1' }, isSuccess: true },
				},
				{
					method: 'GET',
					match: /\/providers\/p1\/versions$/,
					body: {
						providerVersions: [
							{ version: { major: 1, minor: 0, patch: 0 } },
						],
					},
				},
				{
					method: 'POST',
					match: /\/providers\/p1\/config$/,
					body: { isSuccess: true },
				},
			])
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 't' },
				fetch,
			})
			const tool = createVersionFromCaptureTool(client)

			const result = await tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
			}) as { _notes?: string[] }

			// The only note should be the automatic disableRequestReplay
			// follow-up — balanced matches/redactions must not add a SECOND
			// advisory.
			assert.equal((result._notes ?? []).length, 1)
			assert.match(
				result._notes![0], /apply disableRequestReplay/,
			)
		},
	)

	it(
		'register always follows up with an add-version to apply ' +
		'disableRequestReplay',
		async() => {
			const { fetch, calls } = stubFetchByRoute([
				{
					method: 'POST',
					match: /\/providers\/register$/,
					body: { provider: { providerId: 'p-new' }, isSuccess: true },
				},
				{
					method: 'GET',
					match: /\/providers\/p-new\/versions$/,
					body: {
						providerVersions: [
							{ version: { major: 1, minor: 0, patch: 0 } },
						],
					},
				},
				{
					method: 'POST',
					match: /\/providers\/p-new\/config$/,
					body: { isSuccess: true },
				},
			])
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 't' },
				fetch,
			})
			const tool = createVersionFromCaptureTool(client)

			const result = await tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
			}) as { _notes?: string[] }

			// Register hardcodes the flag false — the tool must apply it via a
			// follow-up config (add-version) call on the new provider, with NO
			// author input needed to trigger it.
			const configCall = calls.find((c) => c.url.endsWith('/config'))
			assert.ok(configCall, 'a follow-up add-version call was made')
			const sent = JSON.parse(String(configCall.init?.body)) as {
				providerConfig: Record<string, unknown>
				version: string
			}
			assert.equal(sent.providerConfig.disableRequestReplay, true)
			assert.equal(sent.version, '1.0.1')
			assert.match(
				(result._notes ?? []).join('\n'), /apply disableRequestReplay/,
			)

			// injectionType has NO forced default — unlike disableRequestReplay,
			// the backend's own HAWKEYE column default is left to apply when the
			// author doesn't specify one.
			assert.equal('injectionType' in sent.providerConfig, false)
			const registerCall = calls.find((c) => c.url.endsWith('/register'))
			const registerSent = JSON.parse(
				String(registerCall?.init?.body),
			) as Record<string, unknown>
			assert.equal('injectionType' in registerSent, false)
		})

	it('rejects NONE with intercepted response middleware', async() => {
		const { fetch, calls } = stubFetchByRoute([])
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await assert.rejects(
			() => tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
				customInjection:
					'window.reclaimInterceptor.addResponseMiddleware(() => {})',
				injectionType: 'NONE',
			}),
			/window\.Reclaim\.requestClaim/,
		)
		assert.equal(calls.length, 0)
	})

	it(
		'disableRequestReplay defaults to true but is author-overridable ' +
		'to false',
		async() => {
			const { fetch, calls } = stubFetchByRoute([
				{
					method: 'POST',
					match: /\/providers\/register$/,
					body: { provider: { providerId: 'p-new' }, isSuccess: true },
				},
				{
					method: 'GET',
					match: /\/providers\/p-new\/versions$/,
					body: {
						providerVersions: [
							{ version: { major: 1, minor: 0, patch: 0 } },
						],
					},
				},
				{
					method: 'POST',
					match: /\/providers\/p-new\/config$/,
					body: { isSuccess: true },
				},
			])
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 't' },
				fetch,
			})
			const tool = createVersionFromCaptureTool(client)

			await tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
				injectionType: 'HAWKEYE',
				disableRequestReplay: false,
			})

			const configCall = calls.find((c) => c.url.endsWith('/config'))
			const sent = JSON.parse(String(configCall?.init?.body)) as {
				providerConfig: Record<string, unknown>
			}
			assert.equal(sent.providerConfig.disableRequestReplay, false)
		},
	)

	it('publishes every request from `providers` (multi-request)', async() => {
		const { fetch, calls } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			providers: [
				sampleProvider({ name: 'A', url: 'https://api.example/a' }),
				sampleProvider({ name: 'B', url: 'https://api.example/b' }),
			],
			initialUrl: 'https://example.com',
		})

		const sent = JSON.parse(String(calls[0].init?.body)) as {
			requestData: Array<{ url: string }>
		}
		assert.equal(sent.requestData.length, 2)
		assert.deepEqual(sent.requestData.map((r) => r.url), [
			'https://api.example/a',
			'https://api.example/b',
		])
	})

	const versionListBody = {
		isSuccess: true,
		versions: [{ version: { major: 1, minor: 0, patch: 0 } }],
	}

	it('does NOT carry forward omitted fields (POST replaces the whole config)',
		async() => {
		// This backend only ever POSTs a brand-new version; the tool reads
		// nothing back and carries nothing forward. Omitted fields are absent
		// in the new version, and a _notes entry says so.
			const { fetch, calls } = stubFetchByRoute([
				{ method: 'GET', match: /\/versions$/, body: versionListBody },
				{
					method: 'POST',
					match: /\/config$/,
					body: { isSuccess: true, providerVersion: { version: '1.0.1' } },
				},
			])
			const client = new ReclaimOldClient({
				identity: { kind: 'bearer', token: 't' },
				fetch,
			})
			const tool = createVersionFromCaptureTool(client)

			const result = await tool.handler({
				provider: sampleProvider(),
				initialUrl: 'https://github.com/octocat',
				providerId: 'my-own-provider',
			}) as { _notes?: string[] }

			// The tool must NOT read the current config back.
			assert.equal(
				calls.some((c) => {
					return c.init?.method === 'GET' && /\/config(\?|$)/.test(c.url)
				}),
				false,
			)

			const configPost = calls.find((c) => c.init?.method === 'POST')!
			const sent = JSON.parse(String(configPost.init?.body)) as {
				providerConfig: Record<string, unknown>
			}
			assert.equal('customInjection' in sent.providerConfig, false)
			assert.equal('userAgent' in sent.providerConfig, false)
			assert.equal('pageTitle' in sent.providerConfig, false)
			assert.match(
				(result._notes ?? []).join(' '),
				/nothing was carried forward/i,
			)
		}
	)

	it('publishes exactly the fields passed on add-version', async() => {
		const { fetch, calls } = stubFetchByRoute([
			{ method: 'GET', match: /\/versions$/, body: versionListBody },
			{
				method: 'POST',
				match: /\/config$/,
				body: { isSuccess: true, providerVersion: { version: '1.0.1' } },
			},
		])
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			provider: sampleProvider(),
			initialUrl: 'https://github.com/octocat',
			providerId: 'my-own-provider',
			customInjection: 'window.x = 1',
			pageTitle: 'New Title',
			useIncognitoWebview: false,
		})

		const configPost = calls.find((c) => c.init?.method === 'POST')!
		const sent = JSON.parse(String(configPost.init?.body)) as {
			providerConfig: Record<string, unknown>
		}
		assert.equal(sent.providerConfig.customInjection, 'window.x = 1')
		assert.equal(sent.providerConfig.pageTitle, 'New Title')
		assert.equal(sent.providerConfig.useIncognitoWebview, false)
	})

	it('accepts an exact user-directed semver for a new version', async() => {
		const { fetch, calls } = stubFetchByRoute([
			{ method: 'GET', match: /\/versions$/, body: versionListBody },
			{
				method: 'POST',
				match: /\/config$/,
				body: { isSuccess: true, providerVersion: { version: '7.4.2' } },
			},
		])
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			provider: sampleProvider(),
			initialUrl: 'https://github.com/octocat',
			providerId: 'my-own-provider',
			version: { major: 7, minor: 4, patch: 2 },
		})

		const configPost = calls.find((c) => c.init?.method === 'POST')!
		const sent = JSON.parse(String(configPost.init?.body)) as {
			version: string
		}
		assert.equal(sent.version, '7.4.2')
	})

	it('translates fresh allowedInjectedRequestData on add-version', async() => {
		const { fetch, calls } = stubFetchByRoute([
			{
				method: 'GET',
				match: /\/config(\?|$)/,
				body: { isSuccess: true, providerConfig: {} },
			},
			{ method: 'GET', match: /\/versions$/, body: versionListBody },
			{
				method: 'POST',
				match: /\/config$/,
				body: { isSuccess: true, providerVersion: { version: '1.0.1' } },
			},
		])
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			provider: sampleProvider(),
			initialUrl: 'https://github.com/octocat',
			providerId: 'my-own-provider',
			allowedInjectedRequestData: [
				{
					url: 'https://api.example/page/{{n}}',
					method: 'GET',
					responseMatches: [{ type: 'contains', value: 'a' }],
				},
			],
		})

		const configPost = calls.find((c) => c.init?.method === 'POST')!
		const sent = JSON.parse(String(configPost.init?.body)) as {
			providerConfig: {
				allowedInjectedRequestData: Array<Record<string, unknown>>
			}
		}
		const entry = sent.providerConfig.allowedInjectedRequestData[0]
		assert.equal(entry.url, 'https://api.example/page/{{n}}')
		assert.equal(entry.urlType, 'TEMPLATE')
		assert.equal(entry.required, true)
		assert.equal(entry.multiple, true)
	})

	it('warns and drops register-only-ignored fields on register', async() => {
		const { fetch, calls } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		const result = await tool.handler({
			provider: sampleProvider(),
			initialUrl: 'https://github.com/octocat',
			pageTitle: 'Kept',
			// Regression: stepsToFollow is accepted by the register controller
			// (verified from its destructure + providerConfig write) — it was
			// wrongly mis-categorized as add-version-only and silently dropped
			// with no warning at all, unlike the three genuinely-ignored fields
			// below.
			stepsToFollow: 'Also kept',
			useIncognitoWebview: true,
			extensionConfig: { foo: 'bar' },
		}) as { _notes?: string[] }

		const sent = JSON.parse(String(calls[0].init?.body)) as
			Record<string, unknown>
		assert.equal(sent.pageTitle, 'Kept')
		assert.equal(sent.stepsToFollow, 'Also kept')
		assert.equal('useIncognitoWebview' in sent, false)
		assert.equal('extensionConfig' in sent, false)
		assert.match(
			(result._notes ?? []).join(' '),
			/ignored on register/i,
		)
		assert.doesNotMatch(
			(result._notes ?? []).join(' '),
			/stepsToFollow.*ignored/i,
		)
	})

	it('does not touch customInjection on a brand-new provider', async() => {
		const { fetch, calls } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			provider: sampleProvider(),
			initialUrl: 'https://github.com/octocat',
		})

		// Register, then the automatic force-disable-document-replay
		// follow-up (listVersions + config) — three calls, not one.
		assert.equal(calls.length, 3)
		const sent = JSON.parse(String(calls[0].init?.body)) as
			Record<string, unknown>
		assert.equal('customInjection' in sent, false)
	})

	it('rejects when neither provider input is given', async() => {
		const { fetch } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await assert.rejects(
			() => tool.handler({ initialUrl: 'https://example.com' }),
			/at least one of/i,
		)
	})

	it('combines `provider` and `providers` when both are given', async() => {
		const { fetch, calls } = stubFetch({
			provider: { providerId: 'p1' },
			isSuccess: true,
		})
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = createVersionFromCaptureTool(client)

		await tool.handler({
			provider: sampleProvider(),
			providers: [{
				...sampleProvider(),
				url: 'https://api.github.com/user/repos',
			}],
			initialUrl: 'https://example.com',
		})

		const sent = JSON.parse(String(calls[0].init?.body)) as
			{ requestData: Array<{ url: string }> }
		assert.equal(sent.requestData.length, 2)
	})
})

describe('ReclaimSdkClient', () => {
	it('fetches a provider, versionNumber only when given', async() => {
		const { fetch, calls } = stubFetch({
			isSuccess: true,
			providers: { name: 'X' },
		})
		const client = new ReclaimSdkClient({
			baseUrl: 'https://api.example.com',
			fetch,
		})

		await client.getProvider('p1')
		assert.equal(
			calls[0].url,
			'https://api.example.com/api/providers/p1',
		)
		assert.equal(calls[0].init?.method, 'GET')
		const headers = calls[0].init?.headers as Record<string, string>
		assert.equal('Authorization' in headers, false)

		await client.getProvider('p1', '1.0.2')
		assert.equal(
			calls[1].url,
			'https://api.example.com/api/providers/p1?versionNumber=1.0.2',
		)
	})

	it('fetches provider configs at the plural /configs path', async() => {
		const { fetch, calls } = stubFetch({
			isSuccess: true,
			providers: [{ isScriptRequestingClaim: false }],
		})
		const client = new ReclaimSdkClient({
			baseUrl: 'https://api.example.com',
			fetch,
		})

		await client.getProviderConfigs('p1', '2.0.0')
		assert.equal(
			calls[0].url,
			'https://api.example.com/api/providers/p1/configs?versionNumber=2.0.0',
		)
	})

	it('throws a Boom on a 4xx, no identity required', async() => {
		const { fetch } = stubFetch(
			{ message: 'Provider not found', isSuccess: false },
			{ status: 404 },
		)
		const client = new ReclaimSdkClient({ fetch })

		await assert.rejects(
			() => client.getProvider('missing'),
			(err: unknown) => {
				assert.equal(isBoom(err), true)
				assert.match((err as Error).message, /Provider not found/)
				return true
			},
		)
	})
})

describe('get_provider_info tool', () => {
	it('merges provider + configs from the two endpoints', async() => {
		const { fetch } = stubFetchByRoute([
			{
				method: 'GET',
				match: /\/providers\/p1(\?|$)/,
				body: { isSuccess: true, providers: { customInjection: 'x' } },
			},
			{
				method: 'GET',
				match: /\/providers\/p1\/configs(\?|$)/,
				body: {
					isSuccess: true,
					providers: [{ isScriptRequestingClaim: true }],
				},
			},
		])
		const client = new ReclaimSdkClient({ fetch })
		const tool = getProviderInfoTool(client)

		const result = await tool.handler({ providerId: 'p1' }) as {
			provider: { providers: { customInjection: string } }
			configs: { providers: Array<{ isScriptRequestingClaim: boolean }> }
			errors?: string[]
		}

		assert.equal(result.provider.providers.customInjection, 'x')
		assert.equal(result.configs.providers[0].isScriptRequestingClaim, true)
		assert.equal(result.errors, undefined)
	})

	it('reports one failure under errors, keeps the other result', async() => {
		const { fetch } = stubFetchByRoute([
			{
				method: 'GET',
				match: /\/providers\/p1(\?|$)/,
				body: { isSuccess: true, providers: { name: 'X' } },
			},
			{
				method: 'GET',
				match: /\/providers\/p1\/configs(\?|$)/,
				body: { message: 'not found', isSuccess: false },
				status: 404,
			},
		])
		const client = new ReclaimSdkClient({ fetch })
		const tool = getProviderInfoTool(client)

		const result = await tool.handler({ providerId: 'p1' }) as {
			provider?: unknown
			configs?: unknown
			errors?: string[]
		}

		assert.equal(result.configs, undefined)
		assert.notEqual(result.provider, undefined)
		const errors = result.errors ?? []
		assert.equal(errors.length, 1)
		assert.match(errors[0], /configs.*not found/i)
	})
})

describe('update_provider_metadata tool', () => {
	it('sends only the fields passed', async() => {
		const { fetch, calls } = stubFetch({
			isSuccess: true,
			provider: { providerId: 'p1', name: 'Renamed' },
		})
		const client = new ReclaimOldClient({
			baseUrl: 'https://old.example.com',
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = updateProviderMetadataTool(client)

		const result = await tool.handler({
			providerId: 'p1',
			name: 'Renamed',
			isActive: false,
		})

		assert.equal(calls[0].url, 'https://old.example.com/api/providers/p1')
		assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
			name: 'Renamed',
			isActive: false,
		})
		assert.deepEqual(result, {
			isSuccess: true,
			provider: { providerId: 'p1', name: 'Renamed' },
		})
	})

	it('rejects a call with no fields to update', async() => {
		const { fetch } = stubFetch({ isSuccess: true })
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = updateProviderMetadataTool(client)

		await assert.rejects(
			() => tool.handler({ providerId: 'p1' }),
			/at least one/i,
		)
	})

	it('surfaces the backend 403 verbatim for a not-owned provider', async() => {
		const { fetch } = stubFetch(
			{
				message: 'You are not authorized to update this provider',
				isSuccess: false,
			},
			{ status: 403 },
		)
		const client = new ReclaimOldClient({
			identity: { kind: 'bearer', token: 't' },
			fetch,
		})
		const tool = updateProviderMetadataTool(client)

		await assert.rejects(
			() => tool.handler({ providerId: 'not-mine', name: 'X' }),
			/not authorized/i,
		)
	})
})

/** One raw log row in the log-stream/ClickHouse shape the devtools
 *  backend passes through untouched. */
function row(over: Record<string, unknown> = {}) {
	return {
		timestamp: '2026-08-20T10:00:00.000Z',
		request_id: 'req-1',
		session_id: 's1',
		device_id: 'dev-1',
		source: 'flutter-sdk/1.2.3 android',
		app_id: 'app-1',
		provider_id: 'prov-1',
		log_type: 'reclaim.ClaimCreation',
		log_level: 'INFO',
		log_line: 'hello',
		event_type: '',
		metadata: '{}',
		...over,
	}
}

/** The devtools backend's envelope: `{ message, data: {...}, isSuccess }`. */
function envelope(data: unknown) {
	return { message: 'Logs fetched successfully', data, isSuccess: true }
}

function toolWith(fetch: typeof globalThis.fetch) {
	return sessionLogsTool(
		new ReclaimOldClient({ identity: { kind: 'bearer', token: 't' }, fetch }),
	)
}

describe('session_logs', () => {
	it('hits the devtools logger route and widens the level default',
		async() => {
			// The backend defaults to `info`, which hides every FINE/CONFIG line —
			// exactly the ones a stalled session needs. The tool must ask for
			// `fine` unless told otherwise.
			const { fetch, calls } = stubFetch(
				envelope({ data: [row()], count: 1, totalCount: 1 }),
			)
			await toolWith(fetch).handler({ sessionId: 's1' })

			const url = new URL(calls[0].url)
			assert.equal(url.pathname, '/api/logger/s1')
			assert.equal(url.searchParams.get('logLevel'), 'fine')
			assert.equal(url.searchParams.get('includeCount'), 'true')
			assert.equal(
				(calls[0].init?.headers as Record<string, string>).Authorization,
				'Bearer t',
			)
		})

	it('forwards every filter, mapping `contains` to logLine', async() => {
		const { fetch, calls } = stubFetch(
			envelope({ data: [], count: 0, totalCount: 0 }),
		)
		await toolWith(fetch).handler({
			sessionId: 's1',
			eventType: 'REQUEST_MATCHED',
			logLevel: 'severe',
			logType: 'reclaim.Interceptor',
			contains: 'no match',
			providerId: 'prov-1',
			deviceId: 'dev-1',
			source: 'flutter-sdk/1.2.3 android',
			startTime: '2026-08-01T00:00:00.000Z',
			endTime: '2026-08-02T00:00:00.000Z',
		})

		const q = new URL(calls[0].url).searchParams
		assert.equal(q.get('eventType'), 'REQUEST_MATCHED')
		assert.equal(q.get('logLevel'), 'severe')
		assert.equal(q.get('logType'), 'reclaim.Interceptor')
		assert.equal(q.get('logLine'), 'no match')
		assert.equal(q.get('providerId'), 'prov-1')
		assert.equal(q.get('deviceId'), 'dev-1')
		assert.equal(q.get('startTime'), '2026-08-01T00:00:00.000Z')
		assert.equal(q.get('endTime'), '2026-08-02T00:00:00.000Z')
	})

	it('returns rows oldest-first with the event histogram', async() => {
		// The backend sorts newest-first; a session reads forwards.
		const { fetch } = stubFetch(envelope({
			data: [
				row({ timestamp: '2026-08-20T10:00:02.000Z', log_line: 'third' }),
				row({
					timestamp: '2026-08-20T10:00:01.000Z',
					log_line: 'second',
					event_type: 'REQUEST_MATCHED',
				}),
				row({ timestamp: '2026-08-20T10:00:00.000Z', log_line: 'first' }),
			],
			count: 3,
			totalCount: 3,
		}))
		const result = await toolWith(fetch).handler({ sessionId: 's1' }) as {
			entries: Array<{ line: string, event?: string, ts: string }>
			eventTypes?: Record<string, number>
			span?: { from: string, to: string }
			context?: { appId: unknown, deviceId: unknown }
			page: { hasMore: boolean, nextOffset: number }
		}

		assert.deepEqual(
			result.entries.map(e => e.line),
			['first', 'second', 'third'],
		)
		assert.equal(result.entries[1].event, 'REQUEST_MATCHED')
		// No event on a line means no key at all, not an empty string.
		assert.equal('event' in result.entries[0], false)
		assert.deepEqual(result.eventTypes, { REQUEST_MATCHED: 1 })
		assert.equal(result.span?.from, '2026-08-20T10:00:00.000Z')
		assert.equal(result.span?.to, '2026-08-20T10:00:02.000Z')
		// Constant across the page, so hoisted out of every row.
		assert.equal(result.context?.appId, 'app-1')
		assert.equal(result.page.hasMore, false)
	})

	it('reports hasMore from the total, not the page size', async() => {
		const { fetch } = stubFetch(envelope({
			data: [row()],
			count: 1,
			totalCount: 50,
		}))
		const result = await toolWith(fetch).handler({
			sessionId: 's1',
			limit: 1,
		}) as { page: { hasMore: boolean, nextOffset: number } }

		assert.equal(result.page.hasMore, true)
		assert.equal(result.page.nextOffset, 1)
	})

	it('keeps only event-carrying lines under eventsOnly', async() => {
		const { fetch } = stubFetch(envelope({
			data: [
				row({ log_line: 'noise' }),
				row({ log_line: 'milestone', event_type: 'PROOF_GENERATED' }),
			],
			count: 2,
			totalCount: 2,
		}))
		const result = await toolWith(fetch).handler({
			sessionId: 's1',
			eventsOnly: true,
		}) as {
			entries: Array<{ line: string }>
			page: { keptWithEvent?: number }
		}

		assert.deepEqual(result.entries.map(e => e.line), ['milestone'])
		assert.equal(result.page.keptWithEvent, 1)
	})

	it('caps the page at the log-stream maximum', async() => {
		const { fetch, calls } = stubFetch(
			envelope({ data: [], count: 0, totalCount: 0 }),
		)
		await toolWith(fetch).handler({ sessionId: 's1', limit: 999_999 })
		assert.equal(new URL(calls[0].url).searchParams.get('limit'), '1000')
	})

	it('explains an empty result rather than returning a bare zero',
		async() => {
			// The 3-day default window and the analytics-driven region check both
			// produce a silent empty page; the caller has to be told.
			const { fetch } = stubFetch(
				envelope({ data: [], count: 0, totalCount: 0 }),
			)
			const result = await toolWith(fetch).handler({ sessionId: 's1' }) as {
				hint?: string
			}
			assert.match(result.hint!, /3 days/)
		})

	it('flags a partial result when a region failed', async() => {
		const { fetch } = stubFetch(envelope({
			data: [row()],
			count: 1,
			totalCount: 1,
			failedRegions: ['eu'],
		}))
		const result = await toolWith(fetch).handler({ sessionId: 's1' }) as {
			warning?: string
		}
		assert.match(result.warning!, /region eu, so this result is incomplete/)
	})

	it('pages a saveTo dump to exhaustion and writes NDJSON oldest-first',
		async() => {
			const dir = mkdtempSync(join(tmpdir(), 'reclaim-logs-'))
			const target = join(dir, 'nested', 'session.ndjson')
			// 1000 rows (a full page) then 2 — the short second page ends it.
			const first = Array.from({ length: 1000 }, (_, i) => row({
				log_line: `full-${i}`,
				timestamp: `2026-08-20T11:${String(i % 60).padStart(2, '0')}:00.000Z`,
			}))
			const calls: string[] = []
			const fetchStub = (async(url: string | URL) => {
				calls.push(String(url))
				const offset = Number(
					new URL(String(url)).searchParams.get('offset') ?? '0',
				)
				const data = offset === 0
					? first
					: [row({ log_line: 'oldest-b' }), row({ log_line: 'oldest-a' })]
				return new Response(
					JSON.stringify(envelope({
						data,
						count: data.length,
						totalCount: 1002,
					})),
					{ status: 200, headers: { 'Content-Type': 'application/json' } },
				)
			}) as unknown as typeof globalThis.fetch

			const result = await toolWith(fetchStub).handler({
				sessionId: 's1',
				saveTo: target,
			}) as { file: { path: string, entries: number, truncated?: string } }

			assert.equal(calls.length, 2)
			// Only the first page pays for the (expensive) count.
			assert.equal(
				new URL(calls[1]).searchParams.get('includeCount'), 'false',
			)
			assert.equal(result.file.entries, 1002)
			assert.equal(result.file.truncated, undefined)

			const lines = readFileSync(target, 'utf8').trim().split('\n')
			assert.equal(lines.length, 1002)
			// Newest-first off the wire, oldest-first in the file.
			assert.equal(JSON.parse(lines[0]).log_line, 'oldest-a')
			assert.equal(JSON.parse(lines[1001]).log_line, 'full-0')
			// Raw rows, every column intact — the file is the lossless copy.
			assert.equal(JSON.parse(lines[0]).request_id, 'req-1')

			rmSync(dir, { recursive: true, force: true })
		})

	it('stops a dump at maxEntries and says so', async() => {
		const dir = mkdtempSync(join(tmpdir(), 'reclaim-logs-'))
		const target = join(dir, 'capped.ndjson')
		const { fetch, calls } = stubFetch(envelope({
			data: Array.from({ length: 5 }, (_, i) => row({ log_line: `l${i}` })),
			count: 5,
			totalCount: 9_999,
		}))

		const result = await toolWith(fetch).handler({
			sessionId: 's1',
			saveTo: target,
			maxEntries: 5,
		}) as { file: { entries: number, truncated?: string } }

		assert.equal(new URL(calls[0].url).searchParams.get('limit'), '5')
		assert.equal(result.file.entries, 5)
		assert.match(result.file.truncated!, /maxEntries=5/)

		rmSync(dir, { recursive: true, force: true })
	})

	it('surfaces the ownership 404 verbatim', async() => {
		const { fetch } = stubFetch(
			{
				message:
					"Application not found or you don't have permission to view "
					+ 'this session',
				isSuccess: false,
			},
			{ status: 404 },
		)
		await assert.rejects(
			() => toolWith(fetch).handler({ sessionId: 'not-mine' }),
			/don't have permission/,
		)
	})
})
