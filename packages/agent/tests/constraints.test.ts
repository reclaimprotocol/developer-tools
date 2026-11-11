import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectConcerns } from '../src/provider/constraints.ts'
import type { CapturedRequest } from '../src/provider/schema.ts'

function req(partial: Partial<CapturedRequest>): CapturedRequest {
	return {
		requestId: 'r1',
		method: 'GET',
		url: 'https://example.com/api',
		status: 200,
		contentType: 'application/json',
		size: 100,
		requestHeaders: {},
		responseHeaders: {},
		responseBody: '{"ok":true}',
		finishedAt: 0,
		...partial,
	}
}

describe('detectConcerns', () => {
	it('flags HMAC-signed requests via X-Signature header', () => {
		const c = detectConcerns(req({ requestHeaders: { 'X-Signature': 'abc' } }))
		assert.ok(c.find((x) => x.code === 'signedRequest'))
	})

	it('flags cloudflare bot challenge from response status + server header',
		() => {
			const c = detectConcerns(
				req({
					status: 403,
					responseHeaders: {
						Server: 'cloudflare', 'cf-mitigated': 'challenge'
					},
				}),
			)
			assert.ok(c.find((x) => x.code === 'botChallenge'))
		}
	)

	it('flags graphql endpoints', () => {
		const c = detectConcerns(
			req({
				url: 'https://api.github.com/graphql',
				method: 'POST',
				requestBody: '{"query":"query X { __typename }"}',
			}),
		)
		assert.ok(c.find((x) => x.code === 'graphql'))
	})

	it('flags short-lived tokens (JWT with short exp) in Authorization', () => {
		// header.payload.sig where payload has exp ~5 min from now.
		const now = Math.floor(Date.now() / 1000)
		const payload = Buffer.from(JSON.stringify({ exp: now + 300 })).toString(
			'base64url',
		)
		const jwt = `xxx.${payload}.yyy`
		const c = detectConcerns(
			req({
				requestHeaders: { Authorization: `Bearer ${jwt}` },
			}),
		)
		assert.ok(c.find((x) => x.code === 'shortLivedToken'))
	})

	it('flags csrf dependency via X-CSRF-Token request header', () => {
		const c = detectConcerns(req({ requestHeaders: { 'X-CSRF-Token': 'abc' } }))
		assert.ok(c.find((x) => x.code === 'csrfDependency'))
	})

	it('flags encrypted/binary response bodies', () => {
		const c = detectConcerns(
			req({
				contentType: 'application/octet-stream',
				responseBody: ' binary-ish',
			}),
		)
		assert.ok(c.find((x) => x.code === 'encryptedBody'))
	})

	it('returns empty for a clean REST request', () => {
		const c = detectConcerns(
			req({
				url: 'https://api.github.com/user',
				requestHeaders: { Authorization: 'token ghp_xxxx' },
				responseHeaders: { 'content-type': 'application/json' },
				responseBody: '{"login":"octocat","followers":1247}',
			}),
		)
		assert.deepEqual(c, [])
	})
})
