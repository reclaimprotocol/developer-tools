import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import { replayProvider } from '../src/proof/replay.ts'

let srv: Server
let port: number

before(async() => {
	srv = createServer((req, res) => {
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

describe('replayProvider', () => {
	it('matches when the response contains the target value', async() => {
		const out = await replayProvider(
			{
				name: 't',
				url: `http://127.0.0.1:${port}/user`,
				method: 'GET',
				headers: { Accept: 'application/json' },
				responseMatches: [{ type: 'contains', value: '1247' }],
			},
			{ Authorization: 'token xyz' },
		)
		assert.equal(out.matchesOriginal, true)
		assert.equal(out.status, 200)
	})

	it('expands {{name}} placeholders in the URL from paramValues', async() => {
		const out = await replayProvider(
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
		assert.equal(out.status, 200)
	})

	it('substitutes {{name}} in responseMatches.value from paramValues',
		async() => {
		// This is what the new matcher synthesizes: contains template +
		// paramValues. Replay must substitute before checking against the
		// live response.
			const out = await replayProvider(
				{
					name: 't',
					url: `http://127.0.0.1:${port}/user`,
					method: 'GET',
					responseMatches: [{
						type: 'contains', value: '"followers":{{count}}'
					}],
					paramValues: { count: '1247' },
				},
				{ Authorization: 'token xyz' },
			)
			assert.equal(out.matchesOriginal, true)
			assert.equal(out.status, 200)
		}
	)

	it('reports mismatch when secret is missing', async() => {
		const out = await replayProvider(
			{
				name: 't',
				url: `http://127.0.0.1:${port}/user`,
				method: 'GET',
				responseMatches: [{ type: 'contains', value: '1247' }],
			},
			{},
		)
		assert.equal(out.matchesOriginal, false)
		assert.equal(out.status, 401)
		assert.ok(out.hints?.some((h) => /auth/i.test(h)))
	})
})
