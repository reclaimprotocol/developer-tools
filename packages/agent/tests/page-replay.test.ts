import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import vm from 'node:vm'
import { REPLAY_SOURCE_URL } from '../src/cdp/capture-engine.ts'
import type { PageReplayTarget } from '../src/proof/page-replay.ts'
import {
	controlReplayInPage,
	replayProviderInPage,
} from '../src/proof/page-replay.ts'

let srv: Server
let port: number
let lastAuth: string | undefined
let lastCookie: string | undefined

before(async() => {
	srv = createServer((req, res) => {
		lastAuth = req.headers.authorization
		lastCookie = req.headers.cookie
		if(req.url === '/csrf') {
			// Only the original capture carries the CSRF header.
			res.statusCode = req.headers['x-csrf-token'] === 'tok' ? 200 : 403
			res.end(res.statusCode === 200 ? 'ok' : 'bad csrf token')
			return
		}

		if(req.url === '/user' && req.headers.authorization === 'token xyz') {
			res.setHeader('content-type', 'application/json')
			res.end(JSON.stringify({ followers: 1247 }))
			return
		}

		res.statusCode = 401
		res.end('unauthorized')
	})
	await new Promise<void>((r) => srv.listen(0, r))
	port = (srv.address() as AddressInfo).port
})

after(() => new Promise<void>((r) => srv.close(() => r())))

/** Stand in for the attached tab: actually EXECUTES the generated `fetch(...)`
 *  expression via `vm`, against Node's real `fetch`, so this exercises the
 *  real expression string (escaping, credentials, headers) rather than a
 *  hand-written mock of what it's supposed to do. `credentials: 'include'`
 *  has no meaning outside a real browser page, so it's dropped before
 *  evaluating — the point here is verifying headers/body/URL construction. */
function fakeTabTarget(): PageReplayTarget {
	return {
		sendCdp: async(method, params) => {
			assert.equal(method, 'Runtime.evaluate')
			const expression = (params?.expression as string)
				.replace(/credentials:\s*"[a-z]+",?/, '')
			const context = vm.createContext({ fetch })
			const value = await vm.runInContext(expression, context)
			return { result: { value } }
		},
	}
}

describe('replayProviderInPage', () => {
	it('authenticated replay: non-cookie secrets ride as headers', async() => {
		const out = await replayProviderInPage(
			fakeTabTarget(),
			{
				name: 't',
				url: `http://127.0.0.1:${port}/user`,
				method: 'GET',
				headers: { Accept: 'application/json' },
				responseMatches: [{ type: 'contains', value: '1247' }],
			},
			{ Authorization: 'token xyz', Cookie: 'sid=abc' },
		)
		assert.equal(out.matchesOriginal, true)
		assert.equal(out.status, 200)
		assert.equal(lastAuth, 'token xyz')
		// Cookie is dropped from explicit headers — a real browser tab would
		// ride it via `credentials: 'include'` instead.
		assert.equal(lastCookie, undefined)
	})

	it(
		'anonymous replay: withoutSecrets bypasses the page entirely (a ' +
		'detached fetch, not the tab\'s own mutable fetch) and omits every ' +
		'secret header',
		async() => {
			// A target whose `sendCdp` throws if ever called — proves the
			// auth-bound check never touches the page's JS realm, which a site
			// (or a leftover test_user_script) could have wrapped to re-attach
			// a token even under credentials:'omit'.
			const untouchedTarget: PageReplayTarget = {
				sendCdp: () => {
					throw new Error('should not call into the page for withoutSecrets')
				},
			}
			const out = await replayProviderInPage(
				untouchedTarget,
				{
					name: 't',
					url: `http://127.0.0.1:${port}/user`,
					method: 'GET',
					responseMatches: [{ type: 'contains', value: '1247' }],
				},
				{ Authorization: 'token xyz' },
				{ withoutSecrets: true },
			)
			assert.equal(out.matchesOriginal, false)
			assert.equal(out.status, 401)
			assert.equal(lastAuth, undefined)
		},
	)

	it('expands {{name}} placeholders from paramValues', async() => {
		const out = await replayProviderInPage(
			fakeTabTarget(),
			{
				name: 't',
				url: `http://127.0.0.1:${port}/{{path}}`,
				method: 'GET',
				responseMatches: [{ type: 'contains', value: '1247' }],
				paramValues: { path: 'user' },
			},
			{ Authorization: 'token xyz' },
		)
		assert.equal(out.matchesOriginal, true)
	})

	it('throws when the in-page fetch reports an error', async() => {
		const errorTarget: PageReplayTarget = {
			sendCdp: async() => ({ result: { value: { error: 'CORS blocked' } } }),
		}
		await assert.rejects(
			() => replayProviderInPage(
				errorTarget,
				{
					name: 't',
					url: 'https://example.com',
					method: 'GET',
					responseMatches: [],
				},
				{},
			),
			/CORS blocked/,
		)
	})
})

describe('control replay', () => {
	it('tags the script and diffs headers on a recipe-only 403', async() => {
		const expressions: string[] = []
		const target: PageReplayTarget = {
			sendCdp: async(method, params) => {
				expressions.push(params?.expression as string)
				return fakeTabTarget().sendCdp(method, params)
			},
		}
		const url = `http://127.0.0.1:${port}/csrf`
		const recipe = await replayProviderInPage(target, {
			name: 't',
			url,
			method: 'GET',
			headers: { Accept: 'application/json' },
			responseMatches: [{ type: 'contains', value: 'ok' }],
		}, {})
		assert.equal(recipe.status, 403)
		assert.match(recipe.hints?.join(' ') ?? '', /CSRF/)

		const control = await controlReplayInPage(target, {
			requestId: 'r',
			method: 'GET',
			url,
			status: 200,
			contentType: 'text/plain',
			size: 2,
			requestHeaders: {
				accept: 'application/json',
				'X-CSRF-Token': 'tok',
				Host: 'example.com',
				'sec-fetch-mode': 'cors',
				':authority': 'example.com',
			},
			responseHeaders: {},
			finishedAt: 0,
		}, { Accept: 'application/json' })
		assert.equal(control.status, 200)
		assert.equal(control.ok, true)
		assert.deepEqual(control.headerDiff, {
			onlyInCapture: ['x-csrf-token'],
			onlyInRecipe: [],
			valueDiffers: [],
		})
		assert.ok(expressions.length === 2)
		for(const e of expressions) {
			assert.ok(e.endsWith(`//# sourceURL=${REPLAY_SOURCE_URL}`))
		}
	})
})
